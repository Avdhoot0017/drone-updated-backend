/**
 * Fresh Sync Script
 * Cleans transactional data, seeds master data, and runs sync
 *
 * Run with: npm run sync:fresh
 */

import { config } from 'dotenv';
config();

import { prisma, disconnectDatabase } from '../config/database';
import { syncService } from '../services/sync.service';
import { logger } from '../config/logger';

async function freshSync() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              FRESH SYNC - CLEAN & IMPORT                  ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // ============================================================
    // STEP 1: Clean transactional data
    // ============================================================
    console.log('🧹 STEP 1: Cleaning transactional data...\n');

    // Delete in correct order due to foreign keys
    const deleteResults = await prisma.$transaction([
      prisma.syncRecord.deleteMany({}),
      prisma.syncBatch.deleteMany({}),
      prisma.penalty.deleteMany({}),
      prisma.observationEvidence.deleteMany({}),
      prisma.actionReport.deleteMany({}),
      prisma.observationHistory.deleteMany({}),
      prisma.observation.deleteMany({}),
      prisma.vesselNameHistory.deleteMany({}),
      prisma.vessel.deleteMany({}),
      prisma.sheetTab.deleteMany({}),
      prisma.googleSheetConfig.deleteMany({}),
      prisma.dailyStatistics.deleteMany({}),
      prisma.monthlyStatistics.deleteMany({}),
    ]);

    console.log('   ✓ Sync records deleted:', deleteResults[0].count);
    console.log('   ✓ Sync batches deleted:', deleteResults[1].count);
    console.log('   ✓ Penalties deleted:', deleteResults[2].count);
    console.log('   ✓ Evidence deleted:', deleteResults[3].count);
    console.log('   ✓ Observations deleted:', deleteResults[6].count);
    console.log('   ✓ Vessels deleted:', deleteResults[8].count);
    console.log('   ✓ Sheet configs deleted:', deleteResults[10].count);
    console.log('');

    // ============================================================
    // STEP 2: Verify/Seed master data
    // ============================================================
    console.log('📦 STEP 2: Verifying master data...\n');

    const masterCounts = await Promise.all([
      prisma.state.count(),
      prisma.enforcementArea.count(),
      prisma.enforcementAreaAlias.count(),
      prisma.flyingLocation.count(),
      prisma.vesselType.count(),
      prisma.violationType.count(),
      prisma.violationPattern.count(),
    ]);

    console.log('   States:              ', masterCounts[0]);
    console.log('   Enforcement Areas:   ', masterCounts[1]);
    console.log('   Area Aliases:        ', masterCounts[2]);
    console.log('   Flying Locations:    ', masterCounts[3]);
    console.log('   Vessel Types:        ', masterCounts[4]);
    console.log('   Violation Types:     ', masterCounts[5]);
    console.log('   Violation Patterns:  ', masterCounts[6]);

    // Check if master data needs seeding
    if (masterCounts[1] === 0) {
      console.log('\n   ⚠️  No master data found. Please run: npm run db:seed:master');
      process.exit(1);
    }

    console.log('\n   ✓ Master data verified\n');

    // ============================================================
    // STEP 3: Run sync
    // ============================================================
    console.log('🔄 STEP 3: Running sync from Google Sheets...\n');

    const startTime = Date.now();
    const result = await syncService.runSync('fresh-sync');
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ FRESH SYNC COMPLETED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Results:');
    console.log(`   Total Rows Scanned:  ${result.totalRows}`);
    console.log(`   New Records Added:   ${result.newRecords}`);
    console.log(`   Records Updated:     ${result.updatedRecords}`);
    console.log(`   Unchanged:           ${result.unchangedRecords}`);
    console.log(`   Errors:              ${result.errors}`);
    console.log(`   Duration:            ${duration}s`);
    console.log('');

    if (result.errors > 0 && result.errorDetails.length > 0) {
      console.log('⚠️  Error Details (first 10):');
      result.errorDetails.slice(0, 10).forEach((err) => {
        console.log(`   Row ${err.row}: ${err.error}`);
      });
      console.log('');
    }

    // Show final counts
    const finalCounts = await Promise.all([
      prisma.observation.count(),
      prisma.vessel.count(),
      prisma.penalty.count(),
      prisma.observationEvidence.count(),
    ]);

    console.log('📈 Database Summary:');
    console.log(`   Observations:   ${finalCounts[0]}`);
    console.log(`   Vessels:        ${finalCounts[1]}`);
    console.log(`   Penalties:      ${finalCounts[2]}`);
    console.log(`   Evidence Links: ${finalCounts[3]}`);
    console.log('');

    // Show by district
    const byDistrict = await prisma.observation.groupBy({
      by: ['enforcementAreaId'],
      _count: { id: true },
    });

    const areas = await prisma.enforcementArea.findMany();
    const areaMap = new Map(areas.map(a => [a.id, a.name]));

    console.log('📍 By District:');
    byDistrict
      .sort((a, b) => b._count.id - a._count.id)
      .forEach((item) => {
        const name = areaMap.get(item.enforcementAreaId) || 'Unknown';
        console.log(`   ${name.padEnd(12)} ${item._count.id}`);
      });
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Fresh sync failed:', error);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

// Run
freshSync();
