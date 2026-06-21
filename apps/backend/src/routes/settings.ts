import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';

export async function settingsRoutes(fastify: FastifyInstance) {
  // Apply auth to all settings routes
  fastify.addHook('onRequest', fastify.authenticate);

  // Get settings
  fastify.get('/', async (request, reply) => {
    let settings = await prisma.streamSettings.findUnique({
      where: { id: 'singleton' }
    });

    if (!settings) {
      settings = await prisma.streamSettings.create({
        data: {
          id: 'singleton',
          rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
          streamKey: '',
          preset: 'COPY',
          isActive: false
        }
      });
    }

    // Mask stream key for security
    const responseSettings = { ...settings };
    if (responseSettings.streamKey && responseSettings.streamKey.length > 4) {
      responseSettings.streamKey = '********' + responseSettings.streamKey.slice(-4);
    }

    return responseSettings;
  });

  // Update settings
  fastify.patch('/', async (request, reply) => {
    const { rtmpUrl, streamKey, preset } = request.body as any;

    const data: any = {};
    if (rtmpUrl !== undefined) data.rtmpUrl = rtmpUrl;
    if (preset !== undefined) data.preset = preset;
    
    // Only update streamKey if it's not the masked value and not empty
    if (streamKey !== undefined && !streamKey.startsWith('********') && streamKey !== '') {
      data.streamKey = streamKey;
    }

    const updated = await prisma.streamSettings.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        rtmpUrl: rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2',
        streamKey: streamKey || '',
        preset: preset || 'COPY',
        isActive: false
      },
      update: data
    });

    // Mask stream key for security in response
    const responseSettings = { ...updated };
    if (responseSettings.streamKey && responseSettings.streamKey.length > 4) {
      responseSettings.streamKey = '********' + responseSettings.streamKey.slice(-4);
    }

    return responseSettings;
  });
}
