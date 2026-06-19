/**
 * Case Routes
 * Routes for case management operations
 */

import { Router } from 'express';
import { body, query } from 'express-validator';
import * as caseController from '../controllers/case.controller';
import { authenticate, requireOperator, requireACF, requireCaseAccess, requireAdmin, asyncHandler } from '../middleware';
import multer from 'multer';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// ============================================================
// LOOKUP ROUTES (All authenticated users)
// ============================================================

// GET /cases/violation-types - Get violation types for dropdown
router.get('/violation-types', authenticate, asyncHandler(caseController.getViolationTypes));

// GET /cases/license-types - Get fishing license types for dropdown
router.get('/license-types', authenticate, asyncHandler(caseController.getLicenseTypes));

// GET /cases/enforcement-areas - Get enforcement areas for dropdown
router.get('/enforcement-areas', authenticate, asyncHandler(caseController.getEnforcementAreas));

// GET /cases/check-certificate/:enforcementAreaId - Check ACF certificate status for a district
router.get('/check-certificate/:enforcementAreaId', authenticate, requireOperator, asyncHandler(caseController.checkAcfCertificateStatus));

// GET /cases/vessels/search - Search vessels for autocomplete
router.get('/vessels/search', authenticate, asyncHandler(caseController.searchVessels));

// GET /cases/vessels/:regNumber - Get vessel by registration number
router.get('/vessels/by-reg/:regNumber', authenticate, asyncHandler(caseController.getVesselByRegNumber));

// GET /cases/vessels/:id/history - Get vessel violation history
router.get('/vessels/:id/history', authenticate, asyncHandler(caseController.getVesselHistory));

// ============================================================
// CASE STATISTICS (Case access roles)
// ============================================================

// GET /cases/stats - Get case statistics
router.get('/stats', authenticate, requireCaseAccess, asyncHandler(caseController.getCaseStats));

// ============================================================
// PENALTY CALCULATION (Operators and above)
// ============================================================

// POST /cases/calculate-penalty - Calculate penalty for vessel/violation
router.post(
  '/calculate-penalty',
  authenticate,
  requireOperator,
  [
    body('violationTypeId').notEmpty().withMessage('Violation type is required'),
  ],
  asyncHandler(caseController.calculatePenaltyHandler)
);

// GET /cases/flying-locations - Get flying locations for dropdown
router.get('/flying-locations', authenticate, asyncHandler(caseController.getFlyingLocations));

// ============================================================
// PENALTY CONFIGURATION (Admin only)
// ============================================================

// GET /cases/penalty-config - Get penalty configurations
router.get('/penalty-config', authenticate, requireAdmin, asyncHandler(caseController.getPenaltyConfigs));

// POST /cases/penalty-config - Create penalty configuration
router.post('/penalty-config', authenticate, requireAdmin, asyncHandler(caseController.createPenaltyConfig));

// PATCH /cases/penalty-config/:id - Update penalty configuration
router.patch(
  '/penalty-config/:id',
  authenticate,
  requireAdmin,
  asyncHandler(caseController.updatePenaltyConfig)
);

// ============================================================
// FILE UPLOAD ROUTES (Operators)
// ============================================================

// POST /cases/presigned-url - Get presigned URL for upload
router.post(
  '/presigned-url',
  authenticate,
  requireOperator,
  [
    body('fileName').notEmpty().withMessage('File name is required'),
    body('mimeType').notEmpty().withMessage('MIME type is required'),
  ],
  asyncHandler(caseController.getPresignedUrl)
);

// ============================================================
// CASE CRUD ROUTES
// ============================================================

// GET /cases - Get all cases with filters
router.get(
  '/',
  authenticate,
  requireCaseAccess,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  asyncHandler(caseController.getCases)
);

// POST /cases - Create new case (Operators only)
router.post(
  '/',
  authenticate,
  requireOperator,
  [
    body('vesselName').trim().notEmpty().withMessage('Vessel name is required'),
    body('registrationNumber').trim().notEmpty().withMessage('Registration number is required'),
    body('violationTypeId').notEmpty().withMessage('Violation type is required'),
    body('enforcementAreaId').notEmpty().withMessage('Enforcement area is required'),
    body('observationDate').notEmpty().isDate().withMessage('Valid observation date is required'),
  ],
  asyncHandler(caseController.createCase)
);

// GET /cases/:id - Get case by ID
router.get('/:id', authenticate, requireCaseAccess, asyncHandler(caseController.getCaseById));

// PATCH /cases/:id - Update case
router.patch('/:id', authenticate, requireOperator, asyncHandler(caseController.updateCase));

// DELETE /cases/:id - Delete case (Admin only)
router.delete('/:id', authenticate, requireAdmin, asyncHandler(caseController.deleteCase));

// ============================================================
// CASE DISPOSAL (ACF only)
// ============================================================

// POST /cases/:id/dispose - Dispose case
router.post(
  '/:id/dispose',
  authenticate,
  requireACF,
  [
    body('disposalReason')
      .trim()
      .notEmpty()
      .withMessage('Disposal reason is required'),
    // Note: 100 character minimum only enforced when paid amount < expected amount (checked in service)
  ],
  asyncHandler(caseController.disposeCase)
);

// ============================================================
// EVIDENCE UPLOAD (Operators)
// ============================================================

// POST /cases/:id/evidence - Upload evidence images
router.post(
  '/:id/evidence',
  authenticate,
  requireOperator,
  upload.array('images', 5), // Max 5 images
  asyncHandler(caseController.uploadEvidence)
);

// ============================================================
// NOTICE GENERATION (Case access roles)
// ============================================================

// GET /cases/:id/notice-preview - Get notice preview data
router.get('/:id/notice-preview', authenticate, requireCaseAccess, asyncHandler(caseController.getNoticePreview));

// POST /cases/:id/generate-notice - Generate and download notice
router.post(
  '/:id/generate-notice',
  authenticate,
  requireOperator,
  asyncHandler(caseController.generateNotice)
);

// POST /cases/:id/generate-pdf - Generate case PDF with images
router.post(
  '/:id/generate-pdf',
  authenticate,
  requireOperator,
  asyncHandler(caseController.generateCasePdf)
);

// POST /cases/generate-pdf-preview - Generate PDF from preview data (no case ID required)
router.post(
  '/generate-pdf-preview',
  authenticate,
  requireOperator,
  asyncHandler(caseController.generatePdfFromPreview)
);

// ============================================================
// NOTIFICATIONS (Operators)
// ============================================================

// POST /cases/:id/send-notifications - Send case notifications
router.post(
  '/:id/send-notifications',
  authenticate,
  requireOperator,
  asyncHandler(caseController.sendNotifications)
);

// ============================================================
// EMAIL TESTING (Admin only)
// ============================================================

// POST /cases/test-email - Send a test email to verify Brevo integration
router.post(
  '/test-email',
  authenticate,
  requireAdmin,
  asyncHandler(caseController.sendTestEmail)
);

// POST /cases/test-sms - Send a test SMS to verify Exotel integration
router.post(
  '/test-sms',
  authenticate,
  requireAdmin,
  asyncHandler(caseController.sendTestSms)
);

// POST /cases/test-whatsapp - Send a test WhatsApp to verify Exotel integration
router.post(
  '/test-whatsapp',
  authenticate,
  requireAdmin,
  asyncHandler(caseController.sendTestWhatsApp)
);

// POST /cases/test-call - Make a test call to verify Exotel call integration
router.post(
  '/test-call',
  authenticate,
  requireAdmin,
  asyncHandler(caseController.makeTestCall)
);

export default router;
