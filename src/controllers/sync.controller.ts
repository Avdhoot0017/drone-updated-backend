/**
 * Sync Controller
 * Handles all sync-related request/response logic
 */

import { Response } from 'express';
import { syncService, googleSheetsService } from '../services';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AuthenticatedRequest } from '../types';

/**
 * POST /sync/run
 * @body cleanupStale - If true, removes records from DB that are no longer in the sheet
 */
export const runSync = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { cleanupStale = true } = req.body || {};  // Default to true for auto-cleanup

  const result = await syncService.runSync('manual', req.user!.id, cleanupStale);

  res.json({
    success: true,
    message: cleanupStale ? 'Sync completed with stale cleanup' : 'Sync completed',
    data: result,
  });
};

/**
 * GET /sync/status
 */
export const getStatus = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const [syncInfo, recentBatches] = await Promise.all([
    syncService.getLastSyncInfo(),
    prisma.syncBatch.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: {
        triggeredByUser: {
          select: { fullName: true },
        },
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      ...syncInfo,
      recentBatches: recentBatches.map((batch) => ({
        id: batch.id,
        startedAt: batch.startedAt,
        completedAt: batch.completedAt,
        status: batch.status,
        durationMs: batch.durationMs,
        totalRowsScanned: batch.totalRowsScanned,
        newRecordsAdded: batch.newRecordsAdded,
        duplicateRecords: batch.duplicateRecords,
        errorRecords: batch.errorRecords,
        triggeredBy: batch.triggeredBy,
        triggeredByUser: batch.triggeredByUser?.fullName,
        errorMessage: batch.errorMessage,
      })),
    },
  });
};

/**
 * GET /sync/batch/:id
 */
export const getBatchDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const batch = await prisma.syncBatch.findUnique({
    where: { id },
    include: {
      triggeredByUser: {
        select: { fullName: true },
      },
      syncRecords: {
        take: 100,
        orderBy: { processedAt: 'desc' },
      },
    },
  });

  if (!batch) {
    res.status(404).json({
      success: false,
      error: 'Sync batch not found',
    });
    return;
  }

  res.json({
    success: true,
    data: batch,
  });
};

/**
 * GET /sync/sheet-info
 */
export const getSheetInfo = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const metadata = await googleSheetsService.getSheetMetadata(env.googleSheetId);
  const tabs = await googleSheetsService.getSheetTabs(env.googleSheetId);

  const config = await prisma.googleSheetConfig.findUnique({
    where: { sheetId: env.googleSheetId },
    include: { tabs: true },
  });

  res.json({
    success: true,
    data: {
      title: metadata.title,
      lastModifiedTime: metadata.lastModifiedTime,
      sheetId: env.googleSheetId,
      tabs,
      config: config
        ? {
            lastSyncAt: config.lastSyncAt,
            syncEnabled: config.syncEnabled,
            syncSchedule: config.syncSchedule,
          }
        : null,
    },
  });
};

/**
 * GET /sync/config
 */
export const getConfig = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const config = await prisma.googleSheetConfig.findUnique({
    where: { sheetId: env.googleSheetId },
    include: {
      tabs: {
        include: {
          enforcementArea: true,
        },
      },
    },
  });

  res.json({
    success: true,
    data: {
      sheetId: env.googleSheetId,
      syncSchedule: env.syncCronSchedule,
      syncEnabled: env.syncEnabled,
      timezone: env.timezone,
      config,
    },
  });
};
