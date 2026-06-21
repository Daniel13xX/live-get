import { PrismaClient } from '@prisma/client';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export const prisma = new PrismaClient();
