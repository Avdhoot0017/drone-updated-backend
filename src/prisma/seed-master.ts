/**
 * Master Data Seed Script
 * Seeds only reference/master data tables:
 * - States
 * - Enforcement Areas & Aliases
 * - Flying Locations & Aliases
 * - Vessel Types & Aliases
 * - Violation Types & Patterns
 *
 * Run with: npm run db:seed:master
 */

import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedMasterData() {
  console.log('🌱 Starting master data seed...\n');

  // ============================================================
  // STATES
  // ============================================================
  console.log('📍 Seeding states...');
  const states = [
    { code: 'MH', name: 'Maharashtra' },
    { code: 'KA', name: 'Karnataka' },
    { code: 'GJ', name: 'Gujarat' },
    { code: 'GA', name: 'Goa' },
    { code: 'DD', name: 'Daman and Diu' },
    { code: 'KL', name: 'Kerala' },
    { code: 'TN', name: 'Tamil Nadu' },
    { code: 'AP', name: 'Andhra Pradesh' },
    { code: 'OD', name: 'Odisha' },
    { code: 'WB', name: 'West Bengal' },
  ];

  for (const state of states) {
    await prisma.state.upsert({
      where: { code: state.code },
      update: { name: state.name },
      create: state,
    });
  }
  console.log(`   ✓ ${states.length} states seeded\n`);

  // Get Maharashtra state for reference
  const maharashtra = await prisma.state.findUnique({ where: { code: 'MH' } });

  // ============================================================
  // ENFORCEMENT AREAS (Districts)
  // ============================================================
  console.log('🏛️  Seeding enforcement areas...');
  const enforcementAreas = [
    { name: 'Raigad', normalizedName: 'raigad' },
    { name: 'Ratnagiri', normalizedName: 'ratnagiri' },
    { name: 'Sindhudurg', normalizedName: 'sindhudurg' },
    { name: 'Palghar', normalizedName: 'palghar' },
    { name: 'Thane', normalizedName: 'thane' },
  ];

  for (const area of enforcementAreas) {
    await prisma.enforcementArea.upsert({
      where: { normalizedName: area.normalizedName },
      update: { name: area.name },
      create: { ...area, stateId: maharashtra?.id },
    });
  }
  console.log(`   ✓ ${enforcementAreas.length} enforcement areas seeded\n`);

  // ============================================================
  // ENFORCEMENT AREA ALIASES
  // ============================================================
  console.log('🔗 Seeding enforcement area aliases...');
  const enforcementAreaAliases = [
    { area: 'sindhudurg', aliases: ['SINDHUDURG', 'SINDHUDURGA', 'SINDUDURGA', 'SINDHDURG'] },
    { area: 'raigad', aliases: ['RAIGAD', 'RAIGADH', 'RAIGARH'] },
    { area: 'ratnagiri', aliases: ['RATNAGIRI', 'RATANAGIRI'] },
    { area: 'palghar', aliases: ['PALGHAR', 'PALGAR'] },
    { area: 'thane', aliases: ['THANE'] },
  ];

  let aliasCount = 0;
  for (const item of enforcementAreaAliases) {
    const area = await prisma.enforcementArea.findUnique({
      where: { normalizedName: item.area },
    });

    if (area) {
      for (const alias of item.aliases) {
        await prisma.enforcementAreaAlias.upsert({
          where: { aliasName: alias },
          update: { enforcementAreaId: area.id },
          create: { enforcementAreaId: area.id, aliasName: alias },
        });
        aliasCount++;
      }
    }
  }
  console.log(`   ✓ ${aliasCount} enforcement area aliases seeded\n`);

  // ============================================================
  // FLYING LOCATIONS
  // ============================================================
  console.log('📌 Seeding flying locations...');
  const flyingLocations = [
    // Raigad
    { name: 'Shrivardhan', normalizedName: 'shrivardhan', area: 'raigad' },
    { name: 'Revdanda', normalizedName: 'revdanda', area: 'raigad' },
    { name: 'Kashid', normalizedName: 'kashid', area: 'raigad' },
    { name: 'Alibag', normalizedName: 'alibag', area: 'raigad' },
    { name: 'Mandwa', normalizedName: 'mandwa', area: 'raigad' },
    { name: 'Murud', normalizedName: 'murud', area: 'raigad' },
    // Ratnagiri
    { name: 'Harnai', normalizedName: 'harnai', area: 'ratnagiri' },
    { name: 'Table Point', normalizedName: 'table_point', area: 'ratnagiri' },
    { name: 'Nate', normalizedName: 'nate', area: 'ratnagiri' },
    { name: 'Ganpatipule', normalizedName: 'ganpatipule', area: 'ratnagiri' },
    { name: 'Mirkarwada', normalizedName: 'mirkarwada', area: 'ratnagiri' },
    { name: 'Ratnagiri', normalizedName: 'ratnagiri_loc', area: 'ratnagiri' },
    { name: 'Jaigad', normalizedName: 'jaigad', area: 'ratnagiri' },
    { name: 'Pawas', normalizedName: 'pawas', area: 'ratnagiri' },
    { name: 'Purnagad', normalizedName: 'purnagad', area: 'ratnagiri' },
    // Sindhudurg
    { name: 'Devgad', normalizedName: 'devgad', area: 'sindhudurg' },
    { name: 'Vengurla', normalizedName: 'vengurla', area: 'sindhudurg' },
    { name: 'Malvan', normalizedName: 'malvan', area: 'sindhudurg' },
    { name: 'Kunkeshwar', normalizedName: 'kunkeshwar', area: 'sindhudurg' },
    // Palghar
    { name: 'Bordi', normalizedName: 'bordi', area: 'palghar' },
    { name: 'Dahanu', normalizedName: 'dahanu', area: 'palghar' },
    { name: 'Tarapur', normalizedName: 'tarapur', area: 'palghar' },
    // Thane
    { name: 'Rangaon Beach', normalizedName: 'rangaon_beach', area: 'thane' },
    { name: 'Uttan', normalizedName: 'uttan', area: 'thane' },
  ];

  let locCount = 0;
  for (const loc of flyingLocations) {
    const area = await prisma.enforcementArea.findUnique({
      where: { normalizedName: loc.area },
    });

    if (area) {
      await prisma.flyingLocation.upsert({
        where: {
          normalizedName_enforcementAreaId: {
            normalizedName: loc.normalizedName,
            enforcementAreaId: area.id,
          },
        },
        update: { name: loc.name },
        create: {
          name: loc.name,
          normalizedName: loc.normalizedName,
          enforcementAreaId: area.id,
        },
      });
      locCount++;
    }
  }
  console.log(`   ✓ ${locCount} flying locations seeded\n`);

  // ============================================================
  // FLYING LOCATION ALIASES
  // ============================================================
  console.log('🔗 Seeding flying location aliases...');
  const flyingLocationAliases = [
    { location: 'table_point', aliases: ['TABLEPOINT', 'TABLE POINT RATNAGIRI'] },
    { location: 'bordi', aliases: ['BORDI BEACH'] },
    { location: 'mirkarwada', aliases: ['MIRKARWADA BEACH', 'MIRKAR WADA'] },
    { location: 'ganpatipule', aliases: ['GANPATI PULE'] },
  ];

  let locAliasCount = 0;
  for (const item of flyingLocationAliases) {
    const location = await prisma.flyingLocation.findFirst({
      where: { normalizedName: item.location },
    });

    if (location) {
      for (const alias of item.aliases) {
        await prisma.flyingLocationAlias.upsert({
          where: { aliasName: alias },
          update: { flyingLocationId: location.id },
          create: { flyingLocationId: location.id, aliasName: alias },
        });
        locAliasCount++;
      }
    }
  }
  console.log(`   ✓ ${locAliasCount} flying location aliases seeded\n`);

  // ============================================================
  // VESSEL TYPES
  // ============================================================
  console.log('🚢 Seeding vessel types...');
  const vesselTypes = [
    { name: 'Trawler', normalizedName: 'trawler', description: 'Fishing vessel using trawl nets' },
    { name: 'Purse Seine', normalizedName: 'purse_seine', description: 'Vessel using purse seine fishing method' },
    { name: 'LED', normalizedName: 'led', description: 'LED light carrying vessel for night fishing' },
    { name: 'Gill Net', normalizedName: 'gill_net', description: 'Vessel using gill nets' },
    { name: 'Pair Trawl', normalizedName: 'pair_trawl', description: 'Two vessels trawling together' },
    { name: 'Malpe Trawler', normalizedName: 'malpe_trawler', description: 'Trawler from Malpe region (Karnataka)' },
    { name: 'Dol Net', normalizedName: 'dol_net', description: 'Vessel using dol/bag nets' },
    { name: 'Ring Seine', normalizedName: 'ring_seine', description: 'Vessel using ring seine method' },
  ];

  for (const type of vesselTypes) {
    await prisma.vesselType.upsert({
      where: { normalizedName: type.normalizedName },
      update: { name: type.name, description: type.description },
      create: type,
    });
  }
  console.log(`   ✓ ${vesselTypes.length} vessel types seeded\n`);

  // ============================================================
  // VESSEL TYPE ALIASES
  // ============================================================
  console.log('🔗 Seeding vessel type aliases...');
  const vesselTypeAliases = [
    { type: 'trawler', aliases: ['TRAWLING', 'TRAWLER (MALPE)', 'GUJRAT TRAWLER', 'TRAWELER', 'TROWLER'] },
    { type: 'purse_seine', aliases: ['PURSE SEINE ', 'PURSESEINE', 'PURSE-SEINE'] },
    { type: 'led', aliases: ['LED FISHING', 'LED BOAT', 'L.E.D'] },
    { type: 'gill_net', aliases: ['GILLNET', 'GILL-NET'] },
    { type: 'pair_trawl', aliases: ['PAIR TRAWLING', 'PAIRTRAWL'] },
  ];

  let typeAliasCount = 0;
  for (const item of vesselTypeAliases) {
    const vesselType = await prisma.vesselType.findUnique({
      where: { normalizedName: item.type },
    });

    if (vesselType) {
      for (const alias of item.aliases) {
        await prisma.vesselTypeAlias.upsert({
          where: { aliasName: alias },
          update: { vesselTypeId: vesselType.id },
          create: { vesselTypeId: vesselType.id, aliasName: alias },
        });
        typeAliasCount++;
      }
    }
  }
  console.log(`   ✓ ${typeAliasCount} vessel type aliases seeded\n`);

  // ============================================================
  // VIOLATION TYPES
  // ============================================================
  console.log('⚠️  Seeding violation types...');
  const violationTypes = [
    { code: 'TRAWLING', name: 'Trawling', description: 'Illegal trawling activity within restricted zone', severityLevel: 2, basePenalty: 100000 },
    { code: 'PURSE_SEINE', name: 'Purse Seine Fishing', description: 'Observed doing purse seine fishing', severityLevel: 2, basePenalty: 100000 },
    { code: 'LED_CARRYING', name: 'LED Vessel', description: 'LED light carrying vessel for illegal fishing', severityLevel: 3, basePenalty: 150000 },
    { code: 'PAIR_TRAWLING', name: 'Pair Trawling', description: 'Two vessels trawling together illegally', severityLevel: 3, basePenalty: 200000 },
    { code: 'OTHER_STATE_BOAT', name: 'Other State Vessels', description: 'Boat from another state fishing in restricted waters', severityLevel: 2, basePenalty: 100000 },
    { code: 'NO_REGISTRATION', name: 'No Registration', description: 'Vessel operating without valid registration', severityLevel: 4, basePenalty: 200000 },
    { code: 'DEPTH_VIOLATION', name: 'Depth Zone Violation', description: 'Fishing below permitted depth (5/10 fathoms)', severityLevel: 2, basePenalty: 100000 },
    { code: 'CLOSED_SEASON', name: 'Closed Season Violation', description: 'Fishing during monsoon ban period', severityLevel: 4, basePenalty: 250000 },
    { code: 'OTHER', name: 'Other', description: 'Other violations not categorized above', severityLevel: 1, basePenalty: 50000 },
  ];

  for (const type of violationTypes) {
    await prisma.violationType.upsert({
      where: { code: type.code },
      update: { name: type.name, description: type.description, severityLevel: type.severityLevel, basePenalty: type.basePenalty },
      create: type,
    });
  }
  console.log(`   ✓ ${violationTypes.length} violation types seeded\n`);

  // ============================================================
  // VIOLATION PATTERNS (for auto-detection)
  // ============================================================
  console.log('🔍 Seeding violation patterns...');

  // First clear existing patterns to avoid duplicates
  await prisma.violationPattern.deleteMany({});

  const violationPatterns = [
    { code: 'TRAWLING', patterns: ['TRAWL', 'TRAWLING'] },
    { code: 'PURSE_SEINE', patterns: ['PURSE SEINE', 'PURSESEINE'] },
    { code: 'LED_CARRYING', patterns: ['LED', 'GENERATOR', 'L.E.D'] },
    { code: 'PAIR_TRAWLING', patterns: ['PAIR TRAWL', 'PAIR FISHING'] },
    { code: 'OTHER_STATE_BOAT', patterns: ['OTHER STATE', 'MALPE', 'GUJRAT', 'GUJARAT', 'KARNATAKA'] },
    { code: 'DEPTH_VIOLATION', patterns: ['BELOW 5 FATHOM', 'BELOW 10 FATHOM', 'DEPTH VIOLATION'] },
  ];

  let patternCount = 0;
  for (const item of violationPatterns) {
    const violationType = await prisma.violationType.findUnique({
      where: { code: item.code },
    });

    if (violationType) {
      for (let i = 0; i < item.patterns.length; i++) {
        await prisma.violationPattern.create({
          data: {
            violationTypeId: violationType.id,
            pattern: item.patterns[i],
            priority: i + 1,
          },
        });
        patternCount++;
      }
    }
  }
  console.log(`   ✓ ${patternCount} violation patterns seeded\n`);

  // ============================================================
  // FISHING LICENSE TYPES
  // ============================================================
  console.log('📜 Seeding fishing license types...');
  const fishingLicenseTypes = [
    { code: 'BAG_NET', name: 'Bag net', description: 'License for bag net fishing' },
    { code: 'DOL_NET', name: 'Dol net', description: 'License for dol net fishing' },
    { code: 'DISCO_NET', name: 'Disco net', description: 'License for disco net fishing' },
    { code: 'GILL_NET', name: 'Gill net', description: 'License for gill net fishing' },
    { code: 'TRAWLER', name: 'Trawler', description: 'License for trawler vessels' },
    { code: 'PURSE_SEINE', name: 'Purse seine', description: 'License for purse seine fishing' },
    { code: 'LONGLINE', name: 'Longline', description: 'License for longline fishing' },
  ];

  for (const license of fishingLicenseTypes) {
    await prisma.fishingLicenseType.upsert({
      where: { code: license.code },
      update: { name: license.name, description: license.description },
      create: license,
    });
  }
  console.log(`   ✓ ${fishingLicenseTypes.length} fishing license types seeded\n`);

  // ============================================================
  // PENALTY CONFIGURATIONS
  // ============================================================
  console.log('💰 Seeding penalty configurations...');

  // Base amount is always 20,000
  // Penalty amounts vary by violation type and occurrence
  const penaltyConfigs = [
    // Trawling: 1st - 1L, 2nd - 3L, 3rd+ - 7L
    { code: 'TRAWLING', configs: [
      { occurrence: 1, penaltyAmount: 100000 },
      { occurrence: 2, penaltyAmount: 300000 },
      { occurrence: 3, penaltyAmount: 700000 },
    ]},
    // Purse Seine: 1st - 1L, 2nd - 3L, 3rd+ - 7L
    { code: 'PURSE_SEINE', configs: [
      { occurrence: 1, penaltyAmount: 100000 },
      { occurrence: 2, penaltyAmount: 300000 },
      { occurrence: 3, penaltyAmount: 700000 },
    ]},
    // LED: 1st - 1.5L, 2nd - 3.5L, 3rd+ - 8L
    { code: 'LED_CARRYING', configs: [
      { occurrence: 1, penaltyAmount: 150000 },
      { occurrence: 2, penaltyAmount: 350000 },
      { occurrence: 3, penaltyAmount: 800000 },
    ]},
    // Pair Trawling: 1st - 2L, 2nd - 4L, 3rd+ - 10L
    { code: 'PAIR_TRAWLING', configs: [
      { occurrence: 1, penaltyAmount: 200000 },
      { occurrence: 2, penaltyAmount: 400000 },
      { occurrence: 3, penaltyAmount: 1000000 },
    ]},
    // Other State: 1st - 1L, 2nd - 2L, 3rd+ - 5L
    { code: 'OTHER_STATE_BOAT', configs: [
      { occurrence: 1, penaltyAmount: 100000 },
      { occurrence: 2, penaltyAmount: 200000 },
      { occurrence: 3, penaltyAmount: 500000 },
    ]},
  ];

  let penaltyConfigCount = 0;
  for (const item of penaltyConfigs) {
    const violationType = await prisma.violationType.findUnique({
      where: { code: item.code },
    });

    if (violationType) {
      for (const config of item.configs) {
        await prisma.penaltyConfiguration.upsert({
          where: {
            violationTypeId_occurrence: {
              violationTypeId: violationType.id,
              occurrence: config.occurrence,
            },
          },
          update: { penaltyAmount: config.penaltyAmount },
          create: {
            violationTypeId: violationType.id,
            occurrence: config.occurrence,
            baseAmount: 20000,
            penaltyAmount: config.penaltyAmount,
            description: `${item.code} - Occurrence ${config.occurrence}`,
          },
        });
        penaltyConfigCount++;
      }
    }
  }
  console.log(`   ✓ ${penaltyConfigCount} penalty configurations seeded\n`);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('═══════════════════════════════════════════════════');
  console.log('✅ Master data seed completed successfully!\n');

  const counts = await Promise.all([
    prisma.state.count(),
    prisma.enforcementArea.count(),
    prisma.enforcementAreaAlias.count(),
    prisma.flyingLocation.count(),
    prisma.flyingLocationAlias.count(),
    prisma.vesselType.count(),
    prisma.vesselTypeAlias.count(),
    prisma.violationType.count(),
    prisma.violationPattern.count(),
    prisma.fishingLicenseType.count(),
    prisma.penaltyConfiguration.count(),
  ]);

  console.log('📊 Final counts:');
  console.log(`   States:                   ${counts[0]}`);
  console.log(`   Enforcement Areas:        ${counts[1]}`);
  console.log(`   Enforcement Area Aliases: ${counts[2]}`);
  console.log(`   Flying Locations:         ${counts[3]}`);
  console.log(`   Flying Location Aliases:  ${counts[4]}`);
  console.log(`   Vessel Types:             ${counts[5]}`);
  console.log(`   Vessel Type Aliases:      ${counts[6]}`);
  console.log(`   Violation Types:          ${counts[7]}`);
  console.log(`   Violation Patterns:       ${counts[8]}`);
  console.log(`   Fishing License Types:    ${counts[9]}`);
  console.log(`   Penalty Configurations:   ${counts[10]}`);
  console.log('═══════════════════════════════════════════════════\n');
}

seedMasterData()
  .catch((e) => {
    console.error('❌ Master data seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
