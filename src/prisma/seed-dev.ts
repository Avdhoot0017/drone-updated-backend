/**
 * Development Seed - Based on Actual Drone Surveillance Data
 * Data patterns from: ड्रोन द्वारे मासेमारी नौकांवर केलेल्या कार्यवाहीबाबत
 * Period: 01/08/2025 to 31/07/2026
 *
 * Run: npm run db:seed:dev
 */

import { PrismaClient, ObservationStatus, SyncStatus } from '@prisma/client';
import { hashPassword } from '../utils/password';

const prisma = new PrismaClient();

// Helper functions
function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function randomTime(): Date {
  const date = new Date();
  // Most observations between 5 AM and 7 PM
  const hour = Math.random() > 0.3 ? Math.floor(Math.random() * 14) + 5 : Math.floor(Math.random() * 24);
  date.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return date;
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').trim();
}

// Weighted random selection
function weightedPick<T>(items: { item: T; weight: number }[]): T {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  let random = Math.random() * totalWeight;
  for (const { item, weight } of items) {
    random -= weight;
    if (random <= 0) return item;
  }
  return items[0].item;
}

async function main() {
  console.log('🌱 Starting development seed (based on actual data patterns)...\n');

  // Clear existing data
  console.log('🗑️  Clearing existing data...');
  await prisma.syncRecord.deleteMany();
  await prisma.observationHistory.deleteMany();
  await prisma.penalty.deleteMany();
  await prisma.actionReport.deleteMany();
  await prisma.observationEvidence.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.syncBatch.deleteMany();
  await prisma.sheetTab.deleteMany();
  await prisma.googleSheetConfig.deleteMany();
  await prisma.dailyStatistics.deleteMany();
  await prisma.monthlyStatistics.deleteMany();
  await prisma.vesselNameHistory.deleteMany();
  await prisma.vessel.deleteMany();
  await prisma.flyingLocationAlias.deleteMany();
  await prisma.flyingLocation.deleteMany();
  await prisma.enforcementAreaAlias.deleteMany();
  await prisma.enforcementArea.deleteMany();
  await prisma.violationPattern.deleteMany();
  await prisma.violationType.deleteMany();
  await prisma.vesselTypeAlias.deleteMany();
  await prisma.vesselType.deleteMany();
  await prisma.state.deleteMany();
  await prisma.userActivityLog.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.user.deleteMany();
  console.log('   ✓ Cleared all data');

  // ============ STATE ============
  console.log('📍 Seeding state...');
  const maharashtra = await prisma.state.create({
    data: { code: 'MH', name: 'Maharashtra' },
  });
  console.log('   ✓ Created Maharashtra state');

  // ============ 5 DISTRICTS (Enforcement Areas) ============
  console.log('🏛️  Seeding 5 districts...');
  const districtsData = [
    { name: 'Raigad', expectedObs: 302 },
    { name: 'Ratnagiri', expectedObs: 555 },
    { name: 'Sindhudurg', expectedObs: 263 },
    { name: 'Palghar', expectedObs: 5 },
    { name: 'Thane', expectedObs: 1 },
  ];

  const districts: Record<string, { id: string; expectedObs: number }> = {};
  for (const d of districtsData) {
    const area = await prisma.enforcementArea.create({
      data: {
        name: d.name,
        normalizedName: normalize(d.name),
        stateId: maharashtra.id,
      },
    });
    districts[d.name] = { id: area.id, expectedObs: d.expectedObs };
  }
  console.log('   ✓ Created 5 districts');

  // ============ FLYING LOCATIONS (Based on actual data) ============
  console.log('🚁 Seeding flying locations...');
  const locationsData: { name: string; district: string }[] = [
    // Raigad
    { name: 'Shrivardhan', district: 'Raigad' },
    { name: 'Revdanda', district: 'Raigad' },
    { name: 'Kashid', district: 'Raigad' },
    // Ratnagiri
    { name: 'Harnai', district: 'Ratnagiri' },
    { name: 'Table Point', district: 'Ratnagiri' },
    { name: 'Nate', district: 'Ratnagiri' },
    { name: 'Ganpatipule', district: 'Ratnagiri' },
    // Sindhudurg
    { name: 'Devgad', district: 'Sindhudurg' },
    { name: 'Vengurla', district: 'Sindhudurg' },
    { name: 'Vengurla Lighthouse', district: 'Sindhudurg' },
    // Palghar
    { name: 'Bordi Beach', district: 'Palghar' },
    { name: 'Bordi', district: 'Palghar' },
    // Thane
    { name: 'Rangaon Beach', district: 'Thane' },
  ];

  const locations: Record<string, string> = {};
  for (const loc of locationsData) {
    const created = await prisma.flyingLocation.create({
      data: {
        name: loc.name,
        normalizedName: normalize(loc.name),
        enforcementAreaId: districts[loc.district].id,
        latitude: 16 + Math.random() * 4,
        longitude: 72 + Math.random() * 2,
      },
    });
    locations[loc.name] = created.id;
  }
  console.log(`   ✓ Created ${locationsData.length} flying locations`);

  // ============ VESSEL TYPES (Based on actual data) ============
  console.log('🚢 Seeding vessel types...');
  const vesselTypesData = [
    { name: 'Trawler', description: 'Bottom trawling fishing vessel' },
    { name: 'Purse Seine', description: 'Purse seine net fishing vessel' },
    { name: 'LED', description: 'LED light fishing vessel' },
    { name: 'Gill Net', description: 'Gill net fishing vessel' },
    { name: 'Malpe Trawler', description: 'Trawler from Malpe (Karnataka)' },
    { name: 'Pair Trawl', description: 'Pair trawling vessel' },
    { name: 'Gujarat Trawler', description: 'Trawler from Gujarat' },
  ];

  const vesselTypes: Record<string, string> = {};
  for (const vt of vesselTypesData) {
    const created = await prisma.vesselType.create({
      data: {
        name: vt.name,
        normalizedName: normalize(vt.name),
        description: vt.description,
      },
    });
    vesselTypes[vt.name] = created.id;
  }
  console.log(`   ✓ Created ${vesselTypesData.length} vessel types`);

  // ============ VIOLATION TYPES (Based on actual data) ============
  console.log('⚠️  Seeding violation types...');
  const violationTypesData = [
    { code: 'TRAWL', name: 'Trawling', description: 'Illegal trawling within restricted zone', severityLevel: 4, basePenalty: 50000 },
    { code: 'PURSE', name: 'Purse Seine Activity', description: 'Illegal purse seine fishing', severityLevel: 4, basePenalty: 100000 },
    { code: 'LED', name: 'LED & Generator', description: 'LED light fishing with generator', severityLevel: 3, basePenalty: 25000 },
    { code: 'OTHER-STATE', name: 'Other State Boat', description: 'Other state boat in Maharashtra waters', severityLevel: 3, basePenalty: 30000 },
    { code: 'PAIR', name: 'Pair Trawling', description: 'Pair trawling activity', severityLevel: 5, basePenalty: 75000 },
    { code: 'DEPTH', name: 'Below Fathom Limit', description: 'Fishing below allowed fathom depth', severityLevel: 3, basePenalty: 20000 },
  ];

  const violationTypes: Record<string, { id: string; basePenalty: number }> = {};
  for (const v of violationTypesData) {
    const created = await prisma.violationType.create({
      data: {
        code: v.code,
        name: v.name,
        description: v.description,
        severityLevel: v.severityLevel,
        basePenalty: v.basePenalty,
      },
    });
    violationTypes[v.code] = { id: created.id, basePenalty: v.basePenalty };
  }
  console.log(`   ✓ Created ${violationTypesData.length} violation types`);

  // ============ VESSELS (Based on actual patterns) ============
  console.log('🚤 Seeding vessels...');
  const vesselNames = [
    'Gangeshwari', 'Kadsiddh', 'Ram Ram', 'Devachi Aalandi', 'Vitthal Bhakti',
    'Bhagya Laxmi', 'Kaiwalyaraja', 'Bhairi Bhavani', 'Himgiri', 'Aai Mauli',
    'Hareshwari', 'Aamir Ali', 'Abdul Gafoor', 'Sakina Ismail', 'Shiv Prasad',
    'Hanifa', 'Fazal-e-Rahaman', 'Simran', 'Alifeya', 'Darya Bahadur',
    'Laxmi Narayan', 'Sujal Prasad', 'Shiv Leela', 'Jay Tulsi Mata', 'Ram Rameshvar Krupa',
    'Ocean Star', 'Sea Hunter', 'Blue Marlin', 'Golden Wave', 'Silver Fin',
    'Pearl Diver', 'Storm Rider', 'Coral Queen', 'Neptune Pride', 'Dolphin Dream',
    'Fishing King', 'Sea Eagle', 'Wave Runner', 'Tide Master', 'Deep Blue',
    'Sun Seeker', 'Moon Shadow', 'Star Fish', 'Sea Breeze', 'Ocean Quest',
  ];

  const createdVessels: { id: string; name: string | null; vesselTypeId: string | null }[] = [];
  const vesselTypeWeights = [
    { item: 'Trawler', weight: 60 },
    { item: 'Purse Seine', weight: 25 },
    { item: 'LED', weight: 8 },
    { item: 'Gill Net', weight: 4 },
    { item: 'Malpe Trawler', weight: 2 },
    { item: 'Pair Trawl', weight: 1 },
  ];

  for (let i = 0; i < vesselNames.length; i++) {
    const vesselTypeName = weightedPick(vesselTypeWeights);
    const regPrefix = ['MH-3', 'MH-4', 'MH-5', 'MH-7'][Math.floor(Math.random() * 4)];
    const regNo = `IND-${regPrefix}-MM-${String(1000 + i).padStart(4, '0')}`;

    const vessel = await prisma.vessel.create({
      data: {
        name: vesselNames[i],
        registrationNumber: regNo,
        vesselTypeId: vesselTypes[vesselTypeName],
        stateId: maharashtra.id,
        ownerName: `Owner of ${vesselNames[i]}`,
        ownerContact: `98${String(randomInt(10000000, 99999999))}`,
        isFlagged: i < 5,
        flagReason: i < 5 ? 'Multiple violations detected' : null,
        totalViolations: i < 5 ? randomInt(5, 15) : randomInt(0, 5),
        currentRiskScore: i < 5 ? randomInt(60, 95) : randomInt(10, 59),
        riskCategory: i < 5 ? 'high' : i < 15 ? 'medium' : 'low',
      },
    });
    createdVessels.push({ id: vessel.id, name: vessel.name, vesselTypeId: vessel.vesselTypeId });
  }
  console.log(`   ✓ Created ${createdVessels.length} vessels`);

  // ============ GOOGLE SHEET CONFIG ============
  console.log('⚙️  Seeding Google Sheet config...');
  const sheetConfig = await prisma.googleSheetConfig.create({
    data: {
      name: 'Drone Surveillance Observations',
      sheetId: 'actual-sheet-id',
      syncSchedule: '0 20 * * *',
      syncEnabled: true,
      lastSyncAt: new Date(),
    },
  });

  // Create 5 sheet tabs
  for (const districtName of Object.keys(districts)) {
    await prisma.sheetTab.create({
      data: {
        googleSheetConfigId: sheetConfig.id,
        tabName: districtName,
        enforcementAreaId: districts[districtName].id,
        headerRow: 1,
        dataStartRow: 2,
        isActive: true,
      },
    });
  }
  console.log('   ✓ Created Google Sheet config with 5 tabs');

  // ============ SYNC BATCHES ============
  console.log('📦 Seeding sync batches...');
  const now = new Date();
  const syncBatches: string[] = [];

  for (let i = 0; i < 30; i++) {
    const batchDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const startTime = new Date(batchDate);
    startTime.setHours(20, 0, 0, 0);
    const endTime = new Date(startTime.getTime() + randomInt(30000, 180000));

    const batch = await prisma.syncBatch.create({
      data: {
        googleSheetConfigId: sheetConfig.id,
        startedAt: startTime,
        completedAt: endTime,
        status: SyncStatus.completed,
        totalRowsScanned: randomInt(30, 80),
        newRecordsAdded: randomInt(5, 25),
        duplicateRecords: randomInt(10, 50),
        errorRecords: randomInt(0, 3),
        durationMs: endTime.getTime() - startTime.getTime(),
        triggeredBy: 'scheduled',
      },
    });
    syncBatches.push(batch.id);
  }
  console.log(`   ✓ Created ${syncBatches.length} sync batches`);

  // ============ OBSERVATIONS ============
  console.log('👁️  Seeding observations (matching actual data patterns)...');

  const startDate = new Date('2025-08-01');
  const endDate = new Date('2026-04-21');

  // District distribution matching actual data
  const districtObsCounts: Record<string, number> = {
    'Raigad': 302,
    'Ratnagiri': 555,
    'Sindhudurg': 263,
    'Palghar': 5,
    'Thane': 1,
  };

  // Location mapping per district
  const districtLocations: Record<string, string[]> = {
    'Raigad': ['Shrivardhan', 'Revdanda', 'Kashid'],
    'Ratnagiri': ['Harnai', 'Table Point', 'Nate', 'Ganpatipule'],
    'Sindhudurg': ['Devgad', 'Vengurla', 'Vengurla Lighthouse'],
    'Palghar': ['Bordi Beach', 'Bordi'],
    'Thane': ['Rangaon Beach'],
  };

  // Violation weights per district (based on actual data)
  const violationWeights: Record<string, { item: string; weight: number }[]> = {
    'Raigad': [
      { item: 'TRAWL', weight: 63 },
      { item: 'OTHER-STATE', weight: 7 },
      { item: 'PURSE', weight: 18 },
      { item: 'LED', weight: 12 },
    ],
    'Ratnagiri': [
      { item: 'TRAWL', weight: 48 },
      { item: 'PURSE', weight: 35 },
      { item: 'LED', weight: 10 },
      { item: 'PAIR', weight: 7 },
    ],
    'Sindhudurg': [
      { item: 'TRAWL', weight: 67 },
      { item: 'PURSE', weight: 30 },
      { item: 'OTHER-STATE', weight: 3 },
    ],
    'Palghar': [
      { item: 'OTHER-STATE', weight: 100 },
    ],
    'Thane': [
      { item: 'PURSE', weight: 100 },
    ],
  };

  // Case status distribution (based on actual data)
  const caseStatusWeights: Record<string, { item: ObservationStatus; weight: number }[]> = {
    'Raigad': [
      { item: ObservationStatus.disposed, weight: 6 },
      { item: ObservationStatus.action_pending, weight: 82 },
      { item: ObservationStatus.under_review, weight: 8 },
      { item: ObservationStatus.reported, weight: 4 },
    ],
    'Ratnagiri': [
      { item: ObservationStatus.disposed, weight: 12 },
      { item: ObservationStatus.action_pending, weight: 80 },
      { item: ObservationStatus.action_taken, weight: 5 },
      { item: ObservationStatus.under_review, weight: 3 },
    ],
    'Sindhudurg': [
      { item: ObservationStatus.disposed, weight: 70 },
      { item: ObservationStatus.action_pending, weight: 24 },
      { item: ObservationStatus.action_taken, weight: 6 },
    ],
    'Palghar': [
      { item: ObservationStatus.disposed, weight: 60 },
      { item: ObservationStatus.action_pending, weight: 40 },
    ],
    'Thane': [
      { item: ObservationStatus.action_pending, weight: 100 },
    ],
  };

  let totalObs = 0;
  const observationIds: string[] = [];

  for (const [districtName, obsCount] of Object.entries(districtObsCounts)) {
    const districtId = districts[districtName].id;
    const districtLocs = districtLocations[districtName];
    const violationW = violationWeights[districtName];
    const statusW = caseStatusWeights[districtName];

    for (let i = 0; i < obsCount; i++) {
      const obsDate = randomDate(startDate, endDate);
      const obsTime = randomTime();
      const locationName = randomPick(districtLocs);
      const vessel = randomPick(createdVessels);
      const violationCode = weightedPick(violationW);
      const status = weightedPick(statusW);

      const uniqueKey = `${districtName}_${locationName}_${i}_${Date.now()}_${Math.random()}`;
      // Generate realistic distance distribution (most violations near coast)
      const distanceRand = Math.random();
      let distanceKm: number;
      if (distanceRand < 0.35) {
        distanceKm = parseFloat((Math.random() * 5).toFixed(1)); // 0-5 km (35%)
      } else if (distanceRand < 0.65) {
        distanceKm = parseFloat((5 + Math.random() * 5).toFixed(1)); // 5-10 km (30%)
      } else if (distanceRand < 0.85) {
        distanceKm = parseFloat((10 + Math.random() * 10).toFixed(1)); // 10-20 km (20%)
      } else if (distanceRand < 0.95) {
        distanceKm = parseFloat((20 + Math.random() * 30).toFixed(1)); // 20-50 km (10%)
      } else {
        distanceKm = parseFloat((50 + Math.random() * 50).toFixed(1)); // 50-100 km (5%)
      }

      try {
        const obs = await prisma.observation.create({
          data: {
            uniqueKey,
            enforcementAreaId: districtId,
            flyingLocationId: locations[locationName],
            vesselId: vessel.id,
            violationTypeId: violationTypes[violationCode].id,
            observationDate: obsDate,
            observationTime: obsTime,
            observationDatetime: obsDate,
            latitude: 16 + Math.random() * 4,
            longitude: 72 + Math.random() * 2,
            distanceFromCoastKm: distanceKm,
            status,
            originalVesselName: vessel.name,
            originalVesselReg: `IND-MH-${randomInt(3, 7)}-MM-${randomInt(100, 9999)}`,
            originalViolationText: violationTypesData.find(v => v.code === violationCode)?.name || '',
            observationHour: obsTime.getHours(),
            observationDayOfWeek: obsDate.getDay(),
            observationMonth: obsDate.getMonth() + 1,
            observationYear: obsDate.getFullYear(),
            syncBatchId: randomPick(syncBatches),
          },
        });
        observationIds.push(obs.id);
        totalObs++;
      } catch {
        // Skip duplicates
      }

      if (totalObs % 100 === 0) {
        process.stdout.write(`   Creating observations: ${totalObs}\r`);
      }
    }
  }
  console.log(`\n   ✓ Created ${totalObs} observations`);

  // ============ PENALTIES (Based on actual data) ============
  console.log('💰 Seeding penalties...');

  // Actual penalty data patterns:
  // Raigad: ₹10,000 imposed, ₹5,000 recovered (2 cases)
  // Ratnagiri: ₹13,00,000 imposed, ₹2,10,000 recovered (6 cases)
  // Sindhudurg: ₹15,00,000 imposed, ₹11,00,000 recovered (15 cases)
  // Palghar & Thane: No penalties

  const penaltyDistribution = [
    { district: 'Raigad', cases: 2, totalImposed: 10000, totalRecovered: 5000 },
    { district: 'Ratnagiri', cases: 6, totalImposed: 1300000, totalRecovered: 210000 },
    { district: 'Sindhudurg', cases: 15, totalImposed: 1500000, totalRecovered: 1100000 },
  ];

  let penaltyCount = 0;
  const disposedObservations = await prisma.observation.findMany({
    where: {
      status: {
        in: [ObservationStatus.action_taken, ObservationStatus.disposed],
      },
    },
    include: {
      enforcementArea: true,
    },
  });

  for (const dist of penaltyDistribution) {
    const distObs = disposedObservations
      .filter(o => o.enforcementArea?.name === dist.district)
      .slice(0, dist.cases);

    const avgImposed = dist.totalImposed / dist.cases;
    const avgRecovered = dist.totalRecovered / dist.cases;

    for (const obs of distObs) {
      const imposed = Math.round(avgImposed * (0.8 + Math.random() * 0.4));
      const recovered = Math.round(avgRecovered * (0.8 + Math.random() * 0.4));

      await prisma.penalty.create({
        data: {
          observationId: obs.id,
          penaltyImposed: imposed,
          penaltyRecovered: Math.min(recovered, imposed),
          fishAuctionAmount: Math.random() > 0.7 ? randomInt(5000, 50000) : 0,
        },
      });
      penaltyCount++;
    }
  }
  console.log(`   ✓ Created ${penaltyCount} penalties`);

  // ============ USERS ============
  console.log('👤 Seeding users...');
  const adminPassword = await hashPassword('Admin@123');
  const memberPassword = await hashPassword('Member@123');

  await prisma.user.create({
    data: {
      userId: 'admin',
      passwordHash: adminPassword,
      fullName: 'System Administrator',
      email: 'admin@fisheries.gov.in',
      phone: '9876543210',
      designation: 'Chief Administrator',
      role: 'admin',
      status: 'active',
      canViewAllAreas: true,
      mustChangePassword: false,
    },
  });

  const districtOfficers = [
    { userId: 'raigad', name: 'Raigad District Officer', district: 'Raigad' },
    { userId: 'ratnagiri', name: 'Ratnagiri District Officer', district: 'Ratnagiri' },
    { userId: 'sindhudurg', name: 'Sindhudurg District Officer', district: 'Sindhudurg' },
    { userId: 'palghar', name: 'Palghar District Officer', district: 'Palghar' },
    { userId: 'thane', name: 'Thane District Officer', district: 'Thane' },
  ];

  for (const officer of districtOfficers) {
    await prisma.user.create({
      data: {
        userId: officer.userId,
        passwordHash: memberPassword,
        fullName: officer.name,
        email: `${officer.userId}@fisheries.gov.in`,
        designation: 'District Enforcement Officer',
        role: 'member',
        status: 'active',
        enforcementAreaId: districts[officer.district].id,
        canViewAllAreas: false,
        mustChangePassword: false,
      },
    });
  }
  console.log('   ✓ Created 6 users (1 admin + 5 district officers)');

  // ============ SUMMARY ============
  console.log('\n✅ Development seed completed successfully!\n');
  console.log('📊 Summary (matching actual data patterns):');
  console.log('   • Total Observations: 1,126');
  console.log('   • Districts:');
  console.log('     - Raigad: 302 observations');
  console.log('     - Ratnagiri: 555 observations');
  console.log('     - Sindhudurg: 263 observations');
  console.log('     - Palghar: 5 observations');
  console.log('     - Thane: 1 observation');
  console.log('   • Total Penalty Imposed: ₹28,10,000');
  console.log('   • Total Penalty Recovered: ₹13,15,000');
  console.log('   • Recovery Rate: ~46.8%');
  console.log('   • Vessels: 45');
  console.log('   • Users: 6');

  console.log('\n🔐 Login Credentials:');
  console.log('   Admin: admin / Admin@123');
  console.log('   Officers: raigad, ratnagiri, sindhudurg, palghar, thane / Member@123');
}

main()
  .catch((e) => {
    console.error('\n❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
