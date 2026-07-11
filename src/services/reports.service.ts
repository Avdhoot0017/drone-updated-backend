/**
 * Reports Service
 * Generates analytics and chart data for case reports
 */

import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { ObservationStatus } from '@prisma/client';

export interface ReportFilters {
  startDate?: Date;
  endDate?: Date;
  enforcementAreaId?: string;
  year?: number;
  month?: number;
}

export interface AnalyticsSummary {
  totalViolations: number;
  disposedCases: number;
  pendingCases: number;
  penaltyDetected: number;
  penaltyImposed: number;
  penaltyRecovered: number;
}

export interface MonthlyTrendData {
  month: string;
  violations: number;
  disposed: number;
  pending: number;
}

export interface ViolationTypeData {
  name: string;
  count: number;
  percentage: number;
}

export interface PenaltyComparisonData {
  category: string;
  detected: number;
  imposed: number;
  recovered: number;
}

export interface CaseStatusData {
  status: string;
  count: number;
  percentage: number;
}

class ReportsService {
  /**
   * Build date filter for queries
   */
  private buildDateFilter(filters: ReportFilters): { gte?: Date; lte?: Date } {
    const dateFilter: { gte?: Date; lte?: Date } = {};

    if (filters.startDate) {
      dateFilter.gte = filters.startDate;
    }

    if (filters.endDate) {
      dateFilter.lte = filters.endDate;
    }

    // If year and month are specified, override date range
    if (filters.year) {
      const year = filters.year;
      if (filters.month) {
        // Specific month
        dateFilter.gte = new Date(year, filters.month - 1, 1);
        dateFilter.lte = new Date(year, filters.month, 0, 23, 59, 59);
      } else {
        // Full year
        dateFilter.gte = new Date(year, 0, 1);
        dateFilter.lte = new Date(year, 11, 31, 23, 59, 59);
      }
    }

    return dateFilter;
  }

  /**
   * Get analytics summary for dashboard
   */
  async getAnalyticsSummary(filters: ReportFilters): Promise<AnalyticsSummary> {
    try {
      const dateFilter = this.buildDateFilter(filters);

      const whereClause: Record<string, unknown> = {};

      if (Object.keys(dateFilter).length > 0) {
        whereClause.observationDate = dateFilter;
      }

      if (filters.enforcementAreaId) {
        whereClause.enforcementAreaId = filters.enforcementAreaId;
      }

      // Get total violations (all observations/cases)
      const totalViolations = await prisma.observation.count({
        where: whereClause,
      });

      // Get disposed cases
      const disposedCases = await prisma.observation.count({
        where: {
          ...whereClause,
          status: ObservationStatus.disposed,
        },
      });

      // Get pending cases (not disposed)
      const pendingCases = await prisma.observation.count({
        where: {
          ...whereClause,
          status: {
            not: ObservationStatus.disposed,
          },
        },
      });

      // Get penalty aggregates from Observation model
      const observationPenalties = await prisma.observation.aggregate({
        where: whereClause,
        _sum: {
          detectedPenalty: true,
          penaltyAmount: true,
          paidPenaltyAmount: true,
        },
      });

      // Get penalty aggregates from Penalty model (for imposed and recovered)
      const penaltyAggregates = await prisma.penalty.aggregate({
        where: {
          observation: whereClause,
        },
        _sum: {
          penaltyImposed: true,
          penaltyRecovered: true,
        },
      });

      return {
        totalViolations,
        disposedCases,
        pendingCases,
        penaltyDetected: Number(observationPenalties._sum.detectedPenalty || observationPenalties._sum.penaltyAmount || 0),
        penaltyImposed: Number(penaltyAggregates._sum.penaltyImposed || 0),
        penaltyRecovered: Number(penaltyAggregates._sum.penaltyRecovered || observationPenalties._sum.paidPenaltyAmount || 0),
      };
    } catch (error) {
      logger.error('Error fetching analytics summary:', error);
      throw error;
    }
  }

  /**
   * Get monthly trend data for line chart
   */
  async getMonthlyTrends(filters: ReportFilters): Promise<MonthlyTrendData[]> {
    try {
      const year = filters.year || new Date().getFullYear();
      const results: MonthlyTrendData[] = [];

      const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];

      for (let month = 0; month < 12; month++) {
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0, 23, 59, 59);

        const whereClause: Record<string, unknown> = {
          observationDate: {
            gte: startDate,
            lte: endDate,
          },
        };

        if (filters.enforcementAreaId) {
          whereClause.enforcementAreaId = filters.enforcementAreaId;
        }

        const violations = await prisma.observation.count({
          where: whereClause,
        });

        const disposed = await prisma.observation.count({
          where: {
            ...whereClause,
            status: ObservationStatus.disposed,
          },
        });

        const pending = await prisma.observation.count({
          where: {
            ...whereClause,
            status: {
              not: ObservationStatus.disposed,
            },
          },
        });

        results.push({
          month: monthNames[month],
          violations,
          disposed,
          pending,
        });
      }

      return results;
    } catch (error) {
      logger.error('Error fetching monthly trends:', error);
      throw error;
    }
  }

  /**
   * Get violation type distribution for pie chart
   */
  async getViolationTypeDistribution(filters: ReportFilters): Promise<ViolationTypeData[]> {
    try {
      const dateFilter = this.buildDateFilter(filters);

      const whereClause: Record<string, unknown> = {
        violationTypeId: { not: null },
      };

      if (Object.keys(dateFilter).length > 0) {
        whereClause.observationDate = dateFilter;
      }

      if (filters.enforcementAreaId) {
        whereClause.enforcementAreaId = filters.enforcementAreaId;
      }

      const violationCounts = await prisma.observation.groupBy({
        by: ['violationTypeId'],
        where: whereClause,
        _count: {
          id: true,
        },
      });

      // Get violation type names
      const violationTypeIds = violationCounts
        .map((v: { violationTypeId: string | null }) => v.violationTypeId)
        .filter((id: string | null): id is string => id !== null);

      const violationTypes = await prisma.violationType.findMany({
        where: {
          id: { in: violationTypeIds },
        },
      });

      const violationTypeMap = new Map(violationTypes.map((v: { id: string; name: string }) => [v.id, v.name]));
      const total = violationCounts.reduce((sum: number, v: { _count: { id: number } }) => sum + v._count.id, 0);

      return violationCounts
        .filter((v: { violationTypeId: string | null }) => v.violationTypeId !== null)
        .map((v: { violationTypeId: string | null; _count: { id: number } }) => ({
          name: violationTypeMap.get(v.violationTypeId!) || 'Unknown',
          count: v._count.id,
          percentage: total > 0 ? Math.round((v._count.id / total) * 100) : 0,
        }))
        .sort((a: ViolationTypeData, b: ViolationTypeData) => b.count - a.count);
    } catch (error) {
      logger.error('Error fetching violation type distribution:', error);
      throw error;
    }
  }

  /**
   * Get penalty comparison data for bar chart
   */
  async getPenaltyComparison(filters: ReportFilters): Promise<PenaltyComparisonData[]> {
    try {
      const year = filters.year || new Date().getFullYear();
      const results: PenaltyComparisonData[] = [];

      // Get quarterly data
      const quarters = [
        { name: 'Q1', startMonth: 0, endMonth: 2 },
        { name: 'Q2', startMonth: 3, endMonth: 5 },
        { name: 'Q3', startMonth: 6, endMonth: 8 },
        { name: 'Q4', startMonth: 9, endMonth: 11 },
      ];

      for (const quarter of quarters) {
        const startDate = new Date(year, quarter.startMonth, 1);
        const endDate = new Date(year, quarter.endMonth + 1, 0, 23, 59, 59);

        const whereClause: Record<string, unknown> = {
          observationDate: {
            gte: startDate,
            lte: endDate,
          },
        };

        if (filters.enforcementAreaId) {
          whereClause.enforcementAreaId = filters.enforcementAreaId;
        }

        const observationAggregates = await prisma.observation.aggregate({
          where: whereClause,
          _sum: {
            detectedPenalty: true,
            paidPenaltyAmount: true,
          },
        });

        const penaltyAggregates = await prisma.penalty.aggregate({
          where: {
            observation: whereClause,
          },
          _sum: {
            penaltyImposed: true,
            penaltyRecovered: true,
          },
        });

        results.push({
          category: quarter.name,
          detected: Number(observationAggregates._sum.detectedPenalty || 0),
          imposed: Number(penaltyAggregates._sum.penaltyImposed || 0),
          recovered: Number(penaltyAggregates._sum.penaltyRecovered || observationAggregates._sum.paidPenaltyAmount || 0),
        });
      }

      return results;
    } catch (error) {
      logger.error('Error fetching penalty comparison:', error);
      throw error;
    }
  }

  /**
   * Get case status distribution for pie chart
   */
  async getCaseStatusDistribution(filters: ReportFilters): Promise<CaseStatusData[]> {
    try {
      const dateFilter = this.buildDateFilter(filters);

      const whereClause: Record<string, unknown> = {};

      if (Object.keys(dateFilter).length > 0) {
        whereClause.observationDate = dateFilter;
      }

      if (filters.enforcementAreaId) {
        whereClause.enforcementAreaId = filters.enforcementAreaId;
      }

      const statusCounts = await prisma.observation.groupBy({
        by: ['status'],
        where: whereClause,
        _count: {
          id: true,
        },
      });

      const total = statusCounts.reduce((sum: number, s: { _count: { id: number } }) => sum + s._count.id, 0);

      const statusLabels: Record<string, string> = {
        reported: 'Reported',
        under_review: 'Under Review',
        action_pending: 'Action Pending',
        action_taken: 'Action Taken',
        disposed: 'Disposed',
      };

      return statusCounts.map((s: { status: ObservationStatus; _count: { id: number } }) => ({
        status: statusLabels[s.status] || s.status,
        count: s._count.id,
        percentage: total > 0 ? Math.round((s._count.id / total) * 100) : 0,
      })).sort((a: CaseStatusData, b: CaseStatusData) => b.count - a.count);
    } catch (error) {
      logger.error('Error fetching case status distribution:', error);
      throw error;
    }
  }

  /**
   * Get district-wise comparison for bar chart
   */
  async getDistrictWiseComparison(filters: ReportFilters): Promise<{ district: string; violations: number; recovered: number }[]> {
    try {
      const dateFilter = this.buildDateFilter(filters);

      // Get all enforcement areas with observation counts
      const districts = await prisma.enforcementArea.findMany({
        include: {
          observations: {
            where: Object.keys(dateFilter).length > 0 ? { observationDate: dateFilter } : undefined,
            select: {
              id: true,
              paidPenaltyAmount: true,
            },
          },
        },
      });

      return districts.map((d: { name: string; observations: { id: string; paidPenaltyAmount: unknown }[] }) => ({
        district: d.name,
        violations: d.observations.length,
        recovered: d.observations.reduce((sum: number, c: { paidPenaltyAmount: unknown }) => sum + Number(c.paidPenaltyAmount || 0), 0),
      })).sort((a: { violations: number }, b: { violations: number }) => b.violations - a.violations);
    } catch (error) {
      logger.error('Error fetching district-wise comparison:', error);
      throw error;
    }
  }

  /**
   * Get all chart data in one call
   */
  async getChartData(filters: ReportFilters) {
    try {
      const [monthlyTrends, violationTypes, penaltyComparison, caseStatus] = await Promise.all([
        this.getMonthlyTrends(filters),
        this.getViolationTypeDistribution(filters),
        this.getPenaltyComparison(filters),
        this.getCaseStatusDistribution(filters),
      ]);

      return {
        monthlyTrends,
        violationTypes,
        penaltyComparison,
        caseStatus,
      };
    } catch (error) {
      logger.error('Error fetching chart data:', error);
      throw error;
    }
  }
}

export const reportsService = new ReportsService();
