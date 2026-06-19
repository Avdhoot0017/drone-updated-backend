/**
 * Auth Routes
 * Clean route definitions - all logic handled by controllers
 */

import { Router } from 'express';
import { body } from 'express-validator';
import multer from 'multer';
import path from 'path';
import { authController } from '../controllers';
import { authenticate, requireAdmin, asyncHandler } from '../middleware';

const router = Router();

// Configure multer for certificate upload (memory storage for S3)
// Accepts .pfx, .p12 (PKCS#12 with private key) and .cer (certificate)
const pfxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'application/x-pkcs12',
      'application/pkcs12',
      'application/x-x509-ca-cert',
      'application/pkix-cert',
      'application/octet-stream',
    ];
    const allowedExtensions = ['.pfx', '.p12', '.cer'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.some(e => ext === e)) {
      cb(null, true);
    } else {
      cb(new Error('Only .pfx, .p12, and .cer certificate files are allowed'));
    }
  },
});

// POST /auth/login - Login user
router.post(
  '/login',
  [
    body('userId').trim().notEmpty().withMessage('User ID is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  asyncHandler(authController.login)
);

// GET /auth/me - Get current user profile
router.get('/me', authenticate, asyncHandler(authController.getProfile));

// POST /auth/change-password - Change current user's password
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters'),
  ],
  asyncHandler(authController.changePassword)
);

// Configure multer for user creation - accepts certificate and private key files
const userFilesUpload = multer({
  storage: multer.memoryStorage(), // Use memory storage for all files
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'certFile') {
      // Allow certificate files (.cer, .pem)
      const allowedMimeTypes = [
        'application/x-x509-ca-cert',
        'application/x-pem-file',
        'application/pkix-cert',
        'application/octet-stream',
      ];
      const allowedExtensions = ['.cer', '.pem'];
      const ext = path.extname(file.originalname).toLowerCase();

      if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.some(e => ext === e)) {
        cb(null, true);
      } else {
        cb(new Error('Only .cer and .pem certificate files are allowed'));
      }
    } else if (file.fieldname === 'privateKeyFile') {
      // Allow private key files (.pfx, .p12)
      const allowedMimeTypes = [
        'application/x-pkcs12',
        'application/pkcs12',
        'application/octet-stream',
      ];
      const allowedExtensions = ['.pfx', '.p12'];
      const ext = path.extname(file.originalname).toLowerCase();

      if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.some(e => ext === e)) {
        cb(null, true);
      } else {
        cb(new Error('Only .pfx and .p12 private key files are allowed'));
      }
    } else {
      cb(new Error('Unexpected file field'));
    }
  },
});

// POST /auth/users - Create new user (admin only)
// Uses multer.fields() to handle certificate and private key file uploads for ACF role
router.post(
  '/users',
  authenticate,
  requireAdmin,
  userFilesUpload.fields([
    { name: 'certFile', maxCount: 1 },
    { name: 'privateKeyFile', maxCount: 1 },
  ]),
  [
    body('userId').trim().notEmpty().withMessage('User ID is required'),
    body('fullName').trim().notEmpty().withMessage('Full name is required'),
    body('role').isIn(['admin', 'member', 'operator', 'acf', 'commissioner']).withMessage('Invalid role'),
    // Email is mandatory for ACF and Operator roles
    body('email').custom((value, { req }) => {
      const role = req.body.role;
      if (['acf', 'operator'].includes(role) && !value?.trim()) {
        throw new Error('Email is required for ACF and Operator roles');
      }
      if (value && !value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        throw new Error('Invalid email format');
      }
      return true;
    }),
    // enforcementAreaId is mandatory for ACF role
    body('enforcementAreaId').custom((value, { req }) => {
      const role = req.body.role;
      if (role === 'acf' && !value?.trim()) {
        throw new Error('District is required for ACF role');
      }
      return true;
    }),
  ],
  asyncHandler(authController.createUser)
);

// GET /auth/users - Get all users (admin only)
router.get('/users', authenticate, requireAdmin, asyncHandler(authController.getAllUsers));

// POST /auth/users/:id/reset-password - Reset user password (admin only)
router.post(
  '/users/:id/reset-password',
  authenticate,
  requireAdmin,
  asyncHandler(authController.resetPassword)
);

// PATCH /auth/users/:id/status - Update user status (admin only)
router.patch(
  '/users/:id/status',
  authenticate,
  requireAdmin,
  [body('status').isIn(['active', 'inactive', 'suspended']).withMessage('Invalid status')],
  asyncHandler(authController.updateUserStatus)
);

// DELETE /auth/users/:id - Delete user (admin only)
router.delete('/users/:id', authenticate, requireAdmin, asyncHandler(authController.deleteUser));

// POST /auth/users/:id/certificate - Upload PFX certificate for ACF user (admin only)
router.post(
  '/users/:id/certificate',
  authenticate,
  requireAdmin,
  pfxUpload.single('pfxFile'),
  asyncHandler(authController.uploadCertificate)
);

// DELETE /auth/users/:id/certificate - Remove certificate from ACF user (admin only)
router.delete(
  '/users/:id/certificate',
  authenticate,
  requireAdmin,
  asyncHandler(authController.removeCertificate)
);

// GET /auth/users/:id/certificate/status - Check certificate status for ACF user
router.get(
  '/users/:id/certificate/status',
  authenticate,
  asyncHandler(authController.getCertificateStatus)
);

export default router;
