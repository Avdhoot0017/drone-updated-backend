import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';

// Create Prisma client with logging in development
export const prisma = new PrismaClient({
  log: env.isDevelopment
    ? [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ]
    : [{ level: 'error', emit: 'stdout' }],
});

// Log queries in development
if (env.isDevelopment) {
  prisma.$on('query' as never, (e: { query: string; duration: number }) => {
    logger.debug(`Query: ${e.query}`);
    logger.debug(`Duration: ${e.duration}ms`);
  });
}

// Track connection state to prevent multiple disconnects
let isDisconnected = false;

// Connection handling
export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    isDisconnected = false;
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    process.exit(1);
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (isDisconnected) return;
  isDisconnected = true;
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

// Graceful shutdown - only on SIGINT/SIGTERM, not beforeExit
process.on('SIGINT', async () => {
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await disconnectDatabase();
  process.exit(0);
});
