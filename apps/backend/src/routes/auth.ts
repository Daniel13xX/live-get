import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../services/db.js';

export async function authRoutes(fastify: FastifyInstance) {
  // Login Route
  fastify.post('/login', async (request, reply) => {
    const { username, password } = request.body as any;

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign({ id: user.id, username: user.username });
    return { token, user: { id: user.id, username: user.username } };
  });

  // Me Route (Protected)
  fastify.get('/me', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    return { user: request.user };
  });
}
