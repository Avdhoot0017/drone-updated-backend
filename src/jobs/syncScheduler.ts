import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { syncService } from '../services';

/**
 * Start the sync scheduler
 */
export function startSyncScheduler(): void {
  if (!env.syncEnabled) {
    logger.info('Sync scheduler is disabled');
    return;
  }

  logger.info(`Starting sync scheduler with schedule: ${env.syncCronSchedule}`);
  logger.info(`Timezone: ${env.timezone}`);

  // Validate cron expression
  if (!cron.validate(env.syncCronSchedule)) {
    logger.error(`Invalid cron expression: ${env.syncCronSchedule}`);
    return;
  }

  // Schedule the sync job
  cron.schedule(
    env.syncCronSchedule,
    async () => {
      logger.info('Starting scheduled sync...');

      try {
        const result = await syncService.runSync('scheduled');

        logger.info('Scheduled sync completed:', {
          newRecords: result.newRecords,
          updatedRecords: result.updatedRecords,
          unchangedRecords: result.unchangedRecords,
          errors: result.errors,
        });
      } catch (error) {
        logger.error('Scheduled sync failed:', error);
      }
    },
    {
      scheduled: true,
      timezone: env.timezone,
    }
  );

  logger.info('Sync scheduler started successfully');
}

/**
 * Get next scheduled sync time
 */
export function getNextSyncTime(): Date | null {
  try {
    const interval = cron.schedule(env.syncCronSchedule, () => {}, {
      scheduled: false,
      timezone: env.timezone,
    });

    // This is a workaround - node-cron doesn't expose next run time directly
    // We'll calculate it manually based on the schedule
    const [minute, hour] = env.syncCronSchedule.split(' ');

    const now = new Date();
    const next = new Date();

    next.setHours(parseInt(hour, 10) || 20);
    next.setMinutes(parseInt(minute, 10) || 0);
    next.setSeconds(0);
    next.setMilliseconds(0);

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  } catch {
    return null;
  }
}
