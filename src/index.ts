/**
 * Drone Surveillance Dashboard - Backend API
 * Main entry point
 */

import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';

import { env } from './config/env';
import { logger } from './config/logger';
import { connectDatabase } from './config/database';
import routes from './routes';
import { notFoundHandler, errorHandler } from './middleware';
import { startSyncScheduler } from './jobs/syncScheduler';

// Create Express app
const app: Application = express();

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Security headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMaxRequests,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Cookie parsing
app.use(cookieParser());

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Request logging
if (env.isDevelopment) {
  app.use(morgan('dev'));
} else {
  app.use(
    morgan('combined', {
      stream: {
        write: (message: string) => logger.info(message.trim()),
      },
    })
  );
}

// =============================================================================
// ROUTES
// =============================================================================

// API routes
app.use(env.apiPrefix, routes);

// API base endpoint (for ELB health check)
app.get(env.apiPrefix, (_req, res) => {
  res.json({
    success: true,
    message: 'Drone Surveillance Dashboard API',
    status: 'healthy',
  });
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'Drone Surveillance Dashboard API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function startServer(): Promise<void> {
  try {
    // Connect to database
    await connectDatabase();

    // Start sync scheduler
    startSyncScheduler();

    // Start server
    app.listen(env.port, () => {
      logger.info(`
========================================
  Drone Surveillance Dashboard API
========================================
  Environment: ${env.nodeEnv}
  Port: ${env.port}
  API Prefix: ${env.apiPrefix}
  Timezone: ${env.timezone}
  Sync Schedule: ${env.syncCronSchedule}
  Sync Enabled: ${env.syncEnabled}
========================================
      `);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: Error) => {
  logger.error('Unhandled Rejection:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();

export default app;
