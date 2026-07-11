/**
 * DOCX Generation Service
 * Generates Marathi case documents from DOCX template using docxtemplater
 */

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import fs from 'fs';
import path from 'path';
import { format } from 'date-fns';
import { logger } from '../config/logger';

// ============================================================
// INTERFACES
// ============================================================

export interface DocxCaseData {
  // Case info
  caseNumber?: string;
  currentDate?: string;

  // Vessel details
  vesselName: string;
  registrationNumber: string;
  vesselType?: string;

  // Owner details
  ownerName: string;
  ownerAddress?: string;
  ownerTaluka?: string;
  ownerDistrict?: string;

  // Location
  districtName: string;
  flyingLocationName: string;
  latitude: string;
  longitude: string;

  // Violation
  violationTypeName: string;
  fishingLicenseTypeName?: string;
  observationDate?: string;

  // Trawling specific
  depth?: string;

  // Act/Section
  actKalam?: string;

  // Hearing
  hearingDate?: string;
  hearingTime?: string;

  // Penalty
  processingFee: number;
  violationPenalty: number;
  totalPenalty: number;
  occurrence?: number;
}

// ============================================================
// DOCX SERVICE CLASS
// ============================================================

class DocxService {
  private templatePath: string;

  constructor() {
    this.templatePath = path.join(__dirname, '../config/case-template.docx');
  }

  /**
   * Format penalty amount in lakhs
   */
  private formatInLakhs(amount: number): string {
    const lakhs = amount / 100000;
    return lakhs.toFixed(2);
  }

  /**
   * Generate DOCX buffer from template with case data
   */
  async generateDocx(data: DocxCaseData): Promise<Buffer> {
    try {
      // Read the template
      const templateContent = fs.readFileSync(this.templatePath, 'binary');
      const zip = new PizZip(templateContent);

      // Create docxtemplater instance
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: {
          start: '{{',
          end: '}}',
        },
      });

      // Prepare data for template
      const currentDate = data.currentDate || format(new Date(), 'dd/MM/yyyy');
      const observationDate = data.observationDate
        ? format(new Date(data.observationDate), 'dd/MM/yyyy')
        : currentDate;

      // Calculate hearing date (7 days from now if not provided)
      const hearingDate = data.hearingDate
        ? format(new Date(data.hearingDate), 'dd/MM/yyyy')
        : format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'dd/MM/yyyy');

      const templateData = {
        // Case info
        caseNumber: data.caseNumber || 'XXXXX',
        currentDate,
        observationDate,
        hearingDate,
        hearingTime: data.hearingTime || '11:00',

        // Vessel details
        vesselName: data.vesselName || '___________',
        registrationNumber: data.registrationNumber || '___________',
        vesselType: data.vesselType || data.fishingLicenseTypeName || 'पर्ससीन',

        // Owner details
        ownerName: data.ownerName || '_______________',
        ownerAddress: data.ownerAddress || '_______________',
        ownerTaluka: data.ownerTaluka || data.flyingLocationName || '___',
        ownerDistrict: data.ownerDistrict || data.districtName || '___',

        // Location
        districtName: data.districtName || '___________',
        flyingLocationName: data.flyingLocationName || '___________',
        latitude: data.latitude || '___________',
        longitude: data.longitude || '___________',
        depth: data.depth || '',

        // Violation
        violationTypeName: data.violationTypeName || 'पर्ससीन/एलईडी/ट्रॉलिंग/इतर',
        actKalam: data.actKalam || '',

        // Penalty amounts in lakhs
        processingFee: this.formatInLakhs(data.processingFee),
        violationPenalty: this.formatInLakhs(data.violationPenalty),
        totalPenalty: this.formatInLakhs(data.totalPenalty),
      };

      // Render the document
      doc.render(templateData);

      // Generate buffer
      const buffer = doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });

      logger.info('DOCX generated successfully', {
        caseNumber: data.caseNumber,
        vesselName: data.vesselName,
      });

      return buffer;
    } catch (error) {
      logger.error('Error generating DOCX:', error);
      throw error;
    }
  }

  /**
   * Generate DOCX and save to file
   */
  async generateDocxFile(data: DocxCaseData, outputPath: string): Promise<string> {
    const buffer = await this.generateDocx(data);
    fs.writeFileSync(outputPath, buffer);
    logger.info('DOCX file saved', { path: outputPath });
    return outputPath;
  }
}

export const docxService = new DocxService();
