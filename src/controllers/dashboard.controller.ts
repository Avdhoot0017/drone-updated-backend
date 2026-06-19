/**
 * Dashboard Controller
 * Handles all dashboard-related request/response logic
 */

import { Response } from 'express';
import { dashboardService, syncService } from '../services';
import { prisma } from '../config/database';
import { AuthenticatedRequest, ObservationFilters } from '../types';

/**
 * Helper to parse filters from query parameters
 */
function parseFilters(query: Record<string, unknown>): ObservationFilters {
  const filters: ObservationFilters = {};

  if (query.startDate) {
    filters.startDate = new Date(query.startDate as string);
  }
  if (query.endDate) {
    filters.endDate = new Date(query.endDate as string);
  }
  if (query.enforcementAreaId) {
    filters.enforcementAreaId = query.enforcementAreaId as string;
  }
  if (query.flyingLocationId) {
    filters.flyingLocationId = query.flyingLocationId as string;
  }
  if (query.violationTypeId) {
    filters.violationTypeId = query.violationTypeId as string;
  }
  if (query.status) {
    filters.status = query.status as string;
  }
  if (query.search) {
    filters.search = query.search as string;
  }

  return filters;
}

/**
 * GET /dashboard/stats
 */
export const getStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const filters = parseFilters(req.query);
  const stats = await dashboardService.getStats(filters);

  res.json({
    success: true,
    data: stats,
  });
};

/**
 * GET /dashboard/trends
 */
export const getTrends = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const days = (req.query.days as unknown as number) || 30;
  const filters = parseFilters(req.query);
  const trends = await dashboardService.getTrends(days, filters);

  res.json({
    success: true,
    data: trends,
  });
};

/**
 * GET /dashboard/regions
 */
export const getRegions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const filters = parseFilters(req.query);
  const regions = await dashboardService.getRegionStats(filters);

  res.json({
    success: true,
    data: regions,
  });
};

/**
 * GET /dashboard/violations
 */
export const getViolations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const filters = parseFilters(req.query);
  const violations = await dashboardService.getViolationStats(filters);

  res.json({
    success: true,
    data: violations,
  });
};

/**
 * GET /dashboard/vessel-types
 */
export const getVesselTypes = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const filters = parseFilters(req.query);
  const vesselTypes = await dashboardService.getVesselTypeStats(filters);

  res.json({
    success: true,
    data: vesselTypes,
  });
};

/**
 * GET /dashboard/monthly
 */
export const getMonthly = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const months = (req.query.months as unknown as number) || 6;
  const data = await dashboardService.getMonthlyComparison(months);

  res.json({
    success: true,
    data,
  });
};

/**
 * GET /dashboard/top-offenders
 */
export const getTopOffenders = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const limit = (req.query.limit as unknown as number) || 10;
  const data = await dashboardService.getTopOffenders(limit);

  res.json({
    success: true,
    data,
  });
};

/**
 * GET /dashboard/observations
 */
export const getObservations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const page = (req.query.page as unknown as number) || 1;
  const limit = (req.query.limit as unknown as number) || 20;
  const filters = parseFilters(req.query);

  const result = await dashboardService.getObservations(filters, page, limit);

  res.json({
    success: true,
    ...result,
  });
};

/**
 * GET /dashboard/heatmap
 */
export const getHeatmap = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const filters = parseFilters(req.query);
  const data = await dashboardService.getHourlyDistribution(filters);

  res.json({
    success: true,
    data,
  });
};

/**
 * GET /dashboard/distance
 */
export const getDistanceAnalysis = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const filters = parseFilters(req.query);
  const data = await dashboardService.getDistanceDistribution(filters);

  res.json({
    success: true,
    data,
  });
};

/**
 * GET /dashboard/distance/by-district
 */
export const getDistanceByDistrict = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const filters = parseFilters(req.query);
  const data = await dashboardService.getDistanceDistributionByDistrict(filters);

  res.json({
    success: true,
    data,
  });
};

/**
 * GET /dashboard/sync-info
 */
export const getSyncInfo = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const syncInfo = await syncService.getLastSyncInfo();

  res.json({
    success: true,
    data: syncInfo,
  });
};

/**
 * GET /dashboard/filters
 */
export const getFilters = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const [enforcementAreas, flyingLocations, violationTypes, vesselTypes] =
    await Promise.all([
      prisma.enforcementArea.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.flyingLocation.findMany({
        where: { isActive: true },
        select: { id: true, name: true, enforcementAreaId: true },
        orderBy: { name: 'asc' },
      }),
      prisma.violationType.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.vesselType.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

  res.json({
    success: true,
    data: {
      enforcementAreas,
      flyingLocations,
      violationTypes,
      vesselTypes,
      statuses: [
        { value: 'reported', label: 'Reported' },
        { value: 'under_review', label: 'Under Review' },
        { value: 'action_pending', label: 'Action Pending' },
        { value: 'action_taken', label: 'Action Taken' },
        { value: 'disposed', label: 'Disposed' },
        { value: 'no_violation', label: 'No Violation' },
      ],
    },
  });
};
