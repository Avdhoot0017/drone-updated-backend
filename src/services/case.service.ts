/**
 * Case Service - Handles case creation, management, and penalty calculation
 * Used by operators to create manual cases and manage existing ones
 */

import { PrismaClient, DataSource, ObservationStatus, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';
import { s3Service } from './s3.service';
import {
  sendEmail,
  sendSMS,
  sendWhatsApp,
  makeVoiceCall,
  generateCaseNotificationContent,
} from '../utils/notifications';

const prisma = new PrismaClient();

// ============================================================
// INTERFACES
// ============================================================

export interface CreateCaseInput {
  // Vessel details
  vesselName: string;
  vesselNumber: string;
  vesselTypeId?: string;

  // Owner details
  ownerName: string;
  ownerContact1: string;
  ownerContact2?: string;
  ownerEmail?: string;

  // Location details
  enforcementAreaId: string;
  flyingLocationId: string;
  latitude?: number;
  longitude?: number;

  // Violation details
  violationTypeId: string;
  fishingLicenseTypeId?: string;

  // Date/Time
  observationDate: Date;
  observationTime?: string;

  // Penalty (auto-calculated but can be overridden)
  penaltyAmount?: number;
  offenceOccurrence?: number;

  // Evidence
  evidenceUrls?: string[];

  // Created by
  createdByUserId: string;
}

export interface CaseListFilters {
  enforcementAreaId?: string;
  violationTypeId?: string;
  status?: ObservationStatus;
  dataSource?: DataSource;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

export interface DisposeCaseInput {
  observationId: string;
  disposalReason: string;
  disposedByUserId: string;
  paidAmount?: number;
}

// ============================================================
// PENALTY CALCULATION
// ============================================================

/**
 * Calculate penalty based on violation type and occurrence
 * Only counts non-disposed cases for occurrence calculation
 * If manualOccurrence is provided, use that instead of calculating from DB
 */
export async function calculatePenalty(
  vesselId: string | null,
  violationTypeId: string,
  manualOccurrence?: number
): Promise<{ occurrence: number; penaltyAmount: number; baseAmount: number; violationPenalty: number }> {
  // Get violation type occurrence count for this vessel (non-disposed only)
  let occurrence = manualOccurrence || 1;

  if (!manualOccurrence && vesselId) {
    const existingViolations = await prisma.observation.count({
      where: {
        vesselId,
        violationTypeId,
        status: {
          not: 'disposed', // Only count non-disposed cases
        },
      },
    });
    occurrence = existingViolations + 1;
  }

  // Get penalty configuration for this violation type and occurrence
  const penaltyConfig = await prisma.penaltyConfiguration.findFirst({
    where: {
      violationTypeId,
      occurrence: {
        lte: occurrence, // Get the highest configured occurrence that's <= current
      },
      isActive: true,
    },
    orderBy: {
      occurrence: 'desc',
    },
  });

  if (penaltyConfig) {
    const baseAmount = Number(penaltyConfig.baseAmount);
    const violationPenalty = Number(penaltyConfig.penaltyAmount);
    return {
      occurrence,
      penaltyAmount: baseAmount + violationPenalty,
      baseAmount,
      violationPenalty,
    };
  }

  // Fallback: Get base penalty from violation type
  const violationType = await prisma.violationType.findUnique({
    where: { id: violationTypeId },
  });

  const fallbackPenalty = Number(violationType?.basePenalty || 20000);
  return {
    occurrence,
    penaltyAmount: fallbackPenalty,
    baseAmount: 0,
    violationPenalty: fallbackPenalty,
  };
}

/**
 * Generate unique case number
 * Format: MH/FISH/YYYY/MM/XXXXX
 */
function generateCaseNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 99999)
    .toString()
    .padStart(5, '0');
  return `MH/FISH/${year}/${month}/${random}`;
}

/**
 * Generate unique key for observation
 */
function generateUniqueKey(
  location: string,
  vesselReg: string,
  date: Date,
  time?: string,
  isManual: boolean = false
): string {
  const crypto = require('crypto');
  // For manual cases, add timestamp to ensure uniqueness even for same vessel/location/date
  const manualSuffix = isManual ? `|${Date.now()}` : '';
  const combined = `${location}|${vesselReg}|${date.toISOString().split('T')[0]}|${time || ''}${manualSuffix}`;
  return crypto.createHash('md5').update(combined).digest('hex');
}

// ============================================================
// CASE SERVICE
// ============================================================

class CaseService {
  /**
   * Create a new manual case
   */
  async createCase(input: CreateCaseInput): Promise<{
    success: boolean;
    case?: Prisma.ObservationGetPayload<{
      include: {
        enforcementArea: true;
        flyingLocation: true;
        vessel: true;
        violationType: true;
        fishingLicenseType: true;
        evidence: true;
      };
    }>;
    error?: string;
  }> {
    try {
      // ========== COMPREHENSIVE VALIDATION ==========
      const errors: string[] = [];

      // Vessel validation
      if (!input.vesselName || input.vesselName.trim() === '') {
        errors.push('Vessel Name is required');
      }
      if (!input.vesselNumber || input.vesselNumber.trim() === '') {
        errors.push('Vessel Registration Number is required');
      }

      // Owner validation
      if (!input.ownerName || input.ownerName.trim() === '') {
        errors.push('Owner Name is required');
      }
      if (!input.ownerContact1 || input.ownerContact1.trim() === '') {
        errors.push('Owner Contact Number is required');
      } else if (!/^[6-9]\d{9}$/.test(input.ownerContact1.replace(/\D/g, ''))) {
        errors.push('Owner Contact must be a valid 10-digit Indian mobile number');
      }
      if (input.ownerContact2 && !/^[6-9]\d{9}$/.test(input.ownerContact2.replace(/\D/g, ''))) {
        errors.push('Secondary Contact must be a valid 10-digit Indian mobile number');
      }

      // Location validation
      if (!input.enforcementAreaId) {
        errors.push('District/Enforcement Area is required');
      }
      if (!input.flyingLocationId) {
        errors.push('Flying Location is required');
      }

      // Coordinate validation
      if (input.latitude !== undefined && input.latitude !== null) {
        const lat = Number(input.latitude);
        if (isNaN(lat)) {
          errors.push('Latitude must be a valid number');
        } else if (lat < -90 || lat > 90) {
          errors.push(`Latitude must be between -90 and 90 (received: ${lat})`);
        }
      }
      if (input.longitude !== undefined && input.longitude !== null) {
        const lon = Number(input.longitude);
        if (isNaN(lon)) {
          errors.push('Longitude must be a valid number');
        } else if (lon < -180 || lon > 180) {
          errors.push(`Longitude must be between -180 and 180 (received: ${lon})`);
        }
      }

      // Violation validation
      if (!input.violationTypeId) {
        errors.push('Violation Type is required');
      }

      // Date validation
      if (!input.observationDate) {
        errors.push('Observation Date is required');
      } else {
        const obsDate = new Date(input.observationDate);
        if (isNaN(obsDate.getTime())) {
          errors.push('Invalid Observation Date format');
        } else if (obsDate > new Date()) {
          errors.push('Observation Date cannot be in the future');
        }
      }

      // Time validation
      if (input.observationTime && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(input.observationTime)) {
        errors.push('Invalid Observation Time format (expected HH:MM)');
      }

      // Penalty validation
      if (input.penaltyAmount !== undefined && input.penaltyAmount < 0) {
        errors.push('Penalty Amount cannot be negative');
      }

      // If there are validation errors, return them all
      if (errors.length > 0) {
        logger.warn('Case creation validation failed:', { errors, input });
        return {
          success: false,
          error: errors.join('; '),
        };
      }

      // Find or create vessel
      let vessel = await prisma.vessel.findFirst({
        where: {
          OR: [
            { registrationNumber: input.vesselNumber },
            { name: input.vesselName },
          ],
        },
      });

      if (!vessel) {
        // Create new vessel
        vessel = await prisma.vessel.create({
          data: {
            registrationNumber: input.vesselNumber,
            name: input.vesselName,
            vesselTypeId: input.vesselTypeId,
            ownerName: input.ownerName,
            ownerContact: input.ownerContact1,
            ownerContact2: input.ownerContact2,
            totalViolations: 0,
          },
        });
        logger.info(`Created new vessel: ${vessel.registrationNumber}`);
      } else {
        // Update vessel owner info if provided
        await prisma.vessel.update({
          where: { id: vessel.id },
          data: {
            ownerName: input.ownerName || vessel.ownerName,
            ownerContact: input.ownerContact1 || vessel.ownerContact,
            ownerContact2: input.ownerContact2 || vessel.ownerContact2,
          },
        });
      }

      // Calculate penalty based on violation type and occurrence
      let penaltyData = await calculatePenalty(vessel.id, input.violationTypeId);

      // Allow override if provided
      if (input.penaltyAmount !== undefined) {
        penaltyData.penaltyAmount = input.penaltyAmount;
      }
      if (input.offenceOccurrence !== undefined) {
        penaltyData.occurrence = input.offenceOccurrence;
      }

      // Parse observation time
      let observationTime: Date | undefined;
      if (input.observationTime) {
        const [hours, minutes] = input.observationTime.split(':').map(Number);
        observationTime = new Date();
        observationTime.setHours(hours, minutes, 0, 0);
      }

      // Generate unique key (with isManual=true to ensure uniqueness for manual cases)
      const uniqueKey = generateUniqueKey(
        input.flyingLocationId,
        input.vesselNumber,
        input.observationDate,
        input.observationTime,
        true // manual case
      );

      // Generate case number
      const caseNumber = generateCaseNumber();

      // Create observation (case) - coordinates already validated above
      const observation = await prisma.observation.create({
        data: {
          caseNumber,
          uniqueKey,
          dataSource: 'manual',
          enforcementAreaId: input.enforcementAreaId,
          flyingLocationId: input.flyingLocationId,
          vesselId: vessel.id,
          violationTypeId: input.violationTypeId,
          fishingLicenseTypeId: input.fishingLicenseTypeId,
          originalVesselName: input.vesselName,
          originalVesselReg: input.vesselNumber,
          ownerName: input.ownerName,
          ownerContact1: input.ownerContact1,
          ownerContact2: input.ownerContact2,
          ownerEmail: input.ownerEmail,
          latitude: input.latitude ? new Prisma.Decimal(Number(input.latitude)) : null,
          longitude: input.longitude ? new Prisma.Decimal(Number(input.longitude)) : null,
          observationDate: input.observationDate,
          observationTime,
          observationDatetime: observationTime
            ? new Date(
                input.observationDate.getFullYear(),
                input.observationDate.getMonth(),
                input.observationDate.getDate(),
                observationTime.getHours(),
                observationTime.getMinutes()
              )
            : input.observationDate,
          offenceOccurrence: penaltyData.occurrence,
          penaltyAmount: new Prisma.Decimal(penaltyData.penaltyAmount),
          status: 'reported',
          createdByUserId: input.createdByUserId,
          // Computed time dimensions
          observationHour: observationTime?.getHours(),
          observationDayOfWeek: input.observationDate.getDay(),
          observationWeek: getWeekNumber(input.observationDate),
          observationMonth: input.observationDate.getMonth() + 1,
          observationQuarter: Math.ceil((input.observationDate.getMonth() + 1) / 3),
          observationYear: input.observationDate.getFullYear(),
          fiscalYear: getFiscalYear(input.observationDate),
        },
        include: {
          enforcementArea: true,
          flyingLocation: true,
          vessel: true,
          violationType: true,
          fishingLicenseType: true,
          evidence: true,
        },
      });

      // Create evidence records if URLs provided
      if (input.evidenceUrls && input.evidenceUrls.length > 0) {
        for (let i = 0; i < input.evidenceUrls.length; i++) {
          const url = input.evidenceUrls[i];
          // Extract S3 key from URL if it's an S3 URL
          let s3Key: string | undefined;
          if (url.includes('amazonaws.com/')) {
            const urlParts = url.split('.amazonaws.com/');
            if (urlParts.length > 1) {
              s3Key = urlParts[1].split('?')[0]; // Remove query params
            }
          }

          await prisma.observationEvidence.create({
            data: {
              observationId: observation.id,
              evidenceUrl: url,
              s3Key: s3Key,
              evidenceType: 'image',
              isPrimary: i === 0,
            },
          });
        }
      }

      // Update vessel violation count
      await prisma.vessel.update({
        where: { id: vessel.id },
        data: {
          totalViolations: { increment: 1 },
          lastObservedAt: new Date(),
        },
      });

      logger.info(`Case created: ${caseNumber} for vessel ${input.vesselNumber}`);

      // Fetch complete case with relations
      const completeCase = await prisma.observation.findUnique({
        where: { id: observation.id },
        include: {
          enforcementArea: true,
          flyingLocation: true,
          vessel: true,
          violationType: true,
          fishingLicenseType: true,
          evidence: true,
        },
      });

      return {
        success: true,
        case: completeCase!,
      };
    } catch (error) {
      logger.error('Error creating case:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create case',
      };
    }
  }

  /**
   * Get cases with filters and pagination
   */
  async getCases(filters: CaseListFilters) {
    const {
      enforcementAreaId,
      violationTypeId,
      status,
      dataSource,
      dateFrom,
      dateTo,
      search,
      page = 1,
      limit = 20,
    } = filters;

    const where: Prisma.ObservationWhereInput = {};

    if (enforcementAreaId) where.enforcementAreaId = enforcementAreaId;
    if (violationTypeId) where.violationTypeId = violationTypeId;
    if (status) where.status = status;
    if (dataSource) where.dataSource = dataSource;

    if (dateFrom || dateTo) {
      where.observationDate = {};
      if (dateFrom) where.observationDate.gte = dateFrom;
      if (dateTo) where.observationDate.lte = dateTo;
    }

    if (search) {
      where.OR = [
        { caseNumber: { contains: search, mode: 'insensitive' } },
        { originalVesselName: { contains: search, mode: 'insensitive' } },
        { originalVesselReg: { contains: search, mode: 'insensitive' } },
        { ownerName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [cases, total] = await Promise.all([
      prisma.observation.findMany({
        where,
        include: {
          enforcementArea: true,
          flyingLocation: true,
          vessel: true,
          violationType: true,
          evidence: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.observation.count({ where }),
    ]);

    return {
      cases,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single case by ID
   * Returns presigned URLs for evidence images
   */
  async getCaseById(id: string) {
    const observation = await prisma.observation.findUnique({
      where: { id },
      include: {
        enforcementArea: true,
        flyingLocation: true,
        vessel: true,
        violationType: true,
        fishingLicenseType: true,
        evidence: true,
        penalty: true,
        notices: true,
        history: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!observation) return null;

    // Generate presigned URLs for evidence images
    const evidenceWithUrls = await Promise.all(
      observation.evidence.map(async (ev) => {
        let presignedUrl = ev.evidenceUrl;

        // If it's an S3 URL, generate a presigned URL
        if (ev.s3Key) {
          const signedUrl = await s3Service.getPresignedDownloadUrl(ev.s3Key, 3600);
          if (signedUrl) {
            presignedUrl = signedUrl;
          }
        } else if (ev.evidenceUrl?.includes('amazonaws.com')) {
          // Extract key from URL and generate presigned URL
          const urlParts = ev.evidenceUrl.split('.amazonaws.com/');
          if (urlParts.length > 1) {
            const key = urlParts[1].split('?')[0]; // Remove any existing query params
            const signedUrl = await s3Service.getPresignedDownloadUrl(key, 3600);
            if (signedUrl) {
              presignedUrl = signedUrl;
            }
          }
        }

        return {
          ...ev,
          evidenceUrl: presignedUrl,
        };
      })
    );

    // Generate presigned URLs for notice documents
    const noticesWithUrls = await Promise.all(
      observation.notices.map(async (notice) => {
        let documentUrl = notice.documentUrl;

        // If it has an S3 key, generate a presigned URL
        if (notice.s3Key) {
          const signedUrl = await s3Service.getPresignedDownloadUrl(notice.s3Key, 3600);
          if (signedUrl) {
            documentUrl = signedUrl;
          }
        } else if (notice.documentUrl?.includes('amazonaws.com')) {
          // Extract key from URL and generate presigned URL
          const urlParts = notice.documentUrl.split('.amazonaws.com/');
          if (urlParts.length > 1) {
            const key = urlParts[1].split('?')[0];
            const signedUrl = await s3Service.getPresignedDownloadUrl(key, 3600);
            if (signedUrl) {
              documentUrl = signedUrl;
            }
          }
        }

        return {
          ...notice,
          documentUrl,
        };
      })
    );

    return {
      ...observation,
      evidence: evidenceWithUrls,
      notices: noticesWithUrls,
    };
  }

  /**
   * Dispose a case (ACF action)
   */
  async disposeCase(input: DisposeCaseInput): Promise<{
    success: boolean;
    error?: string;
  }> {
    const { observationId, disposalReason, disposedByUserId, paidAmount } = input;

    try {
      const observation = await prisma.observation.findUnique({
        where: { id: observationId },
        include: { vessel: true },
      });

      if (!observation) {
        return { success: false, error: 'Case not found' };
      }

      if (observation.status === 'disposed') {
        return { success: false, error: 'Case is already disposed' };
      }

      const expectedAmount = Number(observation.penaltyAmount) || 0;
      const paid = paidAmount || 0;

      // If paid amount is less than expected, require reason with min 100 chars
      const reasonLength = disposalReason?.length || 0;
      if (paid < expectedAmount && reasonLength < 100) {
        return {
          success: false,
          error: 'Disposal reason must be at least 100 characters when paid amount is less than expected',
        };
      }

      // Update observation status
      await prisma.observation.update({
        where: { id: observationId },
        data: {
          status: 'disposed',
          disposalReason,
          paidPenaltyAmount: paid,
          disposedAt: new Date(),
          disposedBy: disposedByUserId,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: disposedByUserId,
        },
      });

      // Log history
      await prisma.observationHistory.create({
        data: {
          observationId,
          changedBy: disposedByUserId,
          changeType: 'status_change',
          fieldChanged: 'status',
          oldValue: observation.status,
          newValue: 'disposed',
          changeReason: disposalReason,
        },
      });

      logger.info(`Case ${observation.caseNumber} disposed by ${disposedByUserId}`);

      return { success: true };
    } catch (error) {
      logger.error('Error disposing case:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to dispose case',
      };
    }
  }

  /**
   * Get case statistics for dashboard
   */
  async getCaseStats(enforcementAreaId?: string) {
    const where: Prisma.ObservationWhereInput = {};
    if (enforcementAreaId) where.enforcementAreaId = enforcementAreaId;

    const [
      totalCases,
      manualCases,
      sheetCases,
      disposedCases,
      pendingCases,
      districtWise,
    ] = await Promise.all([
      prisma.observation.count({ where }),
      prisma.observation.count({ where: { ...where, dataSource: 'manual' } }),
      prisma.observation.count({ where: { ...where, dataSource: 'sheet' } }),
      prisma.observation.count({ where: { ...where, status: 'disposed' } }),
      prisma.observation.count({
        where: { ...where, status: { not: 'disposed' } },
      }),
      prisma.observation.groupBy({
        by: ['enforcementAreaId'],
        where,
        _count: true,
      }),
    ]);

    // Get district names
    const districtIds = districtWise.map((d) => d.enforcementAreaId);
    const districts = await prisma.enforcementArea.findMany({
      where: { id: { in: districtIds } },
      select: { id: true, name: true },
    });

    const districtStats = districtWise.map((d) => ({
      districtId: d.enforcementAreaId,
      districtName: districts.find((dist) => dist.id === d.enforcementAreaId)?.name || 'Unknown',
      count: d._count,
    }));

    return {
      totalCases,
      manualCases,
      sheetCases,
      disposedCases,
      pendingCases,
      districtStats,
    };
  }

  /**
   * Send case notifications
   */
  async sendCaseNotifications(
    observationId: string,
    channels: ('email' | 'sms' | 'whatsapp' | 'call')[]
  ) {
    const observation = await this.getCaseById(observationId);
    if (!observation) {
      return { success: false, error: 'Case not found' };
    }

    const notificationContent = generateCaseNotificationContent({
      caseNumber: observation.caseNumber || observation.id,
      vesselName: observation.originalVesselName || 'Unknown',
      vesselNumber: observation.originalVesselReg || 'Unknown',
      violationType: observation.violationType?.name || 'Unknown',
      penaltyAmount: Number(observation.penaltyAmount) || 0,
      date: observation.observationDate.toLocaleDateString('en-IN'),
      location: observation.flyingLocation?.name || 'Unknown',
    });

    const results: Record<string, { success: boolean; messageId?: string; error?: string }> = {};

    // Get contact info
    const email = ''; // Would come from owner/vessel data
    const phone1 = observation.ownerContact1;
    const phone2 = observation.ownerContact2;

    for (const channel of channels) {
      switch (channel) {
        case 'email':
          if (email) {
            results.email = await sendEmail({
              to: email,
              subject: notificationContent.emailSubject,
              htmlContent: notificationContent.emailContent,
            });
          }
          break;

        case 'sms':
          if (phone1) {
            results.sms = await sendSMS({
              to: phone2 ? [phone1, phone2] : phone1,
              message: notificationContent.smsMessage,
            });
          }
          break;

        case 'whatsapp':
          if (phone1) {
            results.whatsapp = await sendWhatsApp({
              to: phone1,
              message: notificationContent.whatsAppMessage,
            });
          }
          break;

        case 'call':
          if (phone1) {
            results.call = await makeVoiceCall({
              to: phone1,
              message: notificationContent.voiceMessage,
            });
          }
          break;
      }
    }

    // Update case notice record
    await prisma.caseNotice.create({
      data: {
        observationId,
        noticeNumber: `NOT-${Date.now()}`,
        status: 'sent',
        sentAt: new Date(),
        emailSentAt: results.email?.success ? new Date() : null,
        emailStatus: results.email?.success ? 'sent' : results.email?.error,
        smsSentAt: results.sms?.success ? new Date() : null,
        smsStatus: results.sms?.success ? 'sent' : results.sms?.error,
        whatsappSentAt: results.whatsapp?.success ? new Date() : null,
        whatsappStatus: results.whatsapp?.success ? 'sent' : results.whatsapp?.error,
        callMadeAt: results.call?.success ? new Date() : null,
        callStatus: results.call?.success ? 'completed' : results.call?.error,
      },
    });

    return { success: true, results };
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

function getFiscalYear(date: Date): number {
  const month = date.getMonth();
  const year = date.getFullYear();
  // Indian fiscal year starts in April
  return month >= 3 ? year : year - 1;
}

export const caseService = new CaseService();
