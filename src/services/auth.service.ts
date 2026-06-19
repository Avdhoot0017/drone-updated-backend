import { prisma } from '../config/database';
import { logger } from '../config/logger';
import {
  hashPassword,
  verifyPassword,
  generateRandomPassword,
  validatePasswordStrength,
} from '../utils/password';
import { generateToken, getTokenExpiration } from '../utils/jwt';
import {
  CreateUserInput,
  LoginInput,
  LoginResponse,
  ChangePasswordInput,
} from '../types';
import { UserRole, UserStatus } from '@prisma/client';
import { AppError } from '../middleware';
import { s3Service } from './s3.service';
import forge from 'node-forge';

class AuthService {
  /**
   * Login user
   */
  async login(input: LoginInput, ipAddress?: string): Promise<LoginResponse> {
    const { userId, password } = input;

    // Find user
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    // Check if user is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('Account is locked. Please try again later.', 423);
    }

    // Check if user is active
    if (user.status !== UserStatus.active) {
      throw new AppError('Account is not active', 403);
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);

    if (!isValid) {
      // Increment failed attempts
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
          // Lock after 5 failed attempts for 30 minutes
          lockedUntil:
            user.failedLoginAttempts >= 4
              ? new Date(Date.now() + 30 * 60 * 1000)
              : undefined,
        },
      });

      throw new AppError('Invalid credentials', 401);
    }

    // Reset failed attempts and update last login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
      },
    });

    // Generate token - include enforcementAreaId for ACF district filtering
    const token = generateToken({
      userId: user.userId,
      id: user.id,
      role: user.role,
      enforcementAreaId: user.enforcementAreaId,
    });

    // Log activity
    await this.logActivity(user.id, 'LOGIN', undefined, undefined, { ipAddress });

    logger.info(`User logged in: ${user.userId}`);

    return {
      user: {
        id: user.id,
        userId: user.userId,
        fullName: user.fullName,
        role: user.role,
        email: user.email || undefined,
        mustChangePassword: user.mustChangePassword,
      },
      token,
      expiresAt: getTokenExpiration(),
    };
  }

  /**
   * Create a new user (admin only)
   */
  async createUser(
    input: CreateUserInput,
    createdById: string
  ): Promise<{ userId: string; password: string }> {
    // Check if userId already exists
    const existing = await prisma.user.findUnique({
      where: { userId: input.userId },
    });

    if (existing) {
      throw new AppError('User ID already exists', 409);
    }

    // Check if email exists (if provided)
    if (input.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email: input.email },
      });

      if (emailExists) {
        throw new AppError('Email already exists', 409);
      }
    }

    // Generate password if not provided
    const password = input.password || generateRandomPassword();

    // Validate password strength
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      throw new AppError(passwordValidation.errors.join(', '), 400);
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Process certificate and private key files for ACF users
    let certS3Key: string | undefined;
    let pfxS3Key: string | undefined;
    let certificateSubject: string | undefined;
    let certificateExpiry: Date | undefined;
    const tempId = `temp_${Date.now()}`;

    // Process certificate file (.cer, .pem)
    if (input.certBuffer && input.certFilename) {
      try {
        // Parse certificate to extract subject and expiry
        let cert;
        const bufferStr = input.certBuffer.toString();

        if (bufferStr.includes('-----BEGIN CERTIFICATE-----')) {
          // PEM format
          cert = forge.pki.certificateFromPem(bufferStr);
        } else {
          // DER format
          const derAsn1 = forge.asn1.fromDer(input.certBuffer.toString('binary'));
          cert = forge.pki.certificateFromAsn1(derAsn1);
        }

        if (cert) {
          // Extract subject
          const subject = cert.subject.attributes
            .filter((attr) => attr.shortName && attr.value)
            .map((attr) => `${attr.shortName}=${attr.value}`)
            .join(', ');
          certificateSubject = subject;

          // Extract expiry
          certificateExpiry = new Date(cert.validity.notAfter);
        }

        // Upload certificate to S3
        const uploadResult = await s3Service.uploadFile(
          input.certBuffer,
          input.certFilename,
          'application/x-x509-ca-cert',
          `certificates/${tempId}/cert`
        );

        if (!uploadResult.success || !uploadResult.key) {
          throw new AppError('Failed to upload certificate file to storage', 500);
        }

        certS3Key = uploadResult.key;
      } catch (error) {
        if (error instanceof AppError) throw error;
        logger.error('Error parsing certificate file:', error);
        throw new AppError(
          'Failed to parse certificate file. Please ensure it is a valid .cer or .pem file.',
          400
        );
      }
    }

    // Process private key file (.pfx, .p12)
    if (input.privateKeyBuffer && input.privateKeyFilename) {
      try {
        // Verify the PFX can be parsed with the provided password
        const p12Asn1 = forge.asn1.fromDer(input.privateKeyBuffer.toString('binary'));
        forge.pkcs12.pkcs12FromAsn1(p12Asn1, input.privateKeyPassword || '');

        // Upload private key to S3
        const uploadResult = await s3Service.uploadFile(
          input.privateKeyBuffer,
          input.privateKeyFilename,
          'application/x-pkcs12',
          `certificates/${tempId}/key`
        );

        if (!uploadResult.success || !uploadResult.key) {
          throw new AppError('Failed to upload private key file to storage', 500);
        }

        pfxS3Key = uploadResult.key;
      } catch (error) {
        if (error instanceof AppError) throw error;
        logger.error('Error parsing private key file:', error);
        throw new AppError(
          'Failed to parse private key file. Please ensure the password is correct and the file is a valid .pfx or .p12 file.',
          400
        );
      }
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        userId: input.userId,
        passwordHash,
        fullName: input.fullName,
        role: input.role,
        email: input.email,
        phone: input.phone,
        designation: input.designation,
        enforcementAreaId: input.enforcementAreaId,
        canViewAllAreas: input.canViewAllAreas || false,
        signaturePath: input.signaturePath,
        mustChangePassword: true,
        createdBy: createdById,
        // Certificate fields
        certS3Key,
        pfxS3Key,
        pfxPassword: input.privateKeyPassword || null,
        certificateSubject,
        certificateExpiry,
      },
    });

    // Rename S3 keys from temp ID to actual user ID
    const updateData: { certS3Key?: string; pfxS3Key?: string } = {};

    // Rename certificate file
    if (certS3Key && certS3Key.includes('temp_')) {
      try {
        const buffer = await s3Service.getFileBuffer(certS3Key);
        if (buffer) {
          const newUpload = await s3Service.uploadFile(
            buffer,
            input.certFilename || 'certificate.cer',
            'application/x-x509-ca-cert',
            `certificates/${user.id}/cert`
          );
          if (newUpload.success && newUpload.key) {
            await s3Service.deleteFile(certS3Key);
            updateData.certS3Key = newUpload.key;
          }
        }
      } catch (error) {
        logger.error('Error renaming cert S3 key:', error);
      }
    }

    // Rename private key file
    if (pfxS3Key && pfxS3Key.includes('temp_')) {
      try {
        const buffer = await s3Service.getFileBuffer(pfxS3Key);
        if (buffer) {
          const newUpload = await s3Service.uploadFile(
            buffer,
            input.privateKeyFilename || 'privatekey.pfx',
            'application/x-pkcs12',
            `certificates/${user.id}/key`
          );
          if (newUpload.success && newUpload.key) {
            await s3Service.deleteFile(pfxS3Key);
            updateData.pfxS3Key = newUpload.key;
          }
        }
      } catch (error) {
        logger.error('Error renaming PFX S3 key:', error);
      }
    }

    // Update user with new S3 keys if any were renamed
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    }

    // Log activity
    await this.logActivity(createdById, 'CREATE_USER', 'user', user.id);

    logger.info(`User created: ${user.userId} by ${createdById}`);

    return {
      userId: user.userId,
      password,
    };
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify current password
    const isValid = await verifyPassword(input.currentPassword, user.passwordHash);

    if (!isValid) {
      throw new AppError('Current password is incorrect', 401);
    }

    // Validate new password
    const passwordValidation = validatePasswordStrength(input.newPassword);
    if (!passwordValidation.isValid) {
      throw new AppError(passwordValidation.errors.join(', '), 400);
    }

    // Hash new password
    const passwordHash = await hashPassword(input.newPassword);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    // Log activity
    await this.logActivity(userId, 'CHANGE_PASSWORD');

    logger.info(`Password changed for user: ${user.userId}`);
  }

  /**
   * Reset password (admin only)
   */
  async resetPassword(
    userId: string,
    adminId: string,
    customPassword?: string
  ): Promise<{ newPassword: string }> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Use custom password or generate random one
    const newPassword = customPassword || generateRandomPassword();

    // Validate password strength if custom password provided
    if (customPassword) {
      const passwordValidation = validatePasswordStrength(customPassword);
      if (!passwordValidation.isValid) {
        throw new AppError(passwordValidation.errors.join(', '), 400);
      }
    }

    const passwordHash = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    // Log activity
    await this.logActivity(adminId, 'RESET_PASSWORD', 'user', userId);

    logger.info(`Password reset for user: ${user.userId} by admin: ${adminId}`);

    return { newPassword };
  }

  /**
   * Get current user profile
   */
  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        enforcementArea: true,
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return {
      id: user.id,
      userId: user.userId,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      designation: user.designation,
      role: user.role,
      status: user.status,
      enforcementArea: user.enforcementArea
        ? {
            id: user.enforcementArea.id,
            name: user.enforcementArea.name,
          }
        : null,
      canViewAllAreas: user.canViewAllAreas,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers() {
    const users = await prisma.user.findMany({
      include: {
        enforcementArea: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => ({
      id: user.id,
      userId: user.userId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      enforcementArea: user.enforcementArea?.name,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    }));
  }

  /**
   * Update user status (admin only)
   */
  async updateUserStatus(
    userId: string,
    status: UserStatus,
    adminId: string
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    await prisma.user.update({
      where: { userId },
      data: { status },
    });

    await this.logActivity(adminId, 'UPDATE_USER_STATUS', 'user', userId, {
      newStatus: status,
    });
  }

  /**
   * Delete user (admin only)
   */
  async deleteUser(userId: string, adminId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (user.role === UserRole.admin) {
      // Check if this is the last admin
      const adminCount = await prisma.user.count({
        where: { role: UserRole.admin },
      });

      if (adminCount <= 1) {
        throw new AppError('Cannot delete the last admin user', 400);
      }
    }

    await prisma.user.delete({
      where: { userId },
    });

    await this.logActivity(adminId, 'DELETE_USER', 'user', userId);
  }

  /**
   * Log user activity
   */
  private async logActivity(
    userId: string,
    action: string,
    entityType?: string,
    entityId?: string,
    details?: Record<string, unknown>
  ) {
    await prisma.userActivityLog.create({
      data: {
        userId,
        action,
        entityType,
        entityId,
        details: details ? (details as object) : undefined,
      },
    });
  }

  /**
   * Upload certificate (PFX/P12/CER) for ACF user
   */
  async uploadCertificate(
    userId: string,
    certBuffer: Buffer,
    originalFilename: string,
    password?: string
  ): Promise<{
    certificateSubject: string;
    certificateExpiry: Date;
    s3Key: string;
  }> {
    // Find user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (user.role !== UserRole.acf) {
      throw new AppError('Certificates can only be uploaded for ACF users', 400);
    }

    const ext = originalFilename.toLowerCase();
    const isPfx = ext.endsWith('.pfx') || ext.endsWith('.p12');
    const isCer = ext.endsWith('.cer');

    // Parse certificate to extract info
    let certificateSubject = '';
    let certificateExpiry = new Date();

    try {
      if (isPfx) {
        // Decode PFX/P12 using node-forge
        const p12Asn1 = forge.asn1.fromDer(certBuffer.toString('binary'));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || '');

        // Get certificate bags
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
        const certBag = certBags[forge.pki.oids.certBag];

        if (certBag && certBag.length > 0) {
          const cert = certBag[0].cert;
          if (cert) {
            // Extract subject
            const subject = cert.subject.attributes
              .filter((attr) => attr.shortName && attr.value)
              .map((attr) => `${attr.shortName}=${attr.value}`)
              .join(', ');
            certificateSubject = subject;

            // Extract expiry
            certificateExpiry = new Date(cert.validity.notAfter);
          }
        }
      } else if (isCer) {
        // Parse CER (X.509 certificate) - DER or PEM encoded
        let cert;
        const bufferStr = certBuffer.toString();

        if (bufferStr.includes('-----BEGIN CERTIFICATE-----')) {
          // PEM format
          cert = forge.pki.certificateFromPem(bufferStr);
        } else {
          // DER format
          const derAsn1 = forge.asn1.fromDer(certBuffer.toString('binary'));
          cert = forge.pki.certificateFromAsn1(derAsn1);
        }

        if (cert) {
          // Extract subject
          const subject = cert.subject.attributes
            .filter((attr) => attr.shortName && attr.value)
            .map((attr) => `${attr.shortName}=${attr.value}`)
            .join(', ');
          certificateSubject = subject;

          // Extract expiry
          certificateExpiry = new Date(cert.validity.notAfter);
        }

        logger.warn(`CER file uploaded for user ${user.userId}. Note: CER files don't contain private keys and cannot be used for PDF signing.`);
      }
    } catch (error) {
      logger.error('Error parsing certificate:', error);
      throw new AppError(
        'Failed to parse certificate. Please ensure the password is correct (for PFX) and the file is a valid certificate.',
        400
      );
    }

    // Delete old certificate from S3 if exists
    if (user.pfxS3Key) {
      await s3Service.deleteFile(user.pfxS3Key);
    }

    // Upload new certificate to S3
    const mimeType = isPfx ? 'application/x-pkcs12' : 'application/x-x509-ca-cert';
    const uploadResult = await s3Service.uploadFile(
      certBuffer,
      originalFilename,
      mimeType,
      `certificates/${userId}`
    );

    if (!uploadResult.success || !uploadResult.key) {
      throw new AppError('Failed to upload certificate to storage', 500);
    }

    // Update user record
    await prisma.user.update({
      where: { id: userId },
      data: {
        pfxS3Key: uploadResult.key,
        pfxPassword: password || null,
        certificateSubject,
        certificateExpiry,
      },
    });

    logger.info(`Certificate uploaded for ACF user: ${user.userId}`);

    return {
      certificateSubject,
      certificateExpiry,
      s3Key: uploadResult.key,
    };
  }

  /**
   * Remove certificate from ACF user
   */
  async removeCertificate(userId: string, adminId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.pfxS3Key) {
      throw new AppError('User does not have a certificate', 400);
    }

    // Delete certificate from S3
    await s3Service.deleteFile(user.pfxS3Key);

    // Update user record
    await prisma.user.update({
      where: { id: userId },
      data: {
        pfxS3Key: null,
        pfxPassword: null,
        certificateSubject: null,
        certificateExpiry: null,
      },
    });

    await this.logActivity(adminId, 'REMOVE_CERTIFICATE', 'user', userId);

    logger.info(`Certificate removed for user: ${user.userId}`);
  }

  /**
   * Get certificate status for a user
   */
  async getCertificateStatus(userId: string): Promise<{
    hasCertificate: boolean;
    certificateSubject?: string;
    certificateExpiry?: Date;
    isExpired?: boolean;
    expiresInDays?: number;
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        pfxS3Key: true,
        certificateSubject: true,
        certificateExpiry: true,
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.pfxS3Key) {
      return { hasCertificate: false };
    }

    const now = new Date();
    const expiry = user.certificateExpiry ? new Date(user.certificateExpiry) : null;
    const isExpired = expiry ? expiry < now : false;
    const expiresInDays = expiry
      ? Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : undefined;

    return {
      hasCertificate: true,
      certificateSubject: user.certificateSubject || undefined,
      certificateExpiry: user.certificateExpiry || undefined,
      isExpired,
      expiresInDays,
    };
  }
}

export const authService = new AuthService();
