/**
 * Sync Routes
 * Clean route definitions - all logic handled by controllers
 */

import { Router } from 'express';
import { syncController } from '../controllers';
import { authenticate, asyncHandler } from '../middleware';

const router = Router();

// POST /sync/run - Manually trigger sync (any authenticated user)
router.post('/run', authenticate, asyncHandler(syncController.runSync));

// GET /sync/status - Get sync status and history
router.get('/status', authenticate, asyncHandler(syncController.getStatus));

// GET /sync/batch/:id - Get details of a specific sync batch
router.get('/batch/:id', authenticate, asyncHandler(syncController.getBatchDetails));

// GET /sync/sheet-info - Get Google Sheet metadata
router.get('/sheet-info', authenticate, asyncHandler(syncController.getSheetInfo));

// GET /sync/config - Get sync configuration (any authenticated user)
router.get('/config', authenticate, asyncHandler(syncController.getConfig));

export default router;
