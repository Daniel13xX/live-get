import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import { prisma } from '../services/db.js';

export async function projectRoutes(fastify: FastifyInstance) {
  // Apply auth to all project routes
  fastify.addHook('onRequest', fastify.authenticate);

  const storageDir = process.env.STORAGE_DIR 
    ? path.resolve(process.env.STORAGE_DIR) 
    : path.join(process.cwd(), '..', '..', 'storage');
  const thumbnailDir = path.join(storageDir, 'thumbnails');
  fs.mkdirSync(thumbnailDir, { recursive: true });

  // List all projects
  fastify.get('/', async (request, reply) => {
    const projects = await prisma.project.findMany({
      include: {
        projectVideos: {
          orderBy: { position: 'asc' },
          include: { video: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return projects;
  });

  // Get single project
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as any;
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        projectVideos: {
          orderBy: { position: 'asc' },
          include: { video: true }
        }
      }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return project;
  });

  // Create project
  fastify.post('/', async (request, reply) => {
    const { name, mode, externalUrl, rtmpUrl, streamKey, preset } = request.body as any;

    if (!name || name.trim() === '') {
      return reply.status(400).send({ error: 'Project name is required' });
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        mode: mode || 'LOCAL',
        externalUrl: externalUrl || null,
        rtmpUrl: rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2',
        streamKey: streamKey || '',
        preset: preset || 'COPY',
        isActive: false
      }
    });

    return project;
  });

  // Update project (name, mode, externalUrl, preset, rtmpUrl, streamKey, isActive)
  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as any;
    const { name, mode, externalUrl, preset, rtmpUrl, streamKey, isActive } = request.body as any;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (mode !== undefined) updateData.mode = mode;
    if (externalUrl !== undefined) updateData.externalUrl = externalUrl;
    if (preset !== undefined) updateData.preset = preset;
    if (rtmpUrl !== undefined) updateData.rtmpUrl = rtmpUrl.trim();
    if (streamKey !== undefined) updateData.streamKey = streamKey.trim();
    if (isActive !== undefined) updateData.isActive = isActive;

    // If setting active, deactivate all other projects
    if (isActive === true) {
      await prisma.project.updateMany({
        where: { id: { not: id } },
        data: { isActive: false }
      });
    }

    const updated = await prisma.project.update({
      where: { id },
      data: updateData
    });

    return updated;
  });

  // Delete project
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as any;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Delete thumbnail file if exists
    if (project.thumbnail) {
      const filename = path.basename(project.thumbnail);
      const filePath = path.join(thumbnailDir, filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error(`Failed to delete thumbnail file ${filePath}:`, err);
        }
      }
    }

    await prisma.project.delete({ where: { id } });
    return { success: true };
  });

  // Set / reorder videos in project
  fastify.post('/:id/videos', async (request, reply) => {
    const { id } = request.params as any;
    const { videoIds } = request.body as any; // Array of video IDs in order

    if (!Array.isArray(videoIds)) {
      return reply.status(400).send({ error: 'videoIds must be an array of string IDs' });
    }

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Wrap in a transaction to guarantee atomicity
    await prisma.$transaction(async (tx) => {
      // Clear current videos in project
      await tx.projectVideo.deleteMany({
        where: { projectId: id }
      });

      // Insert new ordered associations
      const records = videoIds.map((videoId, index) => ({
        projectId: id,
        videoId,
        position: index
      }));

      if (records.length > 0) {
        await tx.projectVideo.createMany({
          data: records
        });
      }
    });

    // Return the updated project
    const updatedProject = await prisma.project.findUnique({
      where: { id },
      include: {
        projectVideos: {
          orderBy: { position: 'asc' },
          include: { video: true }
        }
      }
    });

    return updatedProject;
  });

  // Upload thumbnail for project
  fastify.post('/:id/thumbnail', async (request, reply) => {
    const { id } = request.params as any;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Multipart request expected' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const originalName = data.filename;
    const extension = path.extname(originalName).toLowerCase();

    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
      return reply.status(400).send({ error: 'Unsupported image format. Only JPG, JPEG, PNG, and WEBP are supported.' });
    }

    const imageId = crypto.randomUUID();
    const safeFilename = `${imageId}${extension}`;
    const destinationPath = path.join(thumbnailDir, safeFilename);

    try {
      // Delete old thumbnail file if exists
      if (project.thumbnail) {
        const oldFilename = path.basename(project.thumbnail);
        const oldFilePath = path.join(thumbnailDir, oldFilename);
        if (fs.existsSync(oldFilePath)) {
          try {
            fs.unlinkSync(oldFilePath);
          } catch (err) {}
        }
      }

      // Stream new thumbnail to disk
      await pipeline(data.file, fs.createWriteStream(destinationPath));

      // Relative web path or static URL path
      const thumbnailWebPath = `/api/projects/static/thumbnails/${safeFilename}`;

      const updated = await prisma.project.update({
        where: { id },
        data: { thumbnail: thumbnailWebPath }
      });

      return updated;
    } catch (err: any) {
      console.error('Thumbnail upload failed:', err);
      if (fs.existsSync(destinationPath)) {
        fs.unlinkSync(destinationPath);
      }
      return reply.status(500).send({ error: `Thumbnail upload failed: ${err.message}` });
    }
  });
}
