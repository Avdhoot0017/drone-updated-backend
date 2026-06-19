/**
 * Case Controller
 * Handles case management operations
 */

import { Response } from 'express';
import { validationResult } from 'express-validator';
import { AuthenticatedRequest } from '../types';
import { caseService, CreateCaseInput, DisposeCaseInput, CaseListFilters, calculatePenalty } from '../services/case.service';
import { vesselService } from '../services/vessel.service';
import { noticeService } from '../services/notice.service';
import { s3Service } from '../services/s3.service';
import { pdfService, CasePdfData, loadSignerInfo } from '../services/pdf.service';
import { pdfSigner } from '../utils/pdfSigner';
import { emailService } from '../services/email.service';
import { exotelService } from '../services/exotel.service';
import { format } from 'date-fns';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { ObservationStatus, DataSource } from '@prisma/client';

/**
 * Create a new case
 * POST /cases
 */
export async function createCase(req: AuthenticatedRequest, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Case creation validation failed:', { errors: errors.array(), body: req.body });
    res.status(400).json({ success: false, errors: errors.array() });
    return;
  }

  try {
    const input: CreateCaseInput = {
      vesselName: req.body.vesselName,
      vesselNumber: req.body.registrationNumber,
      vesselTypeId: req.body.vesselTypeId,
      ownerName: req.body.ownerName,
      ownerContact1: req.body.ownerContact1,
      ownerContact2: req.body.ownerContact2,
      ownerEmail: req.body.ownerEmail,
      enforcementAreaId: req.body.enforcementAreaId,
      flyingLocationId: req.body.flyingLocationId,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      violationTypeId: req.body.violationTypeId,
      fishingLicenseTypeId: req.body.fishingLicenseTypeId,
      observationDate: new Date(req.body.observationDate),
      observationTime: req.body.observationTime,
      penaltyAmount: req.body.penaltyAmount,
      offenceOccurrence: req.body.offenceOccurrence,
      evidenceUrls: req.body.evidenceUrls,
      createdByUserId: req.user!.id,
    };

    const result = await caseService.createCase(input);

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.status(201).json({
      success: true,
      message: 'Case created successfully',
      data: result.case,
    });
  } catch (error) {
    logger.error('Error creating case:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create case',
    });
  }
}

/**
 * Get all cases with filters and pagination
 * GET /cases
 */
export async function getCases(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const filters: CaseListFilters = {
      search: req.query.search as string,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
    };

    // Handle enum filters with proper type casting
    if (req.query.status) {
      filters.status = req.query.status as ObservationStatus;
    }
    if (req.query.dataSource) {
      filters.dataSource = req.query.dataSource as DataSource;
    }
    if (req.query.enforcementAreaId) {
      filters.enforcementAreaId = req.query.enforcementAreaId as string;
    }
    if (req.query.violationTypeId) {
      filters.violationTypeId = req.query.violationTypeId as string;
    }
    if (req.query.startDate) {
      filters.dateFrom = new Date(req.query.startDate as string);
    }
    if (req.query.endDate) {
      filters.dateTo = new Date(req.query.endDate as string);
    }

    // Handle time filter
    if (req.query.timeFilter) {
      const now = new Date();
      const timeFilter = req.query.timeFilter as string;

      switch (timeFilter) {
        case 'today':
          filters.dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          filters.dateTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          break;
        case 'week':
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay());
          weekStart.setHours(0, 0, 0, 0);
          filters.dateFrom = weekStart;
          filters.dateTo = now;
          break;
        case 'month':
          filters.dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
          filters.dateTo = now;
          break;
        case 'year':
          filters.dateFrom = new Date(now.getFullYear(), 0, 1);
          filters.dateTo = now;
          break;
      }
    }

    // For ACF, filter by their district if set
    if (req.user?.role === 'acf' && req.user.enforcementAreaId) {
      filters.enforcementAreaId = req.user.enforcementAreaId;
    }

    const result = await caseService.getCases(filters);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error getting cases:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cases',
    });
  }
}

/**
 * Get case by ID
 * GET /cases/:id
 */
export async function getCaseById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await caseService.getCaseById(id);

    if (!result) {
      res.status(404).json({
        success: false,
        error: 'Case not found',
      });
      return;
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error getting case:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get case',
    });
  }
}

/**
 * Update case
 * PATCH /cases/:id
 */
export async function updateCase(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    // Basic update - extend as needed
    const result = await prisma.observation.update({
      where: { id },
      data: {
        ownerName: req.body.ownerName,
        ownerContact1: req.body.ownerContact1,
        ownerContact2: req.body.ownerContact2,
        internalNotes: req.body.internalNotes,
        remarksAcf: req.body.remarksAcf,
      },
      include: {
        enforcementArea: true,
        flyingLocation: true,
        vessel: true,
        violationType: true,
      },
    });

    res.json({
      success: true,
      message: 'Case updated successfully',
      data: result,
    });
  } catch (error) {
    logger.error('Error updating case:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update case',
    });
  }
}

/**
 * Dispose case (ACF only)
 * POST /cases/:id/dispose
 */
export async function disposeCase(req: AuthenticatedRequest, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, errors: errors.array() });
    return;
  }

  try {
    const { id } = req.params;
    const input: DisposeCaseInput = {
      observationId: id,
      disposedByUserId: req.user!.id,
      disposalReason: req.body.disposalReason,
      paidAmount: req.body.paidAmount ? Number(req.body.paidAmount) : undefined,
    };

    const result = await caseService.disposeCase(input);

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Case disposed successfully',
    });
  } catch (error) {
    logger.error('Error disposing case:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to dispose case',
    });
  }
}

/**
 * Get case statistics
 * GET /cases/stats
 */
export async function getCaseStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const enforcementAreaId = req.user?.role === 'acf' ? req.user.enforcementAreaId : undefined;
    const result = await caseService.getCaseStats(enforcementAreaId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error getting case stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get case statistics',
    });
  }
}

/**
 * Calculate penalty for a vessel and violation type
 * POST /cases/calculate-penalty
 */
export async function calculatePenaltyHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { vesselId, violationTypeId, occurrence } = req.body;

    if (!violationTypeId) {
      res.status(400).json({
        success: false,
        error: 'Violation type ID is required',
      });
      return;
    }

    // Pass occurrence if provided (for manual override)
    const manualOccurrence = occurrence ? parseInt(occurrence, 10) : undefined;
    const result = await calculatePenalty(vesselId || null, violationTypeId, manualOccurrence);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error calculating penalty:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate penalty',
    });
  }
}

/**
 * Upload evidence images
 * POST /cases/:id/evidence
 */
export async function uploadEvidence(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No files uploaded',
      });
      return;
    }

    const uploadedFiles = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const result = await s3Service.uploadEvidence(
        file.buffer,
        file.originalname,
        file.mimetype,
        id
      );

      if (result.success) {
        // Create evidence record in database
        const evidence = await prisma.observationEvidence.create({
          data: {
            observationId: id,
            evidenceUrl: result.url!,
            s3Key: result.key!,
            evidenceType: 'image',
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileSizeBytes: file.size,
            isPrimary: i === 0,
            capturedAt: new Date(),
          },
        });
        uploadedFiles.push(evidence);
      }
    }

    res.json({
      success: true,
      message: `${uploadedFiles.length} file(s) uploaded successfully`,
      data: uploadedFiles,
    });
  } catch (error) {
    logger.error('Error uploading evidence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload evidence',
    });
  }
}

/**
 * Get presigned upload URL
 * POST /cases/presigned-url
 */
export async function getPresignedUrl(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { fileName, mimeType, caseId } = req.body;

    if (!fileName || !mimeType) {
      res.status(400).json({
        success: false,
        error: 'fileName and mimeType are required',
      });
      return;
    }

    const result = await s3Service.getPresignedUploadUrl(
      fileName,
      mimeType,
      caseId ? `evidence/${caseId}` : 'evidence'
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error getting presigned URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get upload URL',
    });
  }
}

/**
 * Generate notice preview
 * GET /cases/:id/notice-preview
 */
export async function getNoticePreview(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const preview = await noticeService.getNoticePreview(id);

    if (!preview) {
      res.status(404).json({
        success: false,
        error: 'Case not found',
      });
      return;
    }

    res.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    logger.error('Error getting notice preview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get notice preview',
    });
  }
}

/**
 * Generate and download notice
 * POST /cases/:id/generate-notice
 */
export async function generateNotice(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { format = 'pdf', includeImages = true, includeSignature = true, signatureKey } = req.body;

    const result = await noticeService.generateNotice({
      observationId: id,
      format,
      includeImages,
      includeSignature,
      signatureKey,
    });

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Notice generated successfully',
      data: {
        previewUrl: result.previewUrl,
        s3Key: result.s3Key,
      },
    });
  } catch (error) {
    logger.error('Error generating notice:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate notice',
    });
  }
}

/**
 * Send case notifications
 * POST /cases/:id/send-notifications
 */
export async function sendNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { channels = ['email', 'sms'] } = req.body;

    const result = await caseService.sendCaseNotifications(id, channels);

    res.json({
      success: true,
      message: 'Notifications sent',
      data: result,
    });
  } catch (error) {
    logger.error('Error sending notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send notifications',
    });
  }
}

/**
 * Get violation types for dropdown
 * GET /cases/violation-types
 */
export async function getViolationTypes(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const violationTypes = await prisma.violationType.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
      },
    });

    res.json({
      success: true,
      data: violationTypes,
    });
  } catch (error) {
    logger.error('Error getting violation types:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get violation types',
    });
  }
}

/**
 * Get fishing license types for dropdown
 * GET /cases/license-types
 */
export async function getLicenseTypes(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const licenseTypes = await prisma.fishingLicenseType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
      },
    });

    res.json({
      success: true,
      data: licenseTypes,
    });
  } catch (error) {
    logger.error('Error getting license types:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get license types',
    });
  }
}

/**
 * Get enforcement areas for dropdown
 * GET /cases/enforcement-areas
 */
export async function getEnforcementAreas(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const areas = await prisma.enforcementArea.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
      },
    });

    res.json({
      success: true,
      data: areas,
    });
  } catch (error) {
    logger.error('Error getting enforcement areas:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get enforcement areas',
    });
  }
}

/**
 * Get flying locations for dropdown
 * GET /cases/flying-locations
 */
export async function getFlyingLocations(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { enforcementAreaId } = req.query;

    const locations = await prisma.flyingLocation.findMany({
      where: enforcementAreaId ? { enforcementAreaId: enforcementAreaId as string } : undefined,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        enforcementAreaId: true,
      },
    });

    res.json({
      success: true,
      data: locations,
    });
  } catch (error) {
    logger.error('Error getting flying locations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get flying locations',
    });
  }
}

/**
 * Search vessels for autocomplete
 * GET /cases/vessels/search
 */
export async function searchVessels(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!query || query.length < 2) {
      res.json({
        success: true,
        data: [],
      });
      return;
    }

    const vessels = await vesselService.searchVessels(query, limit);

    res.json({
      success: true,
      data: vessels,
    });
  } catch (error) {
    logger.error('Error searching vessels:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search vessels',
    });
  }
}

/**
 * Get vessel by registration number
 * GET /cases/vessels/:regNumber
 */
export async function getVesselByRegNumber(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { regNumber } = req.params;
    const vessel = await vesselService.getByRegistrationNumber(regNumber);

    if (!vessel) {
      res.status(404).json({
        success: false,
        error: 'Vessel not found',
      });
      return;
    }

    res.json({
      success: true,
      data: vessel,
    });
  } catch (error) {
    logger.error('Error getting vessel:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get vessel',
    });
  }
}

/**
 * Get vessel violation history
 * GET /cases/vessels/:id/history
 */
export async function getVesselHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const history = await vesselService.getViolationHistory(id);

    if (!history) {
      res.status(404).json({
        success: false,
        error: 'Vessel not found',
      });
      return;
    }

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    logger.error('Error getting vessel history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get vessel history',
    });
  }
}

/**
 * Get penalty configurations (admin only)
 * GET /cases/penalty-config
 */
export async function getPenaltyConfigs(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const configs = await prisma.penaltyConfiguration.findMany({
      include: {
        violationType: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: [
        { violationType: { name: 'asc' } },
        { occurrence: 'asc' },
      ],
    });

    res.json({
      success: true,
      data: configs,
    });
  } catch (error) {
    logger.error('Error getting penalty configs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get penalty configurations',
    });
  }
}

/**
 * Update penalty configuration (admin only)
 * PATCH /cases/penalty-config/:id
 */
export async function updatePenaltyConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { baseAmount, penaltyAmount } = req.body;

    const updated = await prisma.penaltyConfiguration.update({
      where: { id },
      data: {
        baseAmount: baseAmount !== undefined ? baseAmount : undefined,
        penaltyAmount: penaltyAmount !== undefined ? penaltyAmount : undefined,
        updatedAt: new Date(),
      },
      include: {
        violationType: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    res.json({
      success: true,
      message: 'Penalty configuration updated',
      data: updated,
    });
  } catch (error) {
    logger.error('Error updating penalty config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update penalty configuration',
    });
  }
}

/**
 * Create penalty configuration (admin only)
 * POST /cases/penalty-config
 */
export async function createPenaltyConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { violationTypeId, occurrence, baseAmount, penaltyAmount } = req.body;

    // Validate required fields
    if (!violationTypeId || !occurrence || baseAmount === undefined || penaltyAmount === undefined) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: violationTypeId, occurrence, baseAmount, penaltyAmount',
      });
      return;
    }

    // Check if config already exists for this violation type and occurrence
    const existing = await prisma.penaltyConfiguration.findFirst({
      where: { violationTypeId, occurrence },
    });

    if (existing) {
      res.status(409).json({
        success: false,
        error: `Penalty configuration already exists for this violation type with occurrence ${occurrence}`,
      });
      return;
    }

    const created = await prisma.penaltyConfiguration.create({
      data: {
        violationTypeId,
        occurrence,
        baseAmount,
        penaltyAmount,
        createdBy: req.user!.id,
      },
      include: {
        violationType: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: 'Penalty configuration created',
      data: created,
    });
  } catch (error) {
    logger.error('Error creating penalty config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create penalty configuration',
    });
  }
}

/**
 * Generate case PDF with images
 * POST /cases/:id/generate-pdf
 */
export async function generateCasePdf(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    // Get case with all relations
    const observation = await prisma.observation.findUnique({
      where: { id },
      select: {
        id: true,
        caseNumber: true,
        originalVesselName: true,
        originalVesselReg: true,
        ownerName: true,
        ownerContact1: true,
        ownerContact2: true,
        latitude: true,
        longitude: true,
        observationDate: true,
        penaltyAmount: true,
        offenceOccurrence: true,
        disposedBy: true,
        vessel: true,
        violationType: true,
        enforcementArea: true,
        flyingLocation: true,
        fishingLicenseType: true,
        evidence: true,
      },
    });

    if (!observation) {
      res.status(404).json({
        success: false,
        error: 'Case not found',
      });
      return;
    }

    // Get evidence image URLs
    const imageUrls: string[] = [];
    for (const ev of observation.evidence) {
      if (ev.s3Key) {
        const url = await s3Service.getPresignedDownloadUrl(ev.s3Key);
        if (url) imageUrls.push(url);
      } else if (ev.evidenceUrl) {
        imageUrls.push(ev.evidenceUrl);
      }
    }

    // Get signer information - prefer the ACF user who disposed the case, fallback to requesting user
    let signerUser = null;
    if (observation.disposedBy) {
      signerUser = await prisma.user.findUnique({
        where: { id: observation.disposedBy },
        select: { fullName: true, designation: true, signaturePath: true, role: true },
      });
    }

    // If no disposed user, use the requesting user (if they're ACF)
    if (!signerUser && req.user?.role === 'acf') {
      signerUser = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { fullName: true, designation: true, signaturePath: true, role: true },
      });
    }

    // Load signer info from certificate or signature file
    const signerInfo = loadSignerInfo(
      signerUser?.signaturePath || undefined,
      signerUser?.fullName,
      signerUser?.designation || 'सहाय्यक आयुक्त मत्स्यव्यवसाय'
    );

    // Prepare PDF data
    const pdfData: CasePdfData = {
      caseNumber: observation.caseNumber || undefined,
      currentDate: format(new Date(), 'dd/MM/yyyy'),
      vesselName: observation.originalVesselName || observation.vessel?.name || '',
      registrationNumber: observation.originalVesselReg || observation.vessel?.registrationNumber || '',
      ownerName: observation.ownerName || observation.vessel?.ownerName || '',
      districtName: observation.enforcementArea?.name || '',
      flyingLocationName: observation.flyingLocation?.name || '',
      latitude: observation.latitude?.toString() || '',
      longitude: observation.longitude?.toString() || '',
      enforcementAreaId: observation.enforcementArea?.id, // For ACF certificate lookup
      violationTypeName: observation.violationType?.name || '',
      fishingLicenseTypeName: observation.fishingLicenseType?.name || '',
      observationDate: format(observation.observationDate, 'yyyy-MM-dd'),
      processingFee: 20000, // Fixed processing fee
      violationPenalty: Math.max(0, Number(observation.penaltyAmount) - 20000),
      totalPenalty: Number(observation.penaltyAmount) || 0,
      occurrence: observation.offenceOccurrence || 1,
      images: imageUrls,
      signer: signerInfo,
    };

    // Generate and upload PDF
    const result = await pdfService.generateAndUploadCasePdf(pdfData, id);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error,
      });
      return;
    }

    // Generate download URL
    let pdfUrl: string | null = null;
    if (result.s3Key) {
      pdfUrl = await s3Service.getPresignedDownloadUrl(result.s3Key);
    }

    // Create notice record in database
    const noticeNumber = `NOT-${observation.caseNumber?.replace(/\//g, '-') || id.substring(0, 8)}-${Date.now().toString().slice(-6)}`;
    const notice = await prisma.caseNotice.create({
      data: {
        observationId: id,
        noticeNumber,
        status: 'generated',
        documentUrl: pdfUrl || undefined,
        s3Key: result.s3Key,
        generatedAt: new Date(),
        generatedBy: req.user?.id,
      },
    });

    logger.info(`Notice ${noticeNumber} created for case ${id}`);

    // Check if emails should be sent (query param sendEmails=true)
    const sendEmails = req.query.sendEmails === 'true' || req.body.sendEmails === true;
    let emailResult = null;

    if (sendEmails && result.pdfBuffer) {
      // Send emails to ACF, RDC, Commissioner, and Joint Commissioner
      emailResult = await emailService.sendCaseNotificationEmails(
        id,
        {
          caseNumber: pdfData.caseNumber || `CASE-${id.substring(0, 8)}`,
          vesselName: pdfData.vesselName,
          registrationNumber: pdfData.registrationNumber,
          ownerName: pdfData.ownerName,
          violationType: pdfData.violationTypeName,
          districtName: pdfData.districtName,
          observationDate: pdfData.observationDate,
          penaltyAmount: pdfData.totalPenalty,
          occurrence: pdfData.occurrence,
        },
        result.pdfBuffer,
        pdfUrl || undefined
      );

      logger.info(`Case emails sent for ${id}: ${emailResult.totalSent} sent, ${emailResult.totalFailed} failed`);
    }

    // Send SMS and WhatsApp to vessel owner
    let smsWhatsAppResult = null;
    const ownerPhones: string[] = [];
    if (observation.ownerContact1) ownerPhones.push(observation.ownerContact1);
    if (observation.ownerContact2) ownerPhones.push(observation.ownerContact2);
    // Also check vessel record for phone numbers
    if (observation.vessel?.ownerContact) ownerPhones.push(observation.vessel.ownerContact);
    if (observation.vessel?.ownerContact2) ownerPhones.push(observation.vessel.ownerContact2);

    // Remove duplicates
    const uniquePhones = [...new Set(ownerPhones.filter(p => p && p.trim()))];

    if (sendEmails && uniquePhones.length > 0) {
      smsWhatsAppResult = await exotelService.sendOwnerNotifications(
        uniquePhones,
        {
          caseNumber: pdfData.caseNumber || `CASE-${id.substring(0, 8)}`,
          vesselName: pdfData.vesselName,
          registrationNumber: pdfData.registrationNumber,
          ownerName: pdfData.ownerName,
          violationType: pdfData.violationTypeName,
          districtName: pdfData.districtName,
          observationDate: pdfData.observationDate,
          penaltyAmount: pdfData.totalPenalty,
          occurrence: pdfData.occurrence,
        }
      );

      logger.info(
        `Owner notifications for ${id}: SMS ${smsWhatsAppResult.sms.sent}/${uniquePhones.length}, ` +
        `WhatsApp ${smsWhatsAppResult.whatsapp.sent}/${uniquePhones.length}`
      );
    }

    // Update notice status
    if (sendEmails) {
      await prisma.caseNotice.update({
        where: { id: notice.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          emailSentAt: emailResult ? new Date() : undefined,
          emailStatus: emailResult ? (emailResult.totalFailed === 0 ? 'sent' : 'partial') : undefined,
          smsSentAt: smsWhatsAppResult?.sms.sent ? new Date() : undefined,
          smsStatus: smsWhatsAppResult?.sms.sent ? (smsWhatsAppResult.sms.failed === 0 ? 'sent' : 'partial') : undefined,
          whatsappSentAt: smsWhatsAppResult?.whatsapp.sent ? new Date() : undefined,
          whatsappStatus: smsWhatsAppResult?.whatsapp.sent ? (smsWhatsAppResult.whatsapp.failed === 0 ? 'sent' : 'partial') : undefined,
        },
      });
    }

    res.json({
      success: true,
      message: sendEmails
        ? `PDF generated, ${emailResult?.totalSent || 0} emails, ${smsWhatsAppResult?.sms.sent || 0} SMS, ${smsWhatsAppResult?.whatsapp.sent || 0} WhatsApp sent`
        : 'PDF generated successfully',
      data: {
        s3Key: result.s3Key,
        pdfUrl,
        emailsSent: emailResult?.totalSent || 0,
        emailsFailed: emailResult?.totalFailed || 0,
        emailResults: emailResult?.results || [],
        smsSent: smsWhatsAppResult?.sms.sent || 0,
        smsFailed: smsWhatsAppResult?.sms.failed || 0,
        whatsappSent: smsWhatsAppResult?.whatsapp.sent || 0,
        whatsappFailed: smsWhatsAppResult?.whatsapp.failed || 0,
        signingWarning: result.signingWarning,
      },
    });
  } catch (error) {
    logger.error('Error generating case PDF:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate PDF',
    });
  }
}

/**
 * Generate PDF from preview data (before case is created)
 * POST /cases/generate-pdf-preview
 */
export async function generatePdfFromPreview(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      vesselName,
      registrationNumber,
      ownerName,
      districtName,
      flyingLocationName,
      latitude,
      longitude,
      violationTypeName,
      fishingLicenseTypeName,
      observationDate,
      processingFee,
      violationPenalty,
      totalPenalty,
      occurrence,
      images,
    } = req.body;

    // Get signer information from requesting user (if ACF)
    let signerUser = null;
    if (req.user?.role === 'acf') {
      signerUser = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { fullName: true, designation: true, signaturePath: true, role: true },
      });
    }

    // Load signer info from certificate or signature file
    const signerInfo = loadSignerInfo(
      signerUser?.signaturePath || undefined,
      signerUser?.fullName,
      signerUser?.designation || 'सहाय्यक आयुक्त मत्स्यव्यवसाय'
    );

    const pdfData: CasePdfData = {
      currentDate: format(new Date(), 'dd/MM/yyyy'),
      vesselName: vesselName || '',
      registrationNumber: registrationNumber || '',
      ownerName: ownerName || '',
      districtName: districtName || '',
      flyingLocationName: flyingLocationName || '',
      latitude: latitude || '',
      longitude: longitude || '',
      violationTypeName: violationTypeName || '',
      fishingLicenseTypeName: fishingLicenseTypeName || '',
      observationDate: observationDate || format(new Date(), 'yyyy-MM-dd'),
      processingFee: processingFee || 20000,
      violationPenalty: violationPenalty || 0,
      totalPenalty: totalPenalty || (processingFee || 20000) + (violationPenalty || 0),
      occurrence: occurrence || 1,
      images: images || [],
      signer: signerInfo,
    };

    // Generate PDF (without S3 upload for preview)
    const result = await pdfService.generateCasePdf(pdfData);

    if (!result.success || !result.pdfBuffer) {
      res.status(500).json({
        success: false,
        error: result.error || 'PDF generation failed',
      });
      return;
    }

    // Return PDF as base64 for preview
    const pdfBase64 = result.pdfBuffer.toString('base64');

    res.json({
      success: true,
      message: 'PDF generated successfully',
      data: {
        pdfBase64,
        mimeType: 'application/pdf',
      },
    });
  } catch (error) {
    logger.error('Error generating PDF preview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate PDF preview',
    });
  }
}

/**
 * Send a test email to verify Brevo integration
 * POST /cases/test-email
 */
export async function sendTestEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { to } = req.body;

    if (!to) {
      res.status(400).json({
        success: false,
        error: 'Recipient email address is required',
      });
      return;
    }

    const result = await emailService.sendTestEmail(
      to,
      'Drone Dashboard - Test Email',
      `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e40af;">🚀 Email Configuration Test</h2>
        <p>This is a test email from the <strong>Drone Surveillance Dashboard</strong>.</p>
        <p>If you received this email, your Brevo email integration is working correctly!</p>
        <hr style="border: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #64748b; font-size: 12px;">
          Sent at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}<br>
          Sent by: ${req.user?.id || 'Unknown'}<br>
          System: Maharashtra Fisheries Department - Drone Dashboard
        </p>
      </div>
      `
    );

    if (result.success) {
      logger.info(`Test email sent successfully to ${to}, messageId: ${result.messageId}`);
      res.json({
        success: true,
        message: `Test email sent successfully to ${to}`,
        data: {
          messageId: result.messageId,
          recipient: result.recipient,
        },
      });
    } else {
      logger.error(`Failed to send test email to ${to}: ${result.error}`);
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to send test email',
      });
    }
  } catch (error) {
    logger.error('Error sending test email:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test email',
    });
  }
}

/**
 * Send a test SMS to verify Exotel integration
 * POST /cases/test-sms
 */
export async function sendTestSms(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { phone } = req.body;

    if (!phone) {
      res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
      return;
    }

    const result = await exotelService.sendTestSms(phone);

    if (result.success) {
      logger.info(`Test SMS sent successfully to ${phone}, messageId: ${result.messageId}`);
      res.json({
        success: true,
        message: `Test SMS sent successfully to ${result.phone}`,
        data: {
          messageId: result.messageId,
          phone: result.phone,
        },
      });
    } else {
      logger.error(`Failed to send test SMS to ${phone}: ${result.error}`);
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to send test SMS',
      });
    }
  } catch (error) {
    logger.error('Error sending test SMS:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test SMS',
    });
  }
}

/**
 * Send a test WhatsApp to verify Exotel integration
 * POST /cases/test-whatsapp
 */
export async function sendTestWhatsApp(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { phone } = req.body;

    if (!phone) {
      res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
      return;
    }

    const result = await exotelService.sendTestWhatsApp(phone);

    if (result.success) {
      logger.info(`Test WhatsApp sent successfully to ${phone}, messageId: ${result.messageId}`);
      res.json({
        success: true,
        message: `Test WhatsApp sent successfully to ${result.phone}`,
        data: {
          messageId: result.messageId,
          phone: result.phone,
        },
      });
    } else {
      logger.error(`Failed to send test WhatsApp to ${phone}: ${result.error}`);
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to send test WhatsApp',
      });
    }
  } catch (error) {
    logger.error('Error sending test WhatsApp:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test WhatsApp',
    });
  }
}

/**
 * Make a test call to verify Exotel call integration
 * POST /cases/test-call
 */
export async function makeTestCall(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { phone } = req.body;

    if (!phone) {
      res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
      return;
    }

    const result = await exotelService.makeTestCall(phone);

    if (result.success) {
      logger.info(`Test call initiated to ${phone}, callSid: ${result.callSid}`);
      res.json({
        success: true,
        message: `Test call initiated to ${result.phone}`,
        data: {
          callSid: result.callSid,
          phone: result.phone,
        },
      });
    } else {
      logger.error(`Failed to make test call to ${phone}: ${result.error}`);
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to make test call',
      });
    }
  } catch (error) {
    logger.error('Error making test call:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to make test call',
    });
  }
}

/**
 * Check ACF certificate status for a district
 * GET /cases/check-certificate/:enforcementAreaId
 */
export async function checkAcfCertificateStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { enforcementAreaId } = req.params;

    if (!enforcementAreaId) {
      res.status(400).json({
        success: false,
        error: 'Enforcement area ID is required',
      });
      return;
    }

    const certInfo = await pdfSigner.checkAcfCertificate(enforcementAreaId);

    res.json({
      success: true,
      data: certInfo,
    });
  } catch (error) {
    logger.error('Error checking ACF certificate status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check certificate status',
    });
  }
}

/**
 * Delete a case (Admin only)
 * DELETE /cases/:id
 */
export async function deleteCase(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    // Check if case exists
    const observation = await prisma.observation.findUnique({
      where: { id },
      include: {
        evidence: true,
        penalty: true,
      },
    });

    if (!observation) {
      res.status(404).json({
        success: false,
        error: 'Case not found',
      });
      return;
    }

    // Delete related records first (in order of dependencies)
    await prisma.$transaction(async (tx) => {
      // Delete penalty if exists
      await tx.penalty.deleteMany({
        where: { observationId: id },
      });

      // Delete evidence
      await tx.observationEvidence.deleteMany({
        where: { observationId: id },
      });

      // Delete action reports if any
      await tx.actionReport.deleteMany({
        where: { observationId: id },
      });

      // Delete the observation/case itself
      await tx.observation.delete({
        where: { id },
      });

      // Update vessel violation count if vessel exists
      if (observation.vesselId) {
        const remainingViolations = await tx.observation.count({
          where: { vesselId: observation.vesselId },
        });
        await tx.vessel.update({
          where: { id: observation.vesselId },
          data: { totalViolations: remainingViolations },
        });
      }
    });

    logger.info(`Case ${id} deleted by admin ${req.user?.userId}`);

    res.json({
      success: true,
      message: 'Case deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting case:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete case',
    });
  }
}
