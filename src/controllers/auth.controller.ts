/**
 * Auth Controller
 * Handles all authentication-related request/response logic
 */

import { Response } from 'express';
import { validationResult } from 'express-validator';
import { authService } from '../services';
import { AppError } from '../middleware';
import { AuthenticatedRequest } from '../types';

/**
 * POST /auth/login
 */
export const login = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError(errors.array()[0].msg, 400);
  }

  const { userId, password } = req.body;
  const ipAddress = req.ip || req.socket.remoteAddress;

  const result = await authService.login({ userId, password }, ipAddress);

  res.json({
    success: true,
    data: result,
  });
};

/**
 * GET /auth/me
 */
export const getProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const profile = await authService.getProfile(req.user!.id);

  res.json({
    success: true,
    data: profile,
  });
};

/**
 * POST /auth/change-password
 */
export const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError(errors.array()[0].msg, 400);
  }

  const { currentPassword, newPassword } = req.body;

  await authService.changePassword(req.user!.id, {
    currentPassword,
    newPassword,
  });

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
};

/**
 * POST /auth/users
 */
export const createUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError(errors.array()[0].msg, 400);
  }

  const role = req.body.role;
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const certFile = files?.certFile?.[0];
  const privateKeyFile = files?.privateKeyFile?.[0];
  const privateKeyPassword = req.body.privateKeyPassword;

  // Both certificate and private key are required for ACF role
  if (role === 'acf') {
    if (!certFile) {
      throw new AppError('Certificate file (.cer/.pem) is required for ACF role', 400);
    }
    if (!privateKeyFile) {
      throw new AppError('Private key file (.pfx/.p12) is required for ACF role', 400);
    }
  }

  // Prepare user data with certificate and private key info
  const userData = {
    ...req.body,
    certBuffer: certFile?.buffer,
    certFilename: certFile?.originalname,
    privateKeyBuffer: privateKeyFile?.buffer,
    privateKeyFilename: privateKeyFile?.originalname,
    privateKeyPassword: privateKeyPassword || undefined,
  };

  const result = await authService.createUser(userData, req.user!.id);

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: result,
  });
};

/**
 * GET /auth/users
 */
export const getAllUsers = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const users = await authService.getAllUsers();

  res.json({
    success: true,
    data: users,
  });
};

/**
 * POST /auth/users/:id/reset-password
 */
export const resetPassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { password } = req.body;

  const result = await authService.resetPassword(id, req.user!.id, password);

  res.json({
    success: true,
    message: 'Password reset successfully',
    data: result,
  });
};

/**
 * PATCH /auth/users/:id/status
 */
export const updateUserStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError(errors.array()[0].msg, 400);
  }

  const { id } = req.params;
  const { status } = req.body;

  await authService.updateUserStatus(id, status, req.user!.id);

  res.json({
    success: true,
    message: 'User status updated successfully',
  });
};

/**
 * DELETE /auth/users/:id
 */
export const deleteUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  await authService.deleteUser(id, req.user!.id);

  res.json({
    success: true,
    message: 'User deleted successfully',
  });
};

/**
 * POST /auth/users/:id/certificate
 * Upload PFX certificate for ACF user
 */
export const uploadCertificate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { password } = req.body;
  const pfxFile = req.file as Express.Multer.File | undefined;

  if (!pfxFile) {
    throw new AppError('PFX certificate file is required', 400);
  }

  const result = await authService.uploadCertificate(id, pfxFile.buffer, pfxFile.originalname, password);

  res.json({
    success: true,
    message: 'Certificate uploaded successfully',
    data: result,
  });
};

/**
 * DELETE /auth/users/:id/certificate
 * Remove certificate from ACF user
 */
export const removeCertificate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  await authService.removeCertificate(id, req.user!.id);

  res.json({
    success: true,
    message: 'Certificate removed successfully',
  });
};

/**
 * GET /auth/users/:id/certificate/status
 * Check certificate status for ACF user
 */
export const getCertificateStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const status = await authService.getCertificateStatus(id);

  res.json({
    success: true,
    data: status,
  });
};
