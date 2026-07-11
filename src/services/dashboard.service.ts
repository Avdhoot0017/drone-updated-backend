import { prisma } from '../config/database';
import { logger } from '../config/logger';
import {
  DashboardStats,
  TrendData,
  RegionStats,
  ViolationStats,
  VesselTypeStats,
  ObservationFilters,
} from '../types';
import { ObservationStatus, Prisma } from '@prisma/client';

class DashboardService {
  /**
   * Get dashboard summary statistics
   */
  async getStats(filters?: ObservationFilters): Promise<DashboardStats> {
    const where = this.buildWhereClause(filters);

    // Get counts
    const [
      totalObservations,
      uniqueVessels,
      pendingActions,
      todayObservations,
      thisMonthStart,
    ] = await Promise.all([
      prisma.observation.count({ where }),
      prisma.observation.groupBy({
        by: ['vesselId'],
        where: { ...where, vesselId: { not: null } },
      }),
      prisma.observation.count({
        where: {
          ...where,
          status: {
            in: [
              ObservationStatus.reported,
              ObservationStatus.under_review,
              ObservationStatus.action_pending,
            ],
          },
        },
      }),
      prisma.observation.count({
        where: {
          ...where,
          observationDate: new Date(),
        },
      }),
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ]);

    const thisMonthObservations = await prisma.observation.count({
      where: {
        ...where,
        observationDate: { gte: thisMonthStart },
      },
    });

    // Get detected penalty from observations
    const detectedPenaltyStats = await prisma.observation.aggregate({
      where,
      _sum: {
        detectedPenalty: true,
      },
    });

    const detectedPenalty = Number(detectedPenaltyStats._sum.detectedPenalty || 0);

    // Get financial stats (including fish auction amount in recovered)
    const penaltyStats = await prisma.penalty.aggregate({
      where: {
        observation: where,
      },
      _sum: {
        penaltyImposed: true,
        penaltyRecovered: true,
        fishAuctionAmount: true,
      },
    });

    const penaltyImposed = Number(penaltyStats._sum.penaltyImposed || 0);
    // Penalty Recovered includes both penaltyRecovered AND fishAuctionAmount
    const penaltyRecovered = Number(penaltyStats._sum.penaltyRecovered || 0) + Number(penaltyStats._sum.fishAuctionAmount || 0);
    const recoveryRate = penaltyImposed > 0
      ? Math.round((penaltyRecovered / penaltyImposed) * 100)
      : 0;

    return {
      totalObservations,
      uniqueVessels: uniqueVessels.length,
      pendingActions,
      detectedPenalty,
      penaltyImposed,
      penaltyRecovered,
      recoveryRate,
      todayObservations,
      thisMonthObservations,
    };
  }

  /**
   * Get trend data for charts
   */
  async getTrends(
    days: number = 30,
    filters?: ObservationFilters
  ): Promise<TrendData[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const where = {
      ...this.buildWhereClause(filters),
      observationDate: { gte: startDate },
    };

    // Get daily observations
    const observations = await prisma.observation.groupBy({
      by: ['observationDate'],
      where,
      _count: { id: true },
    });

    // Get daily unique vessels
    const vesselsByDate = await prisma.$queryRaw<
      Array<{ date: Date; count: bigint }>
    >`
      SELECT DATE(observation_date) as date, COUNT(DISTINCT vessel_id) as count
      FROM observations
      WHERE observation_date >= ${startDate}
      GROUP BY DATE(observation_date)
      ORDER BY date
    `;

    // Get daily penalties (recovered includes fish auction amount)
    const penalties = await prisma.$queryRaw<
      Array<{ date: Date; imposed: number; recovered: number }>
    >`
      SELECT
        DATE(o.observation_date) as date,
        COALESCE(SUM(p.penalty_imposed), 0) as imposed,
        COALESCE(SUM(p.penalty_recovered), 0) + COALESCE(SUM(p.fish_auction_amount), 0) as recovered
      FROM observations o
      LEFT JOIN penalties p ON o.id = p.observation_id
      WHERE o.observation_date >= ${startDate}
      GROUP BY DATE(o.observation_date)
      ORDER BY date
    `;

    // Merge data
    const dateMap = new Map<string, TrendData>();

    // Initialize all dates
    for (let i = 0; i <= days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      dateMap.set(dateStr, {
        date: dateStr,
        observations: 0,
        vessels: 0,
        penaltyImposed: 0,
        penaltyRecovered: 0,
      });
    }

    // Fill observations
    observations.forEach((row) => {
      const dateStr = new Date(row.observationDate).toISOString().split('T')[0];
      const entry = dateMap.get(dateStr);
      if (entry) {
        entry.observations = row._count.id;
      }
    });

    // Fill vessels
    vesselsByDate.forEach((row) => {
      const dateStr = new Date(row.date).toISOString().split('T')[0];
      const entry = dateMap.get(dateStr);
      if (entry) {
        entry.vessels = Number(row.count);
      }
    });

    // Fill penalties
    penalties.forEach((row) => {
      const dateStr = new Date(row.date).toISOString().split('T')[0];
      const entry = dateMap.get(dateStr);
      if (entry) {
        entry.penaltyImposed = Number(row.imposed);
        entry.penaltyRecovered = Number(row.recovered);
      }
    });

    return Array.from(dateMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }

  /**
   * Normalize district name to title case (first letter uppercase)
   */
  private normalizeDistrictName(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  /**
   * Get statistics by region
   */
  async getRegionStats(filters?: ObservationFilters): Promise<RegionStats[]> {
    const where = this.buildWhereClause(filters);

    const regions = await prisma.enforcementArea.findMany({
      where: { isActive: true },
      include: {
        observations: {
          where,
          include: {
            penalty: true,
          },
        },
      },
    });

    // Group regions by normalized name to merge duplicates
    const regionMap = new Map<string, typeof regions[0] & { mergedObservations: typeof regions[0]['observations'] }>();

    for (const region of regions) {
      const normalizedName = this.normalizeDistrictName(region.name);

      if (regionMap.has(normalizedName)) {
        // Merge observations into existing entry
        const existing = regionMap.get(normalizedName)!;
        existing.mergedObservations = [...existing.mergedObservations, ...region.observations];
      } else {
        regionMap.set(normalizedName, {
          ...region,
          name: normalizedName, // Use normalized name
          mergedObservations: [...region.observations],
        });
      }
    }

    return Array.from(regionMap.values()).map((region) => {
      const observations = region.mergedObservations;
      const uniqueVessels = new Set(
        observations.filter((o) => o.vesselId).map((o) => o.vesselId)
      ).size;

      const pendingStatuses: ObservationStatus[] = [
        ObservationStatus.reported,
        ObservationStatus.under_review,
        ObservationStatus.action_pending,
      ];
      const pendingCases = observations.filter((o) =>
        pendingStatuses.includes(o.status)
      ).length;

      // detectedPenalty is the penalty from the sheet/detected amount
      const detectedPenalty = observations.reduce(
        (sum, o) => sum + Number(o.detectedPenalty || 0),
        0
      );

      const penaltyImposed = observations.reduce(
        (sum, o) => sum + Number(o.penalty?.penaltyImposed || 0),
        0
      );

      // Include both penaltyRecovered and fishAuctionAmount
      const penaltyRecovered = observations.reduce(
        (sum, o) => sum + Number(o.penalty?.penaltyRecovered || 0) + Number(o.penalty?.fishAuctionAmount || 0),
        0
      );

      return {
        id: region.id,
        name: region.name,
        totalObservations: observations.length,
        uniqueVessels,
        detectedPenalty,
        penaltyImposed,
        penaltyRecovered,
        pendingCases,
      };
    });
  }

  /**
   * Get statistics by violation type
   */
  async getViolationStats(filters?: ObservationFilters): Promise<ViolationStats[]> {
    const where = this.buildWhereClause(filters);

    const violationTypes = await prisma.violationType.findMany({
      where: { isActive: true },
      include: {
        observations: {
          where,
        },
      },
    });

    const total = violationTypes.reduce(
      (sum, vt) => sum + vt.observations.length,
      0
    );

    return violationTypes
      .map((vt) => ({
        id: vt.id,
        code: vt.code,
        name: vt.name,
        count: vt.observations.length,
        percentage: total > 0
          ? Math.round((vt.observations.length / total) * 100)
          : 0,
        severityLevel: vt.severityLevel,
      }))
      .filter((v) => v.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get statistics by vessel type
   */
  async getVesselTypeStats(filters?: ObservationFilters): Promise<VesselTypeStats[]> {
    const where = this.buildWhereClause(filters);

    const results = await prisma.$queryRaw<
      Array<{ id: string; name: string; count: bigint }>
    >`
      SELECT vt.id, vt.name, COUNT(o.id) as count
      FROM observations o
      JOIN vessels v ON o.vessel_id = v.id
      JOIN vessel_types vt ON v.vessel_type_id = vt.id
      ${filters?.startDate ? Prisma.sql`WHERE o.observation_date >= ${filters.startDate}` : Prisma.empty}
      ${filters?.endDate ? Prisma.sql`AND o.observation_date <= ${filters.endDate}` : Prisma.empty}
      ${filters?.enforcementAreaId ? Prisma.sql`AND o.enforcement_area_id = ${filters.enforcementAreaId}` : Prisma.empty}
      GROUP BY vt.id, vt.name
      ORDER BY count DESC
    `;

    const total = results.reduce((sum, r) => sum + Number(r.count), 0);

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      count: Number(r.count),
      percentage: total > 0
        ? Math.round((Number(r.count) / total) * 100)
        : 0,
    }));
  }

  /**
   * Get monthly comparison data
   */
  async getMonthlyComparison(months: number = 6) {
    // Calculate start date
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const results = await prisma.$queryRaw<
      Array<{
        year: number;
        month: number;
        observations: bigint;
        vessels: bigint;
        penalty: number;
      }>
    >`
      SELECT
        EXTRACT(YEAR FROM observation_date)::int as year,
        EXTRACT(MONTH FROM observation_date)::int as month,
        COUNT(*) as observations,
        COUNT(DISTINCT vessel_id) as vessels,
        COALESCE(SUM(p.penalty_imposed), 0) as penalty
      FROM observations o
      LEFT JOIN penalties p ON o.id = p.observation_id
      WHERE observation_date >= ${startDate}
      GROUP BY year, month
      ORDER BY year, month
    `;

    // If no data, generate empty months
    if (results.length === 0) {
      const emptyMonths = [];
      const now = new Date();
      for (let i = months - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        emptyMonths.push({
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          monthName: date.toLocaleString('default', { month: 'short' }),
          observations: 0,
          vessels: 0,
          penalty: 0,
        });
      }
      return emptyMonths;
    }

    return results.map((r) => ({
      year: r.year,
      month: r.month,
      monthName: new Date(r.year, r.month - 1).toLocaleString('default', {
        month: 'short',
      }),
      observations: Number(r.observations),
      vessels: Number(r.vessels),
      penalty: Number(r.penalty),
    }));
  }

  /**
   * Get top offending vessels
   */
  async getTopOffenders(limit: number = 10) {
    const vessels = await prisma.vessel.findMany({
      where: {
        totalViolations: { gte: 2 },
      },
      include: {
        vesselType: true,
        state: true,
        observations: {
          include: {
            penalty: true,
          },
        },
      },
      orderBy: { totalViolations: 'desc' },
      take: limit,
    });

    return vessels.map((v) => ({
      id: v.id,
      name: v.name,
      registrationNumber: v.registrationNumber,
      vesselType: v.vesselType?.name,
      state: v.state?.name,
      totalViolations: v.totalViolations,
      isFlagged: v.isFlagged,
      riskCategory: v.riskCategory,
      totalPenalty: v.observations.reduce(
        (sum, o) => sum + Number(o.penalty?.penaltyImposed || 0),
        0
      ),
      lastObservedAt: v.lastObservedAt,
    }));
  }

  /**
   * Get observations with filters and pagination
   */
  async getObservations(
    filters: ObservationFilters,
    page: number = 1,
    limit: number = 20
  ) {
    const where = this.buildWhereClause(filters);

    const [observations, total] = await Promise.all([
      prisma.observation.findMany({
        where,
        include: {
          enforcementArea: true,
          flyingLocation: true,
          vessel: {
            include: {
              vesselType: true,
            },
          },
          violationType: true,
          penalty: true,
          evidence: {
            where: { isPrimary: true },
            take: 1,
          },
        },
        orderBy: { observationDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.observation.count({ where }),
    ]);

    return {
      data: observations.map((o) => ({
        id: o.id,
        date: o.observationDate,
        time: o.observationTime,
        enforcementArea: o.enforcementArea.name,
        flyingLocation: o.flyingLocation.name,
        vesselName: o.vessel?.name || o.originalVesselName,
        vesselRegNo: o.vessel?.registrationNumber || o.originalVesselReg,
        vesselType: o.vessel?.vesselType?.name || o.originalVesselType,
        violationType: o.violationType?.name || o.originalViolationText,
        status: o.status,
        latitude: o.latitude,
        longitude: o.longitude,
        distanceFromCoast: o.distanceFromCoastKm,
        penaltyImposed: o.penalty?.penaltyImposed,
        penaltyRecovered: o.penalty?.penaltyRecovered,
        evidenceUrl: o.evidence[0]?.evidenceUrl,
        remarksHo: o.remarksHo,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get distance from coast distribution
   */
  async getDistanceDistribution(filters?: ObservationFilters) {
    const where = this.buildWhereClause(filters);

    // Distance ranges in Nautical Miles (1 NM = 1.852 km)
    // 0-5 NM = 0 to 9.26 km
    // 5-12 NM = 9.26+ km (includes 12+ NM data AND observations without GPS)
    const results = await prisma.$queryRaw<
      Array<{ range_label: string; count: bigint; avg_distance: number; sort_order: number }>
    >`
      SELECT
        CASE
          WHEN distance_from_coast_km >= 0 AND distance_from_coast_km < 9.26 THEN '0-5 NM'
          ELSE '5-12 NM'
        END as range_label,
        COUNT(*) as count,
        AVG(COALESCE(distance_from_coast_km, 0)) as avg_distance,
        MIN(CASE
          WHEN distance_from_coast_km >= 0 AND distance_from_coast_km < 9.26 THEN 1
          ELSE 2
        END) as sort_order
      FROM observations
      WHERE 1=1
      ${filters?.startDate ? Prisma.sql`AND observation_date >= ${filters.startDate}` : Prisma.empty}
      ${filters?.endDate ? Prisma.sql`AND observation_date <= ${filters.endDate}` : Prisma.empty}
      ${filters?.enforcementAreaId ? Prisma.sql`AND enforcement_area_id = ${filters.enforcementAreaId}` : Prisma.empty}
      GROUP BY 1
      ORDER BY 4
    `;

    // Also get total observations with distance data
    const totalWithDistance = await prisma.observation.count({
      where: {
        ...where,
        distanceFromCoastKm: { not: null },
      },
    });

    const totalObservations = await prisma.observation.count({ where });

    return {
      distribution: results.map((r) => ({
        range: r.range_label,
        count: Number(r.count),
        avgDistance: Number(r.avg_distance || 0),
        percentage: totalWithDistance > 0
          ? Math.round((Number(r.count) / totalWithDistance) * 100)
          : 0,
      })),
      summary: {
        totalWithDistance,
        totalObservations,
        coveragePercent: totalObservations > 0
          ? Math.round((totalWithDistance / totalObservations) * 100)
          : 0,
      },
    };
  }

  /**
   * Get distance distribution grouped by district/enforcement area
   * Includes ALL observations - those without GPS data are counted in 5-12 NM
   */
  async getDistanceDistributionByDistrict(filters?: ObservationFilters) {
    const results = await prisma.$queryRaw<
      Array<{
        enforcement_area_id: string;
        area_name: string;
        near_shore: bigint;
        mid_zone: bigint;
        total: bigint;
      }>
    >`
      SELECT
        o.enforcement_area_id,
        ea.name as area_name,
        SUM(CASE WHEN distance_from_coast_km >= 0 AND distance_from_coast_km < 9.26 THEN 1 ELSE 0 END) as near_shore,
        SUM(CASE WHEN distance_from_coast_km IS NULL OR distance_from_coast_km >= 9.26 THEN 1 ELSE 0 END) as mid_zone,
        COUNT(*) as total
      FROM observations o
      INNER JOIN enforcement_areas ea ON o.enforcement_area_id = ea.id
      WHERE 1=1
      ${filters?.startDate ? Prisma.sql`AND o.observation_date >= ${filters.startDate}` : Prisma.empty}
      ${filters?.endDate ? Prisma.sql`AND o.observation_date <= ${filters.endDate}` : Prisma.empty}
      GROUP BY o.enforcement_area_id, ea.name
      ORDER BY total DESC
    `;

    return results.map((r) => ({
      enforcementAreaId: r.enforcement_area_id,
      name: r.area_name,
      nearShore: Number(r.near_shore),
      midZone: Number(r.mid_zone),
      total: Number(r.total),
    }));
  }

  /**
   * Get hourly distribution for heatmap
   */
  async getHourlyDistribution(filters?: ObservationFilters) {
    const results = await prisma.$queryRaw<
      Array<{ day: number; hour: number; count: bigint }>
    >`
      SELECT
        observation_day_of_week as day,
        observation_hour as hour,
        COUNT(*) as count
      FROM observations
      WHERE observation_hour IS NOT NULL
      ${filters?.startDate ? Prisma.sql`AND observation_date >= ${filters.startDate}` : Prisma.empty}
      ${filters?.endDate ? Prisma.sql`AND observation_date <= ${filters.endDate}` : Prisma.empty}
      ${filters?.enforcementAreaId ? Prisma.sql`AND enforcement_area_id = ${filters.enforcementAreaId}` : Prisma.empty}
      GROUP BY day, hour
      ORDER BY day, hour
    `;

    // Create a 7x24 matrix
    const matrix: number[][] = Array(7)
      .fill(null)
      .map(() => Array(24).fill(0));

    results.forEach((r) => {
      if (r.day >= 1 && r.day <= 7 && r.hour >= 0 && r.hour < 24) {
        matrix[r.day - 1][r.hour] = Number(r.count);
      }
    });

    return matrix;
  }

  /**
   * Build where clause from filters
   */
  private buildWhereClause(filters?: ObservationFilters): Prisma.ObservationWhereInput {
    if (!filters) return {};

    const where: Prisma.ObservationWhereInput = {};

    if (filters.startDate) {
      where.observationDate = { gte: filters.startDate };
    }

    if (filters.endDate) {
      where.observationDate = {
        ...where.observationDate as object,
        lte: filters.endDate,
      };
    }

    if (filters.enforcementAreaId) {
      where.enforcementAreaId = filters.enforcementAreaId;
    }

    if (filters.flyingLocationId) {
      where.flyingLocationId = filters.flyingLocationId;
    }

    if (filters.violationTypeId) {
      where.violationTypeId = filters.violationTypeId;
    }

    if (filters.status) {
      where.status = filters.status as ObservationStatus;
    }

    if (filters.vesselRegNo) {
      where.vessel = {
        registrationNumber: { contains: filters.vesselRegNo, mode: 'insensitive' },
      };
    }

    if (filters.search) {
      where.OR = [
        { originalVesselName: { contains: filters.search, mode: 'insensitive' } },
        { originalVesselReg: { contains: filters.search, mode: 'insensitive' } },
        { originalViolationText: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}

export const dashboardService = new DashboardService();
