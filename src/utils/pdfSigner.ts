/**
 * PDF Digital Signing Utility
 * Signs PDFs using .pfx (PKCS#12) certificates stored in S3 for each ACF user
 */

import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { PDFDocument } from 'pdf-lib';
import { logger } from '../config/logger';
import { s3Service } from '../services/s3.service';
import { prisma } from '../config/database';

// ============================================================
// INTERFACES
// ============================================================

export interface SigningResult {
  success: boolean;
  signedPdf?: Buffer;
  error?: string;
  warning?: string;
}

export interface SignerDetails {
  name: string;
  location?: string;
  reason?: string;
  contactInfo?: string;
}

export interface AcfCertificateInfo {
  hasCertificate: boolean;
  acfName?: string;
  certificateSubject?: string;
  certificateExpiry?: Date;
  error?: string;
}

// ============================================================
// PDF SIGNER SERVICE
// ============================================================

class PdfSignerService {
  /**
   * Get ACF user for a district/enforcement area
   */
  async getAcfForDistrict(enforcementAreaId: string): Promise<{
    acf: {
      id: string;
      fullName: string;
      pfxS3Key: string | null;
      pfxPassword: string | null;
      certificateSubject: string | null;
      certificateExpiry: Date | null;
    } | null;
    error?: string;
  }> {
    try {
      const acf = await prisma.user.findFirst({
        where: {
          enforcementAreaId,
          role: 'acf',
          status: 'active',
        },
        select: {
          id: true,
          fullName: true,
          pfxS3Key: true,
          pfxPassword: true,
          certificateSubject: true,
          certificateExpiry: true,
        },
      });

      return { acf };
    } catch (error) {
      logger.error('Error finding ACF for district:', error);
      return { acf: null, error: 'Failed to find ACF for district' };
    }
  }

  /**
   * Check if ACF has a valid certificate
   */
  async checkAcfCertificate(enforcementAreaId: string): Promise<AcfCertificateInfo> {
    const { acf, error } = await this.getAcfForDistrict(enforcementAreaId);

    if (error) {
      return { hasCertificate: false, error };
    }

    if (!acf) {
      return { hasCertificate: false, error: 'No ACF assigned to this district' };
    }

    if (!acf.pfxS3Key) {
      return {
        hasCertificate: false,
        acfName: acf.fullName,
        error: `ACF ${acf.fullName} has not uploaded a digital signature certificate`,
      };
    }

    // Check if certificate has expired
    if (acf.certificateExpiry && new Date(acf.certificateExpiry) < new Date()) {
      return {
        hasCertificate: false,
        acfName: acf.fullName,
        certificateSubject: acf.certificateSubject || undefined,
        certificateExpiry: acf.certificateExpiry,
        error: `ACF ${acf.fullName}'s certificate has expired`,
      };
    }

    return {
      hasCertificate: true,
      acfName: acf.fullName,
      certificateSubject: acf.certificateSubject || undefined,
      certificateExpiry: acf.certificateExpiry || undefined,
    };
  }

  /**
   * Fetch PFX certificate from S3
   */
  private async fetchPfxFromS3(s3Key: string): Promise<Buffer | null> {
    try {
      const buffer = await s3Service.getFileBuffer(s3Key);
      return buffer;
    } catch (error) {
      logger.error('Error fetching PFX from S3:', error);
      return null;
    }
  }

  /**
   * Sign a PDF using the ACF's certificate for the given district
   */
  async signPdfForDistrict(
    pdfBuffer: Buffer,
    enforcementAreaId: string,
    signerDetails?: Partial<SignerDetails>
  ): Promise<SigningResult> {
    // Find ACF for the district
    const { acf, error: acfError } = await this.getAcfForDistrict(enforcementAreaId);

    if (acfError || !acf) {
      return {
        success: false,
        error: acfError || 'No ACF found for this district',
        warning: 'PDF will be generated without digital signature',
      };
    }

    if (!acf.pfxS3Key) {
      return {
        success: false,
        error: `ACF ${acf.fullName} has not uploaded a digital signature certificate`,
        warning: 'PDF will be generated without digital signature',
      };
    }

    // Check certificate expiry
    if (acf.certificateExpiry && new Date(acf.certificateExpiry) < new Date()) {
      return {
        success: false,
        error: `ACF ${acf.fullName}'s certificate has expired`,
        warning: 'PDF will be generated without digital signature',
      };
    }

    // Fetch PFX from S3
    const pfxBuffer = await this.fetchPfxFromS3(acf.pfxS3Key);
    if (!pfxBuffer) {
      return {
        success: false,
        error: 'Failed to fetch certificate from storage',
        warning: 'PDF will be generated without digital signature',
      };
    }

    // Sign the PDF
    return this.signPdfWithCertificate(pdfBuffer, pfxBuffer, acf.pfxPassword || '', {
      name: signerDetails?.name || acf.certificateSubject || acf.fullName,
      location: signerDetails?.location || 'Maharashtra, India',
      reason: signerDetails?.reason || 'Digital Signature - Maharashtra Fisheries Department',
      contactInfo: signerDetails?.contactInfo || 'fisheries@maharashtra.gov.in',
    });
  }

  /**
   * Sign a PDF with a specific certificate buffer
   */
  async signPdfWithCertificate(
    pdfBuffer: Buffer,
    pfxBuffer: Buffer,
    password: string,
    signerDetails: SignerDetails
  ): Promise<SigningResult> {
    try {
      // Load the PDF with pdf-lib
      const pdfDoc = await PDFDocument.load(pdfBuffer);

      // Add signature placeholder
      pdflibAddPlaceholder({
        pdfDoc,
        reason: signerDetails.reason || 'Digital Signature - Maharashtra Fisheries Department',
        contactInfo: signerDetails.contactInfo || 'fisheries@maharashtra.gov.in',
        name: signerDetails.name,
        location: signerDetails.location || 'Maharashtra, India',
        signatureLength: 16384,
      });

      // Save the PDF with placeholder
      const pdfWithPlaceholder = await pdfDoc.save();

      // Create the P12 signer
      const signer = new P12Signer(pfxBuffer, {
        passphrase: password,
      });

      // Sign the PDF
      const signPdf = new SignPdf();
      const signedPdf = await signPdf.sign(Buffer.from(pdfWithPlaceholder), signer);

      logger.info(`PDF signed successfully by ${signerDetails.name}`);

      return {
        success: true,
        signedPdf: Buffer.from(signedPdf),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown signing error';
      logger.error('PDF signing failed:', error);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Sign PDF using a specific ACF user's certificate
   */
  async signPdfForAcf(
    pdfBuffer: Buffer,
    acfUserId: string,
    signerDetails?: Partial<SignerDetails>
  ): Promise<SigningResult> {
    try {
      const acf = await prisma.user.findUnique({
        where: { id: acfUserId },
        select: {
          id: true,
          fullName: true,
          pfxS3Key: true,
          pfxPassword: true,
          certificateSubject: true,
          certificateExpiry: true,
        },
      });

      if (!acf) {
        return {
          success: false,
          error: 'ACF user not found',
          warning: 'PDF will be generated without digital signature',
        };
      }

      if (!acf.pfxS3Key) {
        return {
          success: false,
          error: `ACF ${acf.fullName} has not uploaded a digital signature certificate`,
          warning: 'PDF will be generated without digital signature',
        };
      }

      // Fetch PFX from S3
      const pfxBuffer = await this.fetchPfxFromS3(acf.pfxS3Key);
      if (!pfxBuffer) {
        return {
          success: false,
          error: 'Failed to fetch certificate from storage',
          warning: 'PDF will be generated without digital signature',
        };
      }

      return this.signPdfWithCertificate(pdfBuffer, pfxBuffer, acf.pfxPassword || '', {
        name: signerDetails?.name || acf.certificateSubject || acf.fullName,
        location: signerDetails?.location || 'Maharashtra, India',
        reason: signerDetails?.reason || 'Digital Signature - Maharashtra Fisheries Department',
        contactInfo: signerDetails?.contactInfo || 'fisheries@maharashtra.gov.in',
      });
    } catch (error) {
      logger.error('Error signing PDF for ACF:', error);
      return {
        success: false,
        error: 'Failed to sign PDF',
        warning: 'PDF will be generated without digital signature',
      };
    }
  }

  /**
   * Check if signing is available (S3 is configured)
   * This is a simple check - actual certificate availability depends on the ACF
   */
  isSigningAvailable(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_ACCESS_KEY_ID !== 'your_aws_access_key'
    );
  }

  /**
   * Legacy method for backwards compatibility
   * Signs using environment variables if available
   * @deprecated Use signPdfForDistrict or signPdfForAcf instead
   */
  async signPdf(
    pdfBuffer: Buffer,
    signerDetails: SignerDetails
  ): Promise<SigningResult> {
    // If no district is specified, just return the unsigned PDF with a warning
    logger.warn('signPdf called without district context. PDF will not be digitally signed.');
    return {
      success: false,
      error: 'No district context provided for signing',
      warning: 'PDF will be generated without digital signature',
    };
  }
}

// Export singleton instance
export const pdfSigner = new PdfSignerService();
