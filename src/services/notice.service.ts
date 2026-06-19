/**
 * Notice Generation Service
 * Generates legal notices from docx templates with case data
 * Supports image attachments and digital signatures
 */

import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { s3Service } from './s3.service';

const prisma = new PrismaClient();

// Template path
const TEMPLATE_PATH = path.join(__dirname, '../config/Case Draft-template.docx');

// ============================================================
// INTERFACES
// ============================================================

interface NoticeData {
  // Case details
  caseNumber: string;
  date: string;
  district: string;

  // Vessel details
  vesselName: string;
  vesselNumber: string;
  vesselType: string;

  // Owner details
  ownerName: string;
  residence: string;
  taluka: string;
  ownerDistrict: string;

  // Location details
  latitude: string;
  longitude: string;
  flyingLocation: string;

  // Dates
  observationDate: string;
  hearingDate: string;
  hearingTime: string;
  noticeDate: string;

  // Penalty
  penaltyAmount: string;
  totalPenalty: string;

  // Officer/Place details
  place: string;
  officerName: string;
}

interface NoticeGenerationResult {
  success: boolean;
  docxBuffer?: Buffer;
  pdfBuffer?: Buffer;
  previewUrl?: string;
  s3Key?: string;
  error?: string;
}

interface GenerateNoticeInput {
  observationId: string;
  format?: 'docx' | 'pdf' | 'both';
  includeImages?: boolean;
  includeSignature?: boolean;
  signatureKey?: string;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Convert number to words in Indian numbering system
 */
function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num === 0) return 'Zero';
  if (num < 0) return 'Minus ' + numberToWords(-num);

  let words = '';

  if (Math.floor(num / 10000000) > 0) {
    words += numberToWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }

  if (Math.floor(num / 100000) > 0) {
    words += numberToWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }

  if (Math.floor(num / 1000) > 0) {
    words += numberToWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }

  if (Math.floor(num / 100) > 0) {
    words += numberToWords(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }

  if (num > 0) {
    if (words !== '') words += 'and ';
    if (num < 20) {
      words += ones[num];
    } else {
      words += tens[Math.floor(num / 10)];
      if (num % 10 > 0) {
        words += '-' + ones[num % 10];
      }
    }
  }

  return words.trim();
}

/**
 * Format date to DD/MM/YYYY
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Format decimal coordinates
 */
function formatCoordinate(coord: number | null, type: 'lat' | 'lng'): string {
  if (coord === null) return 'N/A';
  const direction = type === 'lat' ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W');
  return `${Math.abs(coord).toFixed(6)}° ${direction}`;
}

/**
 * Generate notice number
 */
function generateNoticeNumber(): string {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `NOT/${year}/${month}/${random}`;
}

// ============================================================
// NOTICE SERVICE
// ============================================================

class NoticeService {
  /**
   * Generate notice from template with case data
   */
  async generateNotice(input: GenerateNoticeInput): Promise<NoticeGenerationResult> {
    const { observationId, format = 'both', includeImages = true, includeSignature = true, signatureKey } = input;

    try {
      // Fetch observation with all related data
      const observation = await prisma.observation.findUnique({
        where: { id: observationId },
        include: {
          vessel: {
            include: {
              vesselType: true,
            },
          },
          violationType: true,
          enforcementArea: true,
          flyingLocation: true,
          fishingLicenseType: true,
          evidence: true,
        },
      });

      if (!observation) {
        return { success: false, error: 'Observation not found' };
      }

      // Get user who created the observation
      let creatorName = 'System';
      if (observation.createdByUserId) {
        const creator = await prisma.user.findUnique({
          where: { id: observation.createdByUserId },
          select: { fullName: true },
        });
        if (creator) creatorName = creator.fullName;
      }

      // Calculate hearing date (7 days from now)
      const hearingDate = new Date();
      hearingDate.setDate(hearingDate.getDate() + 7);

      // Prepare notice data for Marathi template
      const noticeData: NoticeData = {
        // Case details
        caseNumber: observation.caseNumber?.replace(/.*\//, '') || 'XXXXX',
        date: formatDate(new Date()),
        district: observation.enforcementArea?.name || '',

        // Vessel details
        vesselName: observation.vessel?.name || observation.originalVesselName || '',
        vesselNumber: observation.vessel?.registrationNumber || observation.originalVesselReg || '',
        vesselType: observation.vessel?.vesselType?.name || observation.originalVesselType || 'पर्ससीन',

        // Owner details
        ownerName: observation.ownerName || observation.vessel?.ownerName || '',
        residence: '',
        taluka: observation.flyingLocation?.name || '',
        ownerDistrict: observation.enforcementArea?.name || '',

        // Location details
        latitude: observation.latitude?.toNumber()?.toFixed(6) || '',
        longitude: observation.longitude?.toNumber()?.toFixed(6) || '',
        flyingLocation: observation.flyingLocation?.name || '',

        // Dates
        observationDate: formatDate(observation.observationDate),
        hearingDate: formatDate(hearingDate),
        hearingTime: '11:00',
        noticeDate: formatDate(new Date()),

        // Penalty (in lakhs for display)
        penaltyAmount: ((observation.penaltyAmount?.toNumber() || 0) / 100000).toFixed(2),
        totalPenalty: ((observation.penaltyAmount?.toNumber() || 0) / 100000).toFixed(2),

        // Officer/Place details
        place: observation.enforcementArea?.name || '',
        officerName: creatorName,
      };

      const result: NoticeGenerationResult = { success: true };

      // Generate DOCX if requested
      if (format === 'docx' || format === 'both') {
        const docxResult = await this.generateDocx(noticeData);
        if (docxResult) {
          result.docxBuffer = docxResult;
        }
      }

      // Generate PDF with images and signature
      if (format === 'pdf' || format === 'both') {
        const pdfResult = await this.generatePdf(
          noticeData,
          includeImages ? observation.evidence : [],
          includeSignature,
          signatureKey
        );
        if (pdfResult) {
          result.pdfBuffer = pdfResult;
        }
      }

      // Upload to S3 if we have a PDF
      if (result.pdfBuffer) {
        const uploadResult = await s3Service.uploadNotice(
          result.pdfBuffer,
          `notice-${observation.caseNumber?.replace(/\//g, '-') || observationId}.pdf`,
          observationId
        );

        if (uploadResult.success) {
          result.s3Key = uploadResult.key;
          result.previewUrl = uploadResult.url;
        }
      }

      return result;

    } catch (error) {
      logger.error('Notice generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Notice generation failed',
      };
    }
  }

  /**
   * Generate DOCX from template
   */
  private async generateDocx(data: NoticeData): Promise<Buffer | null> {
    try {
      // Check if template exists
      if (!fs.existsSync(TEMPLATE_PATH)) {
        logger.warn('DOCX template not found, skipping DOCX generation');
        return null;
      }

      const content = fs.readFileSync(TEMPLATE_PATH, 'binary');
      const zip = new PizZip(content);

      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: {
          start: '{{',
          end: '}}',
        },
      });

      // Set template data - matching Marathi template placeholders
      doc.render({
        // Case details
        caseNumber: data.caseNumber,
        date: data.date,
        district: data.district,

        // Vessel details
        vesselName: data.vesselName,
        vesselNumber: data.vesselNumber,
        vesselType: data.vesselType,

        // Owner details
        ownerName: data.ownerName,
        residence: data.residence,
        taluka: data.taluka,
        ownerDistrict: data.ownerDistrict,

        // Location details
        latitude: data.latitude,
        longitude: data.longitude,
        flyingLocation: data.flyingLocation,

        // Dates
        observationDate: data.observationDate,
        hearingDate: data.hearingDate,
        hearingTime: data.hearingTime,
        noticeDate: data.noticeDate,

        // Penalty
        penaltyAmount: data.penaltyAmount,
        totalPenalty: data.totalPenalty,

        // Officer/Place details
        place: data.place,
        officerName: data.officerName,
      });

      const buf = doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });

      return buf;

    } catch (error) {
      logger.error('DOCX generation error:', error);
      return null;
    }
  }

  /**
   * Generate PDF with embedded images and signature
   */
  private async generatePdf(
    data: NoticeData,
    evidence: Array<{ s3Key: string | null; evidenceUrl: string }>,
    includeSignature: boolean,
    signatureKey?: string
  ): Promise<Buffer | null> {
    try {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      // Page 1: Notice content
      let page = pdfDoc.addPage([595, 842]); // A4 size
      const { height } = page.getSize();
      let yPosition = height - 50;

      const drawText = (text: string, options: { bold?: boolean; fontSize?: number; indent?: number } = {}) => {
        const { bold = false, fontSize = 11, indent = 50 } = options;
        page.drawText(text, {
          x: indent,
          y: yPosition,
          size: fontSize,
          font: bold ? boldFont : font,
          color: rgb(0, 0, 0),
        });
        yPosition -= fontSize + 6;
      };

      const drawLine = () => {
        page.drawLine({
          start: { x: 50, y: yPosition },
          end: { x: 545, y: yPosition },
          thickness: 0.5,
          color: rgb(0, 0, 0),
        });
        yPosition -= 15;
      };

      // Header
      drawText('MAHARASHTRA FISHERIES DEPARTMENT', { bold: true, fontSize: 14 });
      drawText('VIOLATION NOTICE', { bold: true, fontSize: 12 });
      drawText('(Maharashtra Marine Fishing Regulation Act, 2021 - Section 16)', { fontSize: 9 });
      yPosition -= 10;
      drawLine();

      // Case details
      drawText(`Case Number: ${data.caseNumber}/2026`, { bold: true });
      drawText(`Date: ${data.date}`);
      drawText(`District: ${data.district}`);
      yPosition -= 10;

      // Vessel Information
      drawText('VESSEL INFORMATION', { bold: true, fontSize: 12 });
      drawLine();
      drawText(`Vessel Name: ${data.vesselName}`);
      drawText(`Registration Number: ${data.vesselNumber}`);
      drawText(`Vessel Type: ${data.vesselType}`);
      yPosition -= 10;

      // Owner Information
      drawText('OWNER INFORMATION', { bold: true, fontSize: 12 });
      drawLine();
      drawText(`Name: ${data.ownerName}`);
      drawText(`District: ${data.ownerDistrict}, Taluka: ${data.taluka}`);
      yPosition -= 10;

      // Violation Details
      drawText('VIOLATION DETAILS', { bold: true, fontSize: 12 });
      drawLine();
      drawText(`Observation Date: ${data.observationDate}`);
      drawText(`Flying Location: ${data.flyingLocation}`);
      drawText(`Coordinates: ${data.latitude}, ${data.longitude}`);
      yPosition -= 10;

      // Penalty Information
      drawText('PENALTY INFORMATION', { bold: true, fontSize: 12 });
      drawLine();
      drawText(`Penalty Amount: Rs. ${data.penaltyAmount} Lakh`, { bold: true });
      drawText(`Total Penalty: Rs. ${data.totalPenalty} Lakh`);
      yPosition -= 20;

      // Hearing Details
      drawText('HEARING DETAILS', { bold: true, fontSize: 12 });
      drawLine();
      drawText(`Hearing Date: ${data.hearingDate}`);
      drawText(`Hearing Time: ${data.hearingTime}`);
      drawText(`Place: ${data.place}`);
      yPosition -= 20;

      // Instructions
      drawText('INSTRUCTIONS:', { bold: true });
      drawText('Please report to the nearest Fisheries Office on the hearing date.', { indent: 60 });
      drawText('Failure to appear may result in ex-parte decision.', { indent: 60 });
      yPosition -= 30;

      // Signature area
      drawText('Enforcement Officer', { bold: true });
      drawText(data.officerName);
      drawText('Assistant Fisheries Development Officer');

      // Page 2: Evidence images
      if (evidence.length > 0) {
        page = pdfDoc.addPage([595, 842]);
        yPosition = height - 50;

        page.drawText('EVIDENCE IMAGES', {
          x: 50,
          y: yPosition,
          size: 14,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        yPosition -= 30;

        page.drawLine({
          start: { x: 50, y: yPosition },
          end: { x: 545, y: yPosition },
          thickness: 0.5,
          color: rgb(0, 0, 0),
        });
        yPosition -= 30;

        // Add placeholder text for images
        for (let i = 0; i < evidence.length; i++) {
          const ev = evidence[i];
          page.drawText(`Image ${i + 1}: Evidence Image`, {
            x: 50,
            y: yPosition,
            size: 10,
            font: font,
            color: rgb(0, 0, 0),
          });
          yPosition -= 15;

          page.drawText(`Source: ${ev.s3Key || ev.evidenceUrl || 'Uploaded'}`, {
            x: 50,
            y: yPosition,
            size: 9,
            font: font,
            color: rgb(0.5, 0.5, 0.5),
          });
          yPosition -= 200; // Space for image

          // Draw placeholder rectangle for image
          page.drawRectangle({
            x: 50,
            y: yPosition + 20,
            width: 200,
            height: 150,
            borderColor: rgb(0.7, 0.7, 0.7),
            borderWidth: 1,
          });

          page.drawText('[Image will be embedded when S3 is configured]', {
            x: 60,
            y: yPosition + 90,
            size: 8,
            font: font,
            color: rgb(0.5, 0.5, 0.5),
          });

          yPosition -= 30;
        }
      }

      // Add signature if requested
      if (includeSignature && signatureKey) {
        const signatureBuffer = await s3Service.getDigitalSignature(signatureKey);

        if (signatureBuffer) {
          try {
            // Try to embed as PNG first, then as JPEG
            let signatureImage;
            try {
              signatureImage = await pdfDoc.embedPng(signatureBuffer);
            } catch {
              signatureImage = await pdfDoc.embedJpg(signatureBuffer);
            }

            // Add signature to the last page
            const lastPage = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
            const signDimensions = signatureImage.scale(0.3);

            lastPage.drawImage(signatureImage, {
              x: 400,
              y: 100,
              width: signDimensions.width,
              height: signDimensions.height,
            });

            lastPage.drawText('Digital Signature', {
              x: 400,
              y: 85,
              size: 8,
              font: font,
              color: rgb(0.5, 0.5, 0.5),
            });
          } catch (error) {
            logger.warn('Could not embed signature image:', error);
          }
        }
      }

      const pdfBytes = await pdfDoc.save();
      return Buffer.from(pdfBytes);

    } catch (error) {
      logger.error('PDF generation error:', error);
      return null;
    }
  }

  /**
   * Get notice preview data
   */
  async getNoticePreview(observationId: string): Promise<NoticeData | null> {
    try {
      const observation = await prisma.observation.findUnique({
        where: { id: observationId },
        include: {
          vessel: {
            include: { vesselType: true },
          },
          violationType: true,
          enforcementArea: true,
          flyingLocation: true,
          fishingLicenseType: true,
        },
      });

      if (!observation) return null;

      // Get creator name
      let creatorName = 'System';
      if (observation.createdByUserId) {
        const creator = await prisma.user.findUnique({
          where: { id: observation.createdByUserId },
          select: { fullName: true },
        });
        if (creator) creatorName = creator.fullName;
      }

      // Calculate hearing date (7 days from now)
      const hearingDate = new Date();
      hearingDate.setDate(hearingDate.getDate() + 7);

      return {
        // Case details
        caseNumber: observation.caseNumber?.replace(/.*\//, '') || '',
        date: formatDate(new Date()),
        district: observation.enforcementArea?.name || '',

        // Vessel details
        vesselName: observation.vessel?.name || observation.originalVesselName || '',
        vesselNumber: observation.vessel?.registrationNumber || observation.originalVesselReg || '',
        vesselType: observation.vessel?.vesselType?.name || observation.originalVesselType || '',

        // Owner details
        ownerName: observation.ownerName || observation.vessel?.ownerName || '',
        residence: '',
        taluka: observation.flyingLocation?.name || '',
        ownerDistrict: observation.enforcementArea?.name || '',

        // Location details
        latitude: observation.latitude?.toNumber()?.toFixed(6) || '',
        longitude: observation.longitude?.toNumber()?.toFixed(6) || '',
        flyingLocation: observation.flyingLocation?.name || '',

        // Dates
        observationDate: formatDate(observation.observationDate),
        hearingDate: formatDate(hearingDate),
        hearingTime: '11:00',
        noticeDate: formatDate(new Date()),

        // Penalty
        penaltyAmount: ((observation.penaltyAmount?.toNumber() || 0) / 100000).toFixed(2),
        totalPenalty: ((observation.penaltyAmount?.toNumber() || 0) / 100000).toFixed(2),

        // Officer/Place details
        place: observation.enforcementArea?.name || '',
        officerName: creatorName,
      };
    } catch (error) {
      logger.error('Error getting notice preview:', error);
      return null;
    }
  }

  /**
   * Save notice record to database
   */
  async saveNoticeRecord(
    observationId: string,
    s3Key: string,
    generatedBy: string
  ) {
    const noticeNumber = generateNoticeNumber();

    return prisma.caseNotice.create({
      data: {
        observationId,
        noticeNumber,
        noticeType: 'violation',
        s3Key,
        generatedBy,
        generatedAt: new Date(),
      },
    });
  }

  /**
   * Update notice status after sending
   */
  async updateNoticeSentStatus(
    noticeId: string,
    channel: 'email' | 'sms' | 'whatsapp' | 'call',
    status: string
  ) {
    const updateData: Record<string, unknown> = {};
    const now = new Date();

    switch (channel) {
      case 'email':
        updateData.emailSentAt = now;
        updateData.emailStatus = status;
        break;
      case 'sms':
        updateData.smsSentAt = now;
        updateData.smsStatus = status;
        break;
      case 'whatsapp':
        updateData.whatsappSentAt = now;
        updateData.whatsappStatus = status;
        break;
      case 'call':
        updateData.callMadeAt = now;
        updateData.callStatus = status;
        break;
    }

    updateData.status = 'sent';
    updateData.sentAt = now;

    return prisma.caseNotice.update({
      where: { id: noticeId },
      data: updateData,
    });
  }

  /**
   * Get all notices for a case
   */
  async getCaseNotices(observationId: string) {
    return prisma.caseNotice.findMany({
      where: { observationId },
      orderBy: { generatedAt: 'desc' },
    });
  }
}

export const noticeService = new NoticeService();
