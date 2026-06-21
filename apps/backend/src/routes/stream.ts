import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';

export async function streamRoutes(fastify: FastifyInstance) {
  const workerUrl = process.env.WORKER_URL || 'http://localhost:5001';

  // Helper to call worker
  async function callWorker(action: 'start' | 'stop' | 'skip'): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${workerUrl}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!res.ok) {
        const errText = await res.text();
        return { success: false, error: errText || `Worker returned HTTP ${res.status}` };
      }
      return { success: true };
    } catch (err: any) {
      console.error(`Error communicating with stream worker at ${workerUrl}:`, err.message);
      return { success: false, error: `Worker offline or unreachable (${err.message})` };
    }
  }

  // Get current stream status (HTTP fallback)
  fastify.get('/status', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const res = await fetch(`${workerUrl}/status`);
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch (err) {}

    // Fallback if worker is unreachable
    const activeProject = await prisma.project.findFirst({ where: { isActive: true } });
    return {
      isActive: false,
      workerOnline: false,
      projectId: activeProject?.id || null,
      currentVideo: null,
      nextVideo: null,
      bitrate: 0,
      fps: 0,
      elapsed: 0,
      duration: 0,
      preset: activeProject?.preset || 'COPY'
    };
  });

  // Start Stream
  fastify.post('/start', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    // Check if there is an active project with videos
    const activeProject = await prisma.project.findFirst({
      where: { isActive: true },
      include: { projectVideos: true }
    });

    if (!activeProject) {
      return reply.status(400).send({ error: 'Nenhum projeto está ativo. Selecione e ative um projeto nas configurações primeiro.' });
    }

    if (activeProject.mode === 'LOCAL' && activeProject.projectVideos.length === 0) {
      return reply.status(400).send({ error: 'O projeto ativo não possui vídeos em sua playlist. Adicione vídeos ao projeto.' });
    }

    if (activeProject.mode === 'EXTERNAL' && (!activeProject.externalUrl || activeProject.externalUrl.trim() === '')) {
      return reply.status(400).send({ error: 'O projeto está no modo Link Externo, mas não possui uma URL configurada.' });
    }

    if (!activeProject.streamKey || activeProject.streamKey.trim() === '') {
      return reply.status(400).send({ error: 'A Chave de Transmissão (Stream Key) não está configurada para o projeto ativo.' });
    }

    const result = await callWorker('start');
    if (!result.success) {
      return reply.status(502).send({ error: result.error });
    }

    return { success: true };
  });

  // Stop Stream
  fastify.post('/stop', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const result = await callWorker('stop');
    if (!result.success) {
      return reply.status(502).send({ error: result.error });
    }

    return { success: true };
  });

  // Skip Video
  fastify.post('/skip', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const result = await callWorker('skip');
    if (!result.success) {
      return reply.status(502).send({ error: result.error });
    }
    return { success: true };
  });

  // System and FFmpeg logs
  fastify.get('/logs', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const logs = await prisma.streamLog.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' }
    });
    return logs.reverse();
  });

  // Uptime history
  fastify.get('/uptime', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    // Return mock or calculated stats based on logs/uptime
    // Here we can fetch number of errors, up time, etc.
    const activeSince = await prisma.streamLog.findFirst({
      where: { message: { contains: 'Starting stream engine' } },
      orderBy: { createdAt: 'desc' }
    });

    const errorCount = await prisma.streamLog.count({
      where: {
        level: 'ERROR',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // past 24h
      }
    });

    return {
      uptimeSince: activeSince?.createdAt || null,
      errors24h: errorCount,
      successRate: errorCount === 0 ? 100 : Math.max(50, 100 - (errorCount * 2))
    };
  });

  // WebSocket for real-time status and logs
  // Handled by @fastify/websocket
  fastify.get('/live-stats', { websocket: true }, (connection, req) => {
    let intervalId: NodeJS.Timeout;

    // Send immediately on connect
    sendStatusAndLogs();

    // Poll every 1 second
    intervalId = setInterval(sendStatusAndLogs, 1000);

    async function sendStatusAndLogs() {
      try {
        const activeProject = await prisma.project.findFirst({ where: { isActive: true } });
        let workerStatus: any = {
          isActive: false,
          workerOnline: false,
          projectId: activeProject?.id || null,
          currentVideo: null,
          nextVideo: null,
          bitrate: 0,
          fps: 0,
          elapsed: 0,
          duration: 0,
          preset: activeProject?.preset || 'COPY'
        };

        try {
          const res = await fetch(`${workerUrl}/status`);
          if (res.ok) {
            workerStatus = await res.json();
            workerStatus.workerOnline = true;
          }
        } catch (err) {
          // Worker offline
        }

        // Fetch recent logs
        const logs = await prisma.streamLog.findMany({
          take: 30,
          orderBy: { createdAt: 'desc' }
        });

        connection.socket.send(JSON.stringify({
          type: 'update',
          status: workerStatus,
          logs: logs.reverse()
        }));
      } catch (err: any) {
        console.error('Error sending WS update:', err.message);
      }
    }

    connection.socket.on('close', () => {
      clearInterval(intervalId);
    });
  });
}
