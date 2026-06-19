/**
 * Vessel Service - Handles vessel lookup, suggestions, and management
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

// ============================================================
// INTERFACES
// ============================================================

export interface VesselSuggestion {
  id: string;
  name: string | null;
  registrationNumber: string | null;
  ownerName: string | null;
  ownerContact: string | null;
  totalViolations: number;
  isExisting: boolean;
}

export interface CreateVesselInput {
  name: string;
  registrationNumber: string;
  vesselTypeId?: string;
  ownerName?: string;
  ownerContact?: string;
  ownerContact2?: string;
}

// ============================================================
// VESSEL SERVICE
// ============================================================

class VesselService {
  /**
   * Search vessels by name or registration number
   * Returns suggestions for autocomplete
   */
  async searchVessels(
    query: string,
    limit: number = 10
  ): Promise<VesselSuggestion[]> {
    if (!query || query.length < 2) {
      return [];
    }

    const searchTerm = query.trim();

    try {
      const vessels = await prisma.vessel.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { registrationNumber: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          registrationNumber: true,
          ownerName: true,
          ownerContact: true,
          totalViolations: true,
        },
        orderBy: [
          { totalViolations: 'desc' }, // Show repeat offenders first
          { lastObservedAt: 'desc' },
        ],
        take: limit,
      });

      return vessels.map((v) => ({
        ...v,
        isExisting: true,
      }));
    } catch (error) {
      logger.error('Error searching vessels:', error);
      return [];
    }
  }

  /**
   * Get vessel by registration number
   */
  async getByRegistrationNumber(regNumber: string) {
    return prisma.vessel.findUnique({
      where: { registrationNumber: regNumber.toUpperCase().trim() },
      include: {
        vesselType: true,
        state: true,
        observations: {
          select: {
            id: true,
            caseNumber: true,
            status: true,
            observationDate: true,
            violationType: {
              select: { name: true },
            },
          },
          orderBy: { observationDate: 'desc' },
          take: 10,
        },
      },
    });
  }

  /**
   * Get vessel violation history
   */
  async getViolationHistory(vesselId: string) {
    const vessel = await prisma.vessel.findUnique({
      where: { id: vesselId },
      include: {
        observations: {
          include: {
            violationType: true,
            enforcementArea: true,
          },
          orderBy: { observationDate: 'desc' },
        },
      },
    });

    if (!vessel) return null;

    // Group by violation type
    const violationsByType: Record<
      string,
      {
        violationType: string;
        count: number;
        disposedCount: number;
        pendingCount: number;
      }
    > = {};

    for (const obs of vessel.observations) {
      const typeName = obs.violationType?.name || 'Unknown';
      if (!violationsByType[typeName]) {
        violationsByType[typeName] = {
          violationType: typeName,
          count: 0,
          disposedCount: 0,
          pendingCount: 0,
        };
      }
      violationsByType[typeName].count++;
      if (obs.status === 'disposed') {
        violationsByType[typeName].disposedCount++;
      } else {
        violationsByType[typeName].pendingCount++;
      }
    }

    return {
      vessel,
      totalViolations: vessel.observations.length,
      violationsByType: Object.values(violationsByType),
      recentViolations: vessel.observations.slice(0, 5),
    };
  }

  /**
   * Create or get vessel
   */
  async createOrGetVessel(input: CreateVesselInput) {
    // Try to find existing vessel
    const existing = await prisma.vessel.findFirst({
      where: {
        OR: [
          { registrationNumber: input.registrationNumber.toUpperCase().trim() },
          {
            AND: [
              { name: { equals: input.name, mode: 'insensitive' } },
              { registrationNumber: null },
            ],
          },
        ],
      },
    });

    if (existing) {
      // Update owner info if provided
      if (input.ownerName || input.ownerContact) {
        return prisma.vessel.update({
          where: { id: existing.id },
          data: {
            ownerName: input.ownerName || existing.ownerName,
            ownerContact: input.ownerContact || existing.ownerContact,
            ownerContact2: input.ownerContact2 || existing.ownerContact2,
          },
        });
      }
      return existing;
    }

    // Create new vessel
    return prisma.vessel.create({
      data: {
        name: input.name,
        registrationNumber: input.registrationNumber.toUpperCase().trim(),
        vesselTypeId: input.vesselTypeId,
        ownerName: input.ownerName,
        ownerContact: input.ownerContact,
        ownerContact2: input.ownerContact2,
        totalViolations: 0,
      },
    });
  }

  /**
   * Get all vessels with pagination
   */
  async getVessels(params: {
    search?: string;
    flagged?: boolean;
    page?: number;
    limit?: number;
  }) {
    const { search, flagged, page = 1, limit = 20 } = params;

    const where: Prisma.VesselWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { registrationNumber: { contains: search, mode: 'insensitive' } },
        { ownerName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (flagged !== undefined) {
      where.isFlagged = flagged;
    }

    const [vessels, total] = await Promise.all([
      prisma.vessel.findMany({
        where,
        include: {
          vesselType: true,
          _count: {
            select: { observations: true },
          },
        },
        orderBy: { lastObservedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.vessel.count({ where }),
    ]);

    return {
      vessels,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Flag a vessel as repeat offender
   */
  async flagVessel(vesselId: string, reason: string) {
    return prisma.vessel.update({
      where: { id: vesselId },
      data: {
        isFlagged: true,
        flagReason: reason,
      },
    });
  }

  /**
   * Unflag a vessel
   */
  async unflagVessel(vesselId: string) {
    return prisma.vessel.update({
      where: { id: vesselId },
      data: {
        isFlagged: false,
        flagReason: null,
      },
    });
  }
}

export const vesselService = new VesselService();
