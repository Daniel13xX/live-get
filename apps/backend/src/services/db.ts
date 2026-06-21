import { PrismaClient } from '@prisma/client';

// Prevent BigInt serialization errors in JSON responses
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export const prisma = new PrismaClient();
