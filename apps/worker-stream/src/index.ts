import fastify from 'fastify';
import { streamEngine } from './stream-engine.js';

const app = fastify({ logger: true });

// Control streaming: start, stop, skip
app.post('/control', async (request, reply) => {
  const { action } = request.body as { action: 'start' | 'stop' | 'skip' };

  if (!action || !['start', 'stop', 'skip'].includes(action)) {
    return reply.status(400).send({ error: 'Valid action (start, stop, skip) is required.' });
  }

  try {
    if (action === 'start') {
      await streamEngine.start();
    } else if (action === 'stop') {
      await streamEngine.stop();
    } else if (action === 'skip') {
      await streamEngine.skip();
    }

    return { success: true };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({ error: `Failed to execute control action: ${err.message}` });
  }
});

// Get real-time stats
app.get('/status', async () => {
  return streamEngine.getStats();
});

// Health check
app.get('/health', async () => {
  return { status: 'OK', service: 'worker-stream' };
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '5001', 10);
    
    // Listen on 0.0.0.0 for Docker networking compatibility
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Worker stream service listening on port ${port}`);

    // Auto-resume stream if server rebooted while stream was active
    await streamEngine.autoResume();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
