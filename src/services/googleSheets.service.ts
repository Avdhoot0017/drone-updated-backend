import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { SheetRow, SheetMetadata } from '../types';
import { parseDate, parseTime, parseNumeric } from '../utils/helpers';

// Column mapping based on Excel analysis
// Supports both old format (multiple district tabs) and new format (single Sheet1)
const COLUMN_MAPPING = {
  'Sr. No.': 'srNo',
  'Enforcment Area': 'enforcementArea',
  'Enforcement Area': 'enforcementArea',
  'Flying location': 'flyingLocation',
  'Fishing Vessel Name': 'vesselName',
  'Vessel Reg. No': 'vesselRegNo',
  'Vessel Type': 'vesselType',
  'Latitude and Longitude': 'latitudeLongitude',
  'Date ': 'date',
  'Date': 'date',
  'Time': 'time',
  'Distance From the Coast': 'distanceFromCoast',
  'Violation of Act': 'violationOfAct',
  'Evidences': 'evidences',
  'Expected Penalty': 'expectedPenalty',
  'Detected Penalty': 'expectedPenalty',
  'Action Taken Report': 'actionTakenReport',
  'Amount of forfeited Fish Sale by Auction': 'fishAuctionAmount',
  'How much penalty amount was imposed?': 'penaltyImposed',
  'Out of that, how much penalty amount was recovered?': 'penaltyRecovered',
  // ACF Remarks - multiple possible column names
  'Remarks of ACF Office': 'remarksAcf',
  'Remarks by ACF': 'remarksAcf',
  'Remarks by ASF': 'remarksAcf',
  'Remarks': 'remarksAcf',
  // HO Remarks - multiple possible column names
  'Remarks of HO': 'remarksHo',
  'Remark Of HO': 'remarksHo',
  'Remarks HO': 'remarksHo',
  // Final Verdict / Status
  'Final Verdict by ACF Office (Disposed / Pending)': 'finalVerdict',
} as const;

class GoogleSheetsService {
  private sheets: sheets_v4.Sheets | null = null;
  private drive: ReturnType<typeof google.drive> | null = null;
  private auth: JWT | null = null;

  /**
   * Initialize Google API client
   */
  async initialize(): Promise<void> {
    try {
      const serviceAccountPath = path.resolve(
        process.cwd(),
        env.googleServiceAccountPath
      );

      if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(
          `Service account file not found at: ${serviceAccountPath}`
        );
      }

      const credentials = JSON.parse(
        fs.readFileSync(serviceAccountPath, 'utf8')
      );

      this.auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets.readonly',
          'https://www.googleapis.com/auth/drive.metadata.readonly',
        ],
      });

      await this.auth.authorize();

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      this.drive = google.drive({ version: 'v3', auth: this.auth });

      logger.info('Google Sheets API initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Google Sheets API:', error);
      throw error;
    }
  }

  /**
   * Get sheet metadata including last modified time
   */
  async getSheetMetadata(sheetId: string): Promise<SheetMetadata> {
    if (!this.drive) {
      await this.initialize();
    }

    try {
      const response = await this.drive!.files.get({
        fileId: sheetId,
        fields: 'modifiedTime,name',
      });

      return {
        lastModifiedTime: response.data.modifiedTime || new Date().toISOString(),
        title: response.data.name || 'Unknown',
      };
    } catch (error) {
      logger.error('Failed to get sheet metadata:', error);
      throw error;
    }
  }

  /**
   * Get all sheet tab names
   */
  async getSheetTabs(sheetId: string): Promise<string[]> {
    if (!this.sheets) {
      await this.initialize();
    }

    try {
      const response = await this.sheets!.spreadsheets.get({
        spreadsheetId: sheetId,
      });

      const sheets = response.data.sheets || [];
      return sheets.map((sheet) => sheet.properties?.title || '').filter(Boolean);
    } catch (error) {
      logger.error('Failed to get sheet tabs:', error);
      throw error;
    }
  }

  /**
   * Read data from a specific sheet tab
   */
  async readSheetData(
    sheetId: string,
    tabName: string,
    startRow: number = 1
  ): Promise<{ headers: string[]; rows: SheetRow[] }> {
    if (!this.sheets) {
      await this.initialize();
    }

    try {
      // First, get headers from row 1
      const headerResponse = await this.sheets!.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tabName}'!1:1`,
      });

      const headers = (headerResponse.data.values?.[0] || []) as string[];

      if (headers.length === 0) {
        logger.warn(`No headers found in tab: ${tabName}`);
        return { headers: [], rows: [] };
      }

      // Get data starting from startRow (extended range to include new columns)
      const dataResponse = await this.sheets!.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tabName}'!A${startRow}:Z`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      });

      const rawRows = dataResponse.data.values || [];

      // Map raw data to SheetRow objects
      const rows: SheetRow[] = rawRows
        .map((row, index) => {
          // Skip empty rows
          if (!row || row.every((cell) => cell === null || cell === undefined || cell === '')) {
            return null;
          }

          const rowData: Record<string, unknown> = {};

          headers.forEach((header, colIndex) => {
            const mappedKey = COLUMN_MAPPING[header as keyof typeof COLUMN_MAPPING];
            if (mappedKey) {
              rowData[mappedKey] = row[colIndex];
            }
          });

          return this.mapToSheetRow(rowData, index + startRow);
        })
        .filter((row): row is SheetRow => row !== null);

      logger.info(
        `Read ${rows.length} rows from tab: ${tabName} (starting row: ${startRow})`
      );

      return { headers, rows };
    } catch (error) {
      logger.error(`Failed to read sheet data from tab ${tabName}:`, error);
      throw error;
    }
  }

  /**
   * Map raw row data to SheetRow type
   */
  private mapToSheetRow(data: Record<string, unknown>, rowNumber: number): SheetRow {
    return {
      srNo: parseNumeric(data.srNo),
      enforcementArea: this.toString(data.enforcementArea),
      flyingLocation: this.toString(data.flyingLocation),
      vesselName: this.toString(data.vesselName),
      vesselRegNo: this.toString(data.vesselRegNo),
      vesselType: this.toString(data.vesselType),
      latitudeLongitude: this.toString(data.latitudeLongitude),
      date: parseDate(data.date),
      time: this.toString(data.time) || parseTime(data.time)?.toTimeString().slice(0, 8) || null,
      distanceFromCoast: this.toString(data.distanceFromCoast),
      violationOfAct: this.toString(data.violationOfAct),
      evidences: this.toString(data.evidences),
      expectedPenalty: parseNumeric(data.expectedPenalty),
      actionTakenReport: this.toString(data.actionTakenReport),
      fishAuctionAmount: parseNumeric(data.fishAuctionAmount),
      penaltyImposed: parseNumeric(data.penaltyImposed),
      penaltyRecovered: parseNumeric(data.penaltyRecovered),
      remarksAcf: this.toString(data.remarksAcf),
      remarksHo: this.toString(data.remarksHo),
      finalVerdict: this.toString(data.finalVerdict),
    };
  }

  /**
   * Safely convert value to string
   */
  private toString(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return String(value).trim();
  }

  /**
   * Get row count for a specific tab
   */
  async getRowCount(sheetId: string, tabName: string): Promise<number> {
    if (!this.sheets) {
      await this.initialize();
    }

    try {
      const response = await this.sheets!.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tabName}'!A:A`,
      });

      return response.data.values?.length || 0;
    } catch (error) {
      logger.error(`Failed to get row count for tab ${tabName}:`, error);
      throw error;
    }
  }
}

export const googleSheetsService = new GoogleSheetsService();
