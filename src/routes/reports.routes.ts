/**
 * Reports Routes
 * API endpoints for report generation and analytics
 */

import { Router } from 'express';
import { authenticate, requireReportsAccess } from '../middleware';
import {
  getAnalytics,
  getChartData,
  getMonthlyTrends,
  getViolationTypes,
  getPenaltyComparison,
  getCaseStatus,
  getDistrictComparison,
} from '../controllers/reports.controller';

const router = Router();

// All routes require authentication and admin/member role
router.use(authenticate);
router.use(requireReportsAccess);

// Analytics summary
router.get('/analytics', getAnalytics);

// All chart data in one call
router.get('/charts', getChartData);

// Individual chart endpoints
router.get('/monthly-trends', getMonthlyTrends);
router.get('/violation-types', getViolationTypes);
router.get('/penalty-comparison', getPenaltyComparison);
router.get('/case-status', getCaseStatus);
router.get('/district-comparison', getDistrictComparison);

export default router;
