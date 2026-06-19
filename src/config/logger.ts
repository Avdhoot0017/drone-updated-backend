import winston from 'winston';
import path from 'path';
import { env } from './env';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat
    ),
  }),
];

// Add file transports in production
if (env.isProduction) {
  transports.push(
    new winston.transports.File({
      filename: path.join(env.logFilePath, 'error.log'),
      level: 'error',
      format: logFormat,
    }),
    new winston.transports.File({
      filename: path.join(env.logFilePath, 'combined.log'),
      format: logFormat,
    })
  );
}

// Add sync-specific log file
transports.push(
  new winston.transports.File({
    filename: path.join(env.logFilePath, 'sync.log'),
    level: 'info',
    format: logFormat,
  })
);

export const logger = winston.createLogger({
  level: env.logLevel,
  format: logFormat,
  transports,
  exitOnError: false,
});

// Create a child logger for sync operations
export const syncLogger = logger.child({ service: 'sync' });
