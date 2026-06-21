import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';

export async function playlistRoutes(fastify: FastifyInstance) {
  // Apply auth to all playlist routes
  fastify.addHook('onRequest', fastify.authenticate);

  // List all playlists
  fastify.get('/', async (request, reply) => {
    const playlists = await prisma.playlist.findMany({
      include: {
        playlistVideos: {
          orderBy: { position: 'asc' },
          include: { video: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return playlists;
  });

  // Get single playlist
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as any;
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        playlistVideos: {
          orderBy: { position: 'asc' },
          include: { video: true }
        }
      }
    });

    if (!playlist) {
      return reply.status(404).send({ error: 'Playlist not found' });
    }

    return playlist;
  });

  // Create playlist
  fastify.post('/', async (request, reply) => {
    const { name, mode } = request.body as any;

    if (!name || name.trim() === '') {
      return reply.status(400).send({ error: 'Playlist name is required' });
    }

    const playlist = await prisma.playlist.create({
      data: {
        name: name.trim(),
        mode: mode || 'SEQUENTIAL',
        isActive: false
      }
    });

    return playlist;
  });

  // Update playlist (name, mode, isActive)
  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as any;
    const { name, mode, isActive } = request.body as any;

    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist) {
      return reply.status(404).send({ error: 'Playlist not found' });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (mode !== undefined) updateData.mode = mode;
    if (isActive !== undefined) updateData.isActive = isActive;

    // If setting active, deactivate all other playlists
    if (isActive === true) {
      await prisma.playlist.updateMany({
        where: { id: { not: id } },
        data: { isActive: false }
      });
    }

    const updated = await prisma.playlist.update({
      where: { id },
      data: updateData
    });

    return updated;
  });

  // Delete playlist
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as any;

    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist) {
      return reply.status(404).send({ error: 'Playlist not found' });
    }

    await prisma.playlist.delete({ where: { id } });
    return { success: true };
  });

  // Set / reorder videos in playlist
  fastify.post('/:id/videos', async (request, reply) => {
    const { id } = request.params as any;
    const { videoIds } = request.body as any; // Array of video IDs in order

    if (!Array.isArray(videoIds)) {
      return reply.status(400).send({ error: 'videoIds must be an array of string IDs' });
    }

    const playlist = await prisma.playlist.findUnique({ where: { id } });
    if (!playlist) {
      return reply.status(404).send({ error: 'Playlist not found' });
    }

    // Wrap in a transaction to guarantee atomicity
    await prisma.$transaction(async (tx) => {
      // Clear current videos in playlist
      await tx.playlistVideo.deleteMany({
        where: { playlistId: id }
      });

      // Insert new ordered associations
      const records = videoIds.map((videoId, index) => ({
        playlistId: id,
        videoId,
        position: index
      }));

      if (records.length > 0) {
        await tx.playlistVideo.createMany({
          data: records
        });
      }
    });

    // Return the updated playlist
    const updatedPlaylist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        playlistVideos: {
          orderBy: { position: 'asc' },
          include: { video: true }
        }
      }
    });

    return updatedPlaylist;
  });
}
