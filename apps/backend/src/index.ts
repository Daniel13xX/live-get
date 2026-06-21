import fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

import { prisma } from './services/db.js';
import { authRoutes } from './routes/auth.js';
import { videoRoutes } from './routes/videos.js';
import { projectRoutes } from './routes/projects.js';
import { settingsRoutes } from './routes/settings.js';
import { streamRoutes } from './routes/stream.js';

// Load env variables
dotenv.config();

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

const app = fastify({ logger: true });

// Register CORS
app.register(cors, {
  origin: '*', // In production, replace with specific domain
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
});

// Register JWT
app.register(jwt, {
  secret: process.env.JWT_SECRET || 'supersecretjwtkey123!'
});

// Register Multipart for uploads
app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 1024 * 2 // 2GB Max size limit
  }
});

// Register Websocket
app.register(websocket);

// Setup static directories and serving
const storageDir = process.env.STORAGE_DIR 
  ? path.resolve(process.env.STORAGE_DIR) 
  : path.join(process.cwd(), '..', '..', 'storage');
const transcodedDir = path.join(storageDir, 'videos', 'transcoded');
const thumbnailDir = path.join(storageDir, 'thumbnails');

fs.mkdirSync(transcodedDir, { recursive: true });
fs.mkdirSync(thumbnailDir, { recursive: true });

app.register(fastifyStatic, {
  root: transcodedDir,
  prefix: '/api/videos/static/',
  decorateReply: false
});

app.register(fastifyStatic, {
  root: thumbnailDir,
  prefix: '/api/projects/static/thumbnails/',
  decorateReply: false
});

// Authenticate decorator
app.decorate('authenticate', async (request: any, reply: any) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
});

// Register API Routes
app.register(async (api) => {
  api.register(authRoutes, { prefix: '/auth' });
  api.register(videoRoutes, { prefix: '/videos' });
  api.register(projectRoutes, { prefix: '/projects' });
  api.register(settingsRoutes, { prefix: '/settings' });
  api.register(streamRoutes, { prefix: '/stream' });
}, { prefix: '/api' });

// Health check
app.get('/health', async () => {
  return { status: 'OK', service: 'backend' };
});

// Seed default data & start server
const start = async () => {
  try {
    // Run DB checks/seeds
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      const adminPassword = process.env.ADMIN_PASSWORD || 'adminpassword123';
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await prisma.user.create({
        data: {
          username: adminUsername,
          password: hashedPassword
        }
      });
      app.log.info(`Seeded default admin user: ${adminUsername}`);
    }

    const settingsCount = await prisma.streamSettings.count();
    if (settingsCount === 0) {
      await prisma.streamSettings.create({
        data: {
          id: 'singleton',
          rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
          streamKey: '',
          preset: 'COPY',
          isActive: false
        }
      });
      app.log.info('Seeded default stream settings');
    }

    // Clean any residual stream settings isActive flag on boot
    await prisma.streamSettings.updateMany({
      where: { id: 'singleton' },
      data: { isActive: false }
    });

    const port = parseInt(process.env.PORT || '5000', 10);
    // Listen on 0.0.0.0 for Docker environment compatibility
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Backend server listening on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
