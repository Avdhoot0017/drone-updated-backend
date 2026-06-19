import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { googleSheetsService } from './googleSheets.service';
import { SheetRow, SyncResult } from '../types';
import {
  generateObservationUniqueKey,
  parseCoordinates,
  parseDistance,
  normalizeText,
  parseVesselRegistration,
  getFiscalYear,
  parseTime,
} from '../utils/helpers';
import { SyncStatus, SyncRecordStatus, ObservationStatus } from '@prisma/client';

class SyncService {
  /**
   * Run full sync from Google Sheets
   */
  async runSync(triggeredBy: string = 'scheduled', userId?: string): Promise<SyncResult> {
    const startTime = Date.now();
    let syncBatch;

    const result: SyncResult = {
      totalRows: 0,
      newRecords: 0,
      updatedRecords: 0,
      unchangedRecords: 0,
      errors: 0,
      errorDetails: [],
    };

    try {
      // Get or create sheet config
      let sheetConfig = await prisma.googleSheetConfig.findUnique({
        where: { sheetId: env.googleSheetId },
        include: { tabs: true },
      });

      if (!sheetConfig) {
        // Create config if not exists
        const metadata = await googleSheetsService.getSheetMetadata(env.googleSheetId);

        // Truncate name to 100 chars (database limit)
        const sheetName = metadata.title.length > 100
          ? metadata.title.substring(0, 97) + '...'
          : metadata.title;

        sheetConfig = await prisma.googleSheetConfig.create({
          data: {
            name: sheetName,
            sheetId: env.googleSheetId,
            sheetUrl: `https://docs.google.com/spreadsheets/d/${env.googleSheetId}`,
            lastModifiedTime: new Date(metadata.lastModifiedTime),
          },
          include: { tabs: true },
        });

        // Create tab configurations
        // Keep original tab name (including spaces) for Google Sheets API
        // Use trimmed name only for resolving enforcement area
        for (const tabName of env.googleSheetTabs) {
          const area = await this.resolveEnforcementArea(tabName.trim());

          await prisma.sheetTab.create({
            data: {
              googleSheetConfigId: sheetConfig.id,
              tabName: tabName, // Keep original name with spaces for API
              enforcementAreaId: area?.id,
            },
          });
        }

        sheetConfig = await prisma.googleSheetConfig.findUnique({
          where: { id: sheetConfig.id },
          include: { tabs: true },
        });
      }

      // Get latest sheet metadata
      const metadata = await googleSheetsService.getSheetMetadata(env.googleSheetId);

      // Update last modified time
      await prisma.googleSheetConfig.update({
        where: { id: sheetConfig!.id },
        data: { lastModifiedTime: new Date(metadata.lastModifiedTime) },
      });

      // Create sync batch
      syncBatch = await prisma.syncBatch.create({
        data: {
          googleSheetConfigId: sheetConfig!.id,
          status: SyncStatus.in_progress,
          triggeredBy,
          triggeredByUserId: userId,
        },
      });

      logger.info(`Starting sync batch: ${syncBatch.id}`);

      // Process each tab
      for (const tab of sheetConfig!.tabs) {
        if (!tab.isActive) continue;

        logger.info(`Processing tab: ${tab.tabName}`);

        try {
          const { rows } = await googleSheetsService.readSheetData(
            env.googleSheetId,
            tab.tabName,
            tab.dataStartRow
          );

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNumber = tab.dataStartRow + i;
            result.totalRows++;

            try {
              const processResult = await this.processRow(
                row,
                tab.id,
                tab.tabName,
                syncBatch.id
              );

              if (processResult === 'new') {
                result.newRecords++;
              } else if (processResult === 'updated') {
                result.updatedRecords++;
              } else if (processResult === 'unchanged') {
                result.unchangedRecords++;
              }

              // Determine sync record status
              let syncRecordStatus: SyncRecordStatus;
              if (processResult === 'new') {
                syncRecordStatus = SyncRecordStatus.new_record;
              } else if (processResult === 'updated') {
                syncRecordStatus = SyncRecordStatus.updated;
              } else {
                syncRecordStatus = SyncRecordStatus.duplicate;
              }

              // Record sync result
              await prisma.syncRecord.create({
                data: {
                  syncBatchId: syncBatch.id,
                  sheetTabId: tab.id,
                  rowNumber,
                  uniqueKey: generateObservationUniqueKey(
                    row.flyingLocation,
                    row.vesselRegNo,
                    row.date instanceof Date ? row.date : null,
                    row.time
                  ),
                  status: syncRecordStatus,
                  rawData: row as object,
                },
              });
            } catch (error) {
              result.errors++;
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';

              result.errorDetails.push({
                row: rowNumber,
                error: errorMessage,
              });

              await prisma.syncRecord.create({
                data: {
                  syncBatchId: syncBatch.id,
                  sheetTabId: tab.id,
                  rowNumber,
                  status: SyncRecordStatus.error,
                  rawData: row as object,
                  errorMessage,
                },
              });

              logger.error(`Error processing row ${rowNumber}:`, error);
            }
          }

          // Update tab last synced
          await prisma.sheetTab.update({
            where: { id: tab.id },
            data: {
              lastRowSynced: tab.dataStartRow + rows.length - 1,
              lastSyncAt: new Date(),
            },
          });
        } catch (error) {
          logger.error(`Error processing tab ${tab.tabName}:`, error);
        }
      }

      // Update sync batch
      const endTime = Date.now();

      await prisma.syncBatch.update({
        where: { id: syncBatch.id },
        data: {
          status: SyncStatus.completed,
          completedAt: new Date(),
          durationMs: endTime - startTime,
          totalRowsScanned: result.totalRows,
          newRecordsAdded: result.newRecords,
          updatedRecords: result.updatedRecords,
          duplicateRecords: result.unchangedRecords,
          errorRecords: result.errors,
        },
      });

      // Update sheet config
      await prisma.googleSheetConfig.update({
        where: { id: sheetConfig!.id },
        data: { lastSyncAt: new Date() },
      });

      logger.info(
        `Sync completed: ${result.newRecords} new, ${result.updatedRecords} updated, ${result.unchangedRecords} unchanged, ${result.errors} errors`
      );

      return result;
    } catch (error) {
      logger.error('Sync failed:', error);

      if (syncBatch) {
        await prisma.syncBatch.update({
          where: { id: syncBatch.id },
          data: {
            status: SyncStatus.failed,
            completedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            errorStack: error instanceof Error ? error.stack : undefined,
          },
        });
      }

      throw error;
    }
  }

  /**
   * Process a single row from the sheet (UPSERT logic)
   * - If record exists: UPDATE with new penalty/status/remarks data
   * - If record doesn't exist: CREATE new record
   */
  private async processRow(
    row: SheetRow,
    sheetTabId: string,
    sheetName: string,
    syncBatchId: string
  ): Promise<'new' | 'updated' | 'unchanged'> {
    // Skip rows without essential data
    if (!row.flyingLocation || !row.date) {
      throw new Error('Missing required fields: flyingLocation or date');
    }

    const date = row.date instanceof Date ? row.date : new Date(row.date);

    // Generate unique key (includes time to distinguish multiple sightings same day)
    const uniqueKey = generateObservationUniqueKey(
      row.flyingLocation,
      row.vesselRegNo,
      date,
      row.time
    );

    // Check for existing record
    const existing = await prisma.observation.findUnique({
      where: { uniqueKey },
      include: { penalty: true },
    });

    if (existing) {
      // UPDATE existing record with new data
      return await this.updateExistingRecord(existing, row);
    }

    // Resolve enforcement area
    const enforcementArea = await this.resolveEnforcementArea(
      row.enforcementArea || sheetName
    );

    if (!enforcementArea) {
      throw new Error(`Unknown enforcement area: ${row.enforcementArea || sheetName}`);
    }

    // Resolve flying location
    const flyingLocation = await this.resolveFlyingLocation(
      row.flyingLocation,
      enforcementArea.id
    );

    if (!flyingLocation) {
      throw new Error(`Unknown flying location: ${row.flyingLocation}`);
    }

    // Resolve or create vessel
    let vessel = null;
    if (row.vesselRegNo) {
      vessel = await this.resolveOrCreateVessel(row);
    }

    // Resolve violation type
    const violationType = await this.resolveViolationType(row.violationOfAct);

    // Parse coordinates
    const coords = parseCoordinates(row.latitudeLongitude);

    // Parse time
    const timeValue = parseTime(row.time);
    const observationTime = timeValue;

    // Create observation datetime
    let observationDatetime: Date | null = null;
    if (timeValue) {
      observationDatetime = new Date(date);
      observationDatetime.setHours(
        timeValue.getHours(),
        timeValue.getMinutes(),
        timeValue.getSeconds()
      );
    }

    // Determine observation status from finalVerdict
    let observationStatus: ObservationStatus = ObservationStatus.reported;
    if (row.finalVerdict) {
      const verdict = row.finalVerdict.toLowerCase().trim();
      if (verdict === 'disposed') {
        observationStatus = ObservationStatus.disposed;
      } else if (verdict === 'pending') {
        observationStatus = ObservationStatus.action_pending;
      }
    }

    // Create observation
    const observation = await prisma.observation.create({
      data: {
        uniqueKey,
        enforcementAreaId: enforcementArea.id,
        flyingLocationId: flyingLocation.id,
        vesselId: vessel?.id,
        violationTypeId: violationType?.id,
        originalSrNo: row.srNo ? Math.floor(row.srNo) : null,
        originalVesselName: row.vesselName,
        originalVesselReg: row.vesselRegNo,
        originalVesselType: row.vesselType,
        originalViolationText: row.violationOfAct,
        latitude: coords.latitude ? coords.latitude : undefined,
        longitude: coords.longitude ? coords.longitude : undefined,
        latitudeDms: coords.format === 'dms' ? row.latitudeLongitude : null,
        longitudeDms: coords.format === 'dms' ? row.latitudeLongitude : null,
        observationDate: date,
        observationTime: observationTime,
        observationDatetime,
        distanceFromCoastKm: parseDistance(row.distanceFromCoast),
        distanceRaw: row.distanceFromCoast,
        detectedPenalty: row.expectedPenalty ? parseFloat(String(row.expectedPenalty)) : null,
        remarksAcf: row.remarksAcf,
        remarksHo: row.remarksHo,
        status: observationStatus,
        statusUpdatedAt: observationStatus !== ObservationStatus.reported ? new Date() : undefined,
        sourceSheetName: sheetName,
        syncBatchId,
        // Time dimensions
        observationHour: observationTime?.getHours(),
        observationDayOfWeek: date.getDay() === 0 ? 7 : date.getDay(),
        observationWeek: this.getWeekNumber(date),
        observationMonth: date.getMonth() + 1,
        observationQuarter: Math.ceil((date.getMonth() + 1) / 3),
        observationYear: date.getFullYear(),
        fiscalYear: getFiscalYear(date),
      },
    });

    // Add evidence if available
    if (row.evidences) {
      await prisma.observationEvidence.create({
        data: {
          observationId: observation.id,
          evidenceUrl: row.evidences,
          isPrimary: true,
        },
      });
    }

    // Add penalty data if available
    if (row.penaltyImposed || row.penaltyRecovered || row.fishAuctionAmount) {
      await prisma.penalty.create({
        data: {
          observationId: observation.id,
          penaltyImposed: row.penaltyImposed || 0,
          penaltyRecovered: row.penaltyRecovered || 0,
          fishAuctionAmount: row.fishAuctionAmount || 0,
        },
      });
    }

    return 'new';
  }

  /**
   * Update existing observation record with new data from sheet
   * Compares and updates: penalty, status, remarks, amounts
   */
  private async updateExistingRecord(
    existing: {
      id: string;
      detectedPenalty: number | null | { toNumber: () => number };
      remarksAcf: string | null;
      remarksHo: string | null;
      status: ObservationStatus;
      penalty: {
        id: string;
        penaltyImposed: number | { toNumber: () => number };
        penaltyRecovered: number | { toNumber: () => number };
        fishAuctionAmount: number | { toNumber: () => number };
      } | null;
    },
    row: SheetRow
  ): Promise<'updated' | 'unchanged'> {
    let hasChanges = false;
    const observationUpdates: Record<string, unknown> = {};
    const penaltyUpdates: Record<string, unknown> = {};

    // Helper to get numeric value from Decimal or number
    const toNumber = (val: number | null | { toNumber: () => number } | undefined): number | null => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'number') return val;
      if (typeof val === 'object' && 'toNumber' in val) return val.toNumber();
      return null;
    };

    // Parse new values from sheet
    const newDetectedPenalty = row.expectedPenalty ? parseFloat(String(row.expectedPenalty)) : null;
    const newPenaltyImposed = row.penaltyImposed ? parseFloat(String(row.penaltyImposed)) : 0;
    const newPenaltyRecovered = row.penaltyRecovered ? parseFloat(String(row.penaltyRecovered)) : 0;
    const newFishAuctionAmount = row.fishAuctionAmount ? parseFloat(String(row.fishAuctionAmount)) : 0;

    // Determine new status from finalVerdict
    let newStatus: ObservationStatus | null = null;
    if (row.finalVerdict) {
      const verdict = row.finalVerdict.toLowerCase().trim();
      if (verdict === 'disposed') {
        newStatus = ObservationStatus.disposed;
      } else if (verdict === 'pending') {
        newStatus = ObservationStatus.action_pending;
      }
    }

    // Compare and prepare observation updates
    const existingDetectedPenalty = toNumber(existing.detectedPenalty);
    if (newDetectedPenalty !== null && newDetectedPenalty !== existingDetectedPenalty) {
      observationUpdates.detectedPenalty = newDetectedPenalty;
      hasChanges = true;
    }

    if (row.remarksAcf && row.remarksAcf !== existing.remarksAcf) {
      observationUpdates.remarksAcf = row.remarksAcf;
      hasChanges = true;
    }

    if (row.remarksHo && row.remarksHo !== existing.remarksHo) {
      observationUpdates.remarksHo = row.remarksHo;
      hasChanges = true;
    }

    if (newStatus && newStatus !== existing.status) {
      observationUpdates.status = newStatus;
      observationUpdates.statusUpdatedAt = new Date();
      hasChanges = true;
    }

    // Compare and prepare penalty updates
    const existingPenaltyImposed = toNumber(existing.penalty?.penaltyImposed) || 0;
    const existingPenaltyRecovered = toNumber(existing.penalty?.penaltyRecovered) || 0;
    const existingFishAuctionAmount = toNumber(existing.penalty?.fishAuctionAmount) || 0;

    if (newPenaltyImposed !== existingPenaltyImposed) {
      penaltyUpdates.penaltyImposed = newPenaltyImposed;
      hasChanges = true;
    }

    if (newPenaltyRecovered !== existingPenaltyRecovered) {
      penaltyUpdates.penaltyRecovered = newPenaltyRecovered;
      hasChanges = true;
    }

    if (newFishAuctionAmount !== existingFishAuctionAmount) {
      penaltyUpdates.fishAuctionAmount = newFishAuctionAmount;
      hasChanges = true;
    }

    // If no changes detected, return unchanged
    if (!hasChanges) {
      return 'unchanged';
    }

    // Apply observation updates
    if (Object.keys(observationUpdates).length > 0) {
      observationUpdates.updatedAt = new Date();
      await prisma.observation.update({
        where: { id: existing.id },
        data: observationUpdates,
      });
    }

    // Apply penalty updates (upsert - create if not exists)
    if (Object.keys(penaltyUpdates).length > 0 || (newPenaltyImposed > 0 || newPenaltyRecovered > 0 || newFishAuctionAmount > 0)) {
      if (existing.penalty) {
        // Update existing penalty
        await prisma.penalty.update({
          where: { id: existing.penalty.id },
          data: {
            ...penaltyUpdates,
            updatedAt: new Date(),
          },
        });
      } else if (newPenaltyImposed > 0 || newPenaltyRecovered > 0 || newFishAuctionAmount > 0) {
        // Create new penalty record
        await prisma.penalty.create({
          data: {
            observationId: existing.id,
            penaltyImposed: newPenaltyImposed,
            penaltyRecovered: newPenaltyRecovered,
            fishAuctionAmount: newFishAuctionAmount,
          },
        });
      }
    }

    logger.debug(`Updated observation ${existing.id} with changes: ${JSON.stringify({ observationUpdates, penaltyUpdates })}`);

    return 'updated';
  }

  /**
   * Resolve enforcement area from name or alias
   */
  private async resolveEnforcementArea(name: string) {
    const normalized = normalizeText(name);

    // First try direct match
    let area = await prisma.enforcementArea.findFirst({
      where: {
        OR: [
          { normalizedName: normalized },
          { name: { equals: name, mode: 'insensitive' } },
        ],
      },
    });

    if (area) return area;

    // Try alias
    const alias = await prisma.enforcementAreaAlias.findFirst({
      where: { aliasName: { equals: normalized, mode: 'insensitive' } },
      include: { enforcementArea: true },
    });

    return alias?.enforcementArea || null;
  }

  /**
   * Resolve flying location from name or alias
   */
  private async resolveFlyingLocation(name: string, enforcementAreaId: string) {
    const normalized = normalizeText(name);

    // First try direct match
    let location = await prisma.flyingLocation.findFirst({
      where: {
        OR: [
          { normalizedName: normalized.replace(/\s+/g, '_') },
          { name: { equals: name, mode: 'insensitive' } },
        ],
        enforcementAreaId,
      },
    });

    if (location) return location;

    // Try without area restriction
    location = await prisma.flyingLocation.findFirst({
      where: {
        OR: [
          { normalizedName: normalized.replace(/\s+/g, '_') },
          { name: { equals: name, mode: 'insensitive' } },
        ],
      },
    });

    if (location) return location;

    // Try alias
    const alias = await prisma.flyingLocationAlias.findFirst({
      where: { aliasName: { equals: normalized, mode: 'insensitive' } },
      include: { flyingLocation: true },
    });

    if (alias) return alias.flyingLocation;

    // Create new location
    return prisma.flyingLocation.create({
      data: {
        name: name.trim(),
        normalizedName: normalized.replace(/\s+/g, '_'),
        enforcementAreaId,
      },
    });
  }

  /**
   * Resolve or create vessel
   */
  private async resolveOrCreateVessel(row: SheetRow) {
    if (!row.vesselRegNo) return null;

    const regNo = row.vesselRegNo.trim().toUpperCase();

    let vessel = await prisma.vessel.findUnique({
      where: { registrationNumber: regNo },
    });

    if (vessel) {
      // Update last observed
      await prisma.vessel.update({
        where: { id: vessel.id },
        data: {
          lastObservedAt: new Date(),
          totalViolations: { increment: 1 },
        },
      });

      // Track name if different
      if (row.vesselName && row.vesselName !== vessel.name) {
        await prisma.vesselNameHistory.upsert({
          where: {
            vesselId_nameObserved: {
              vesselId: vessel.id,
              nameObserved: row.vesselName,
            },
          },
          create: {
            vesselId: vessel.id,
            nameObserved: row.vesselName,
          },
          update: {
            lastSeenAt: new Date(),
            observationCount: { increment: 1 },
          },
        });
      }

      return vessel;
    }

    // Parse registration
    const regParts = parseVesselRegistration(regNo);

    // Find state
    let stateId: string | undefined;
    if (regParts.state) {
      const state = await prisma.state.findUnique({
        where: { code: regParts.state },
      });
      stateId = state?.id;
    }

    // Find vessel type
    let vesselTypeId: string | undefined;
    if (row.vesselType) {
      const vesselType = await this.resolveVesselType(row.vesselType);
      vesselTypeId = vesselType?.id;
    }

    // Create vessel
    return prisma.vessel.create({
      data: {
        registrationNumber: regNo,
        name: row.vesselName,
        vesselTypeId,
        stateId,
        registrationCountry: regParts.country,
        registrationState: regParts.state,
        registrationDistrict: regParts.district,
        registrationCategory: regParts.category,
        registrationSerial: regParts.serial,
        firstObservedAt: new Date(),
        lastObservedAt: new Date(),
        totalViolations: 1,
      },
    });
  }

  /**
   * Resolve vessel type
   */
  private async resolveVesselType(typeName: string) {
    const normalized = normalizeText(typeName);

    let type = await prisma.vesselType.findFirst({
      where: {
        OR: [
          { normalizedName: normalized.replace(/\s+/g, '_') },
          { name: { equals: typeName, mode: 'insensitive' } },
        ],
      },
    });

    if (type) return type;

    // Try alias
    const alias = await prisma.vesselTypeAlias.findFirst({
      where: { aliasName: { equals: normalized, mode: 'insensitive' } },
      include: { vesselType: true },
    });

    return alias?.vesselType || null;
  }

  /**
   * Resolve violation type
   */
  private async resolveViolationType(violationText: string | null) {
    if (!violationText) return null;

    const normalized = normalizeText(violationText);

    // Check patterns
    const patterns = await prisma.violationPattern.findMany({
      include: { violationType: true },
      orderBy: { priority: 'desc' },
    });

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.pattern, 'i');
      if (regex.test(normalized)) {
        return pattern.violationType;
      }
    }

    // Try direct code match
    if (normalized.includes('TRAWL')) {
      return prisma.violationType.findFirst({ where: { code: 'TRAWLING' } });
    }
    if (normalized.includes('PURSE SEINE')) {
      return prisma.violationType.findFirst({ where: { code: 'PURSE_SEINE' } });
    }
    if (normalized.includes('LED') || normalized.includes('GENERATOR')) {
      return prisma.violationType.findFirst({ where: { code: 'LED_CARRYING' } });
    }
    if (normalized.includes('PAIR')) {
      return prisma.violationType.findFirst({ where: { code: 'PAIR_TRAWLING' } });
    }
    if (normalized.includes('OTHER STATE') || normalized.includes('MALPE') || normalized.includes('GUJRAT')) {
      return prisma.violationType.findFirst({ where: { code: 'OTHER_STATE_BOAT' } });
    }

    return null;
  }

  /**
   * Get ISO week number
   */
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /**
   * Get last sync info
   */
  async getLastSyncInfo() {
    const config = await prisma.googleSheetConfig.findUnique({
      where: { sheetId: env.googleSheetId },
    });

    const lastBatch = await prisma.syncBatch.findFirst({
      where: { status: SyncStatus.completed },
      orderBy: { completedAt: 'desc' },
    });

    return {
      lastSyncAt: config?.lastSyncAt,
      lastModifiedTime: config?.lastModifiedTime,
      lastBatch: lastBatch
        ? {
            id: lastBatch.id,
            completedAt: lastBatch.completedAt,
            newRecords: lastBatch.newRecordsAdded,
            duplicates: lastBatch.duplicateRecords,
            errors: lastBatch.errorRecords,
          }
        : null,
    };
  }
}

export const syncService = new SyncService();
