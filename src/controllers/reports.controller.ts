/**
 * Reports Controller
 * Handles report generation and analytics API endpoints
 */

import { Request, Response } from 'express';
import { reportsService, ReportFilters } from '../services/reports.service';
import { logger } from '../config/logger';

/**
 * Parse filter parameters from request query
 */
function parseFilters(query: Request['query']): ReportFilters {
  const filters: ReportFilters = {};

  if (query.startDate && typeof query.startDate === 'string') {
    filters.startDate = new Date(query.startDate);
  }

  if (query.endDate && typeof query.endDate === 'string') {
    filters.endDate = new Date(query.endDate);
  }

  if (query.enforcementAreaId && typeof query.enforcementAreaId === 'string') {
    filters.enforcementAreaId = query.enforcementAreaId;
  }

  if (query.year && typeof query.year === 'string') {
    filters.year = parseInt(query.year, 10);
  }

  if (query.month && typeof query.month === 'string') {
    filters.month = parseInt(query.month, 10);
  }

  return filters;
}

/**
 * Get analytics summary
 * GET /api/v1/reports/analytics
 */
export const getAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = parseFilters(req.query);
    const summary = await reportsService.getAnalyticsSummary(filters);

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics data',
    });
  }
};

/**
 * Get all chart data
 * GET /api/v1/reports/charts
 */
export const getChartData = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = parseFilters(req.query);
    const chartData = await reportsService.getChartData(filters);

    res.json({
      success: true,
      data: chartData,
    });
  } catch (error) {
    logger.error('Error fetching chart data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chart data',
    });
  }
};

/**
 * Get monthly trends
 * GET /api/v1/reports/monthly-trends
 */
export const getMonthlyTrends = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = parseFilters(req.query);
    const trends = await reportsService.getMonthlyTrends(filters);

    res.json({
      success: true,
      data: trends,
    });
  } catch (error) {
    logger.error('Error fetching monthly trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch monthly trends',
    });
  }
};

/**
 * Get violation type distribution
 * GET /api/v1/reports/violation-types
 */
export const getViolationTypes = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = parseFilters(req.query);
    const distribution = await reportsService.getViolationTypeDistribution(filters);

    res.json({
      success: true,
      data: distribution,
    });
  } catch (error) {
    logger.error('Error fetching violation types:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch violation type distribution',
    });
  }
};

/**
 * Get penalty comparison
 * GET /api/v1/reports/penalty-comparison
 */
export const getPenaltyComparison = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = parseFilters(req.query);
    const comparison = await reportsService.getPenaltyComparison(filters);

    res.json({
      success: true,
      data: comparison,
    });
  } catch (error) {
    logger.error('Error fetching penalty comparison:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch penalty comparison',
    });
  }
};

/**
 * Get case status distribution
 * GET /api/v1/reports/case-status
 */
export const getCaseStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = parseFilters(req.query);
    const distribution = await reportsService.getCaseStatusDistribution(filters);

    res.json({
      success: true,
      data: distribution,
    });
  } catch (error) {
    logger.error('Error fetching case status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch case status distribution',
    });
  }
};

/**
 * Get district-wise comparison
 * GET /api/v1/reports/district-comparison
 */
export const getDistrictComparison = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = parseFilters(req.query);
    const comparison = await reportsService.getDistrictWiseComparison(filters);

    res.json({
      success: true,
      data: comparison,
    });
  } catch (error) {
    logger.error('Error fetching district comparison:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch district comparison',
    });
  }
};
