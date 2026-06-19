/**
 * Manual sync runner script
 * Run with: npm run sync:manual
 */

import { config } from 'dotenv';
config();

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { syncService } from '../services';

async function main() {
  logger.info('Starting manual sync...');

  try {
    await connectDatabase();

    const result = await syncService.runSync('manual');

    logger.info('Manual sync completed:', {
      totalRows: result.totalRows,
      newRecords: result.newRecords,
      updatedRecords: result.updatedRecords,
      unchangedRecords: result.unchangedRecords,
      errors: result.errors,
    });

    if (result.errorDetails.length > 0) {
      logger.warn('Errors encountered:');
      result.errorDetails.forEach((error) => {
        logger.warn(`  Row ${error.row}: ${error.error}`);
      });
    }

    process.exit(0);
  } catch (error) {
    logger.error('Manual sync failed:', error);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

main();
