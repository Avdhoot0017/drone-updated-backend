/**
 * Dashboard Routes
 * Clean route definitions - all logic handled by controllers
 */

import { Router } from 'express';
import { query } from 'express-validator';
import { dashboardController } from '../controllers';
import { authenticate, asyncHandler } from '../middleware';

const router = Router();

// GET /dashboard/stats - Get dashboard summary statistics
router.get('/stats', authenticate, asyncHandler(dashboardController.getStats));

// GET /dashboard/trends - Get trend data for charts
router.get(
  '/trends',
  authenticate,
  [query('days').optional().isInt({ min: 7, max: 365 }).toInt()],
  asyncHandler(dashboardController.getTrends)
);

// GET /dashboard/regions - Get statistics by region
router.get('/regions', authenticate, asyncHandler(dashboardController.getRegions));

// GET /dashboard/violations - Get statistics by violation type
router.get('/violations', authenticate, asyncHandler(dashboardController.getViolations));

// GET /dashboard/vessel-types - Get statistics by vessel type
router.get('/vessel-types', authenticate, asyncHandler(dashboardController.getVesselTypes));

// GET /dashboard/monthly - Get monthly comparison data
router.get(
  '/monthly',
  authenticate,
  [query('months').optional().isInt({ min: 3, max: 24 }).toInt()],
  asyncHandler(dashboardController.getMonthly)
);

// GET /dashboard/top-offenders - Get top offending vessels
router.get(
  '/top-offenders',
  authenticate,
  [query('limit').optional().isInt({ min: 5, max: 50 }).toInt()],
  asyncHandler(dashboardController.getTopOffenders)
);

// GET /dashboard/observations - Get observations list with filters and pagination
router.get(
  '/observations',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  asyncHandler(dashboardController.getObservations)
);

// GET /dashboard/heatmap - Get hourly distribution for heatmap
router.get('/heatmap', authenticate, asyncHandler(dashboardController.getHeatmap));

// GET /dashboard/distance - Get distance from coast distribution
router.get('/distance', authenticate, asyncHandler(dashboardController.getDistanceAnalysis));

// GET /dashboard/distance/by-district - Get distance distribution by district
router.get('/distance/by-district', authenticate, asyncHandler(dashboardController.getDistanceByDistrict));

// GET /dashboard/sync-info - Get last sync information
router.get('/sync-info', authenticate, asyncHandler(dashboardController.getSyncInfo));

// GET /dashboard/filters - Get available filter options
router.get('/filters', authenticate, asyncHandler(dashboardController.getFilters));

export default router;
