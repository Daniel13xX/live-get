import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import { prisma } from '../services/db.js';
import { transcodeVideo } from '../services/transcoder.js';

export async function videoRoutes(fastify: FastifyInstance) {
  // Apply auth to all video routes
  fastify.addHook('onRequest', fastify.authenticate);

  const storageDir = process.env.STORAGE_DIR 
    ? path.resolve(process.env.STORAGE_DIR) 
    : path.join(process.cwd(), '..', '..', 'storage');
  
  const originalDir = path.join(storageDir, 'videos', 'original');
  const transcodedDir = path.join(storageDir, 'videos', 'transcoded');

  // Ensure directories exist
  fs.mkdirSync(originalDir, { recursive: true });
  fs.mkdirSync(transcodedDir, { recursive: true });

  // List all videos
  fastify.get('/', async (request, reply) => {
    const videos = await prisma.video.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return videos;
  });

  // Upload video
  fastify.post('/upload', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Multipart request expected' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const originalName = data.filename;
    const extension = path.extname(originalName).toLowerCase();
    
    if (extension !== '.mp4' && extension !== '.mkv' && extension !== '.avi' && extension !== '.mov') {
      return reply.status(400).send({ error: 'Unsupported video format. Only MP4, MKV, AVI, and MOV are supported.' });
    }

    const videoId = crypto.randomUUID();
    const safeFilename = `${videoId}${extension}`;
    const transcodedFilename = `${videoId}.mp4`; // Always transcode to mp4
    
    const originalPath = path.join(originalDir, safeFilename);
    const transcodedPath = path.join(transcodedDir, transcodedFilename);

    try {
      // Stream file to disk
      await pipeline(data.file, fs.createWriteStream(originalPath));

      // Create video record in PENDING state
      const video = await prisma.video.create({
        data: {
          id: videoId,
          name: path.basename(originalName, extension),
          filename: transcodedFilename,
          filepath: transcodedPath,
          originalPath: originalPath,
          status: 'PENDING',
          size: fs.statSync(originalPath).size
        }
      });

      // Start transcoding in the background
      transcodeVideo(videoId).catch(err => {
        console.error(`Transcoding failed for video ${videoId}:`, err);
      });

      return reply.status(201).send(video);
    } catch (err: any) {
      console.error('Upload handling failed:', err);
      if (fs.existsSync(originalPath)) {
        fs.unlinkSync(originalPath);
      }
      return reply.status(500).send({ error: `Upload failed: ${err.message}` });
    }
  });

  // Rename video
  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as any;
    const { name } = request.body as any;

    if (!name || name.trim() === '') {
      return reply.status(400).send({ error: 'Name is required' });
    }

    const video = await prisma.video.findUnique({ where: { id } });
    if (!video) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    const updated = await prisma.video.update({
      where: { id },
      data: { name: name.trim() }
    });

    return updated;
  });

  // Delete video
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as any;

    const video = await prisma.video.findUnique({ where: { id } });
    if (!video) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    // Delete files
    if (video.filepath && fs.existsSync(video.filepath)) {
      try {
        fs.unlinkSync(video.filepath);
      } catch (err) {
        console.error(`Failed to delete transcoded file ${video.filepath}:`, err);
      }
    }

    if (video.originalPath && fs.existsSync(video.originalPath)) {
      try {
        fs.unlinkSync(video.originalPath);
      } catch (err) {
        console.error(`Failed to delete original file ${video.originalPath}:`, err);
      }
    }

    // Delete from DB
    await prisma.video.delete({ where: { id } });

    return { success: true };
  });
}
