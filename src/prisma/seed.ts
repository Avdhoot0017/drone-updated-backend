/**
 * Database seed script
 * Run with: npm run db:seed
 */

import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../utils/password';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Seed States
  console.log('Seeding states...');
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
      update: {},
      create: state,
    });
  }

  // Get Maharashtra state for reference
  const maharashtra = await prisma.state.findUnique({ where: { code: 'MH' } });

  // Seed Enforcement Areas
  console.log('Seeding enforcement areas...');
  const enforcementAreas = [
    { name: 'RAIGAD', normalizedName: 'RAIGAD' },
    { name: 'RATNAGIRI', normalizedName: 'RATNAGIRI' },
    { name: 'SINDHUDURG', normalizedName: 'SINDHUDURG' },
    { name: 'PALGHAR', normalizedName: 'PALGHAR' },
    { name: 'THANE', normalizedName: 'THANE' },
  ];

  for (const area of enforcementAreas) {
    await prisma.enforcementArea.upsert({
      where: { normalizedName: area.normalizedName },
      update: {},
      create: { ...area, stateId: maharashtra?.id },
    });
  }

  // Seed Enforcement Area Aliases
  console.log('Seeding enforcement area aliases...');
  const sindhudurg = await prisma.enforcementArea.findUnique({
    where: { normalizedName: 'SINDHUDURG' },
  });

  if (sindhudurg) {
    const aliases = ['SINDUDURGA', 'SINDHUDURGA'];
    for (const alias of aliases) {
      await prisma.enforcementAreaAlias.upsert({
        where: { aliasName: alias },
        update: {},
        create: { enforcementAreaId: sindhudurg.id, aliasName: alias },
      });
    }
  }

  // Seed Flying Locations
  console.log('Seeding flying locations...');
  const flyingLocations = [
    { name: 'SHRIVARDHAN', normalizedName: 'SHRIVARDHAN', area: 'RAIGAD' },
    { name: 'REVDANDA', normalizedName: 'REVDANDA', area: 'RAIGAD' },
    { name: 'KASHID', normalizedName: 'KASHID', area: 'RAIGAD' },
    { name: 'HARNAI', normalizedName: 'HARNAI', area: 'RATNAGIRI' },
    { name: 'TABLE POINT', normalizedName: 'TABLE_POINT', area: 'RATNAGIRI' },
    { name: 'NATE', normalizedName: 'NATE', area: 'RATNAGIRI' },
    { name: 'GANPATIPULE', normalizedName: 'GANPATIPULE', area: 'RATNAGIRI' },
    { name: 'DEVGAD', normalizedName: 'DEVGAD', area: 'SINDHUDURG' },
    { name: 'VENGURLA', normalizedName: 'VENGURLA', area: 'SINDHUDURG' },
    { name: 'BORDI', normalizedName: 'BORDI', area: 'PALGHAR' },
    { name: 'RANGAON BEACH', normalizedName: 'RANGAON_BEACH', area: 'THANE' },
  ];

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
        update: {},
        create: {
          name: loc.name,
          normalizedName: loc.normalizedName,
          enforcementAreaId: area.id,
        },
      });
    }
  }

  // Seed Flying Location Aliases
  console.log('Seeding flying location aliases...');
  const tablePoint = await prisma.flyingLocation.findFirst({
    where: { normalizedName: 'TABLE_POINT' },
  });
  if (tablePoint) {
    await prisma.flyingLocationAlias.upsert({
      where: { aliasName: 'TABLEPOINT' },
      update: {},
      create: { flyingLocationId: tablePoint.id, aliasName: 'TABLEPOINT' },
    });
  }

  const bordi = await prisma.flyingLocation.findFirst({
    where: { normalizedName: 'BORDI' },
  });
  if (bordi) {
    await prisma.flyingLocationAlias.upsert({
      where: { aliasName: 'BORDI BEACH' },
      update: {},
      create: { flyingLocationId: bordi.id, aliasName: 'BORDI BEACH' },
    });
  }

  // Seed Vessel Types
  console.log('Seeding vessel types...');
  const vesselTypes = [
    { name: 'TRAWLER', normalizedName: 'TRAWLER', description: 'Fishing vessel using trawl nets' },
    { name: 'PURSE SEINE', normalizedName: 'PURSE_SEINE', description: 'Vessel using purse seine fishing method' },
    { name: 'LED', normalizedName: 'LED', description: 'LED light carrying vessel for night fishing' },
    { name: 'GILL NET', normalizedName: 'GILL_NET', description: 'Vessel using gill nets' },
    { name: 'PAIR TRAWL', normalizedName: 'PAIR_TRAWL', description: 'Two vessels trawling together' },
    { name: 'MALPE TRAWLER', normalizedName: 'MALPE_TRAWLER', description: 'Trawler from Malpe region' },
  ];

  for (const type of vesselTypes) {
    await prisma.vesselType.upsert({
      where: { normalizedName: type.normalizedName },
      update: {},
      create: type,
    });
  }

  // Seed Vessel Type Aliases
  console.log('Seeding vessel type aliases...');
  const trawler = await prisma.vesselType.findUnique({ where: { normalizedName: 'TRAWLER' } });
  const purseSeine = await prisma.vesselType.findUnique({ where: { normalizedName: 'PURSE_SEINE' } });

  if (trawler) {
    const trawlerAliases = ['TRAWLING', 'TRAWLER (MALPE)', 'GUJRAT TRAWLER'];
    for (const alias of trawlerAliases) {
      await prisma.vesselTypeAlias.upsert({
        where: { aliasName: alias },
        update: {},
        create: { vesselTypeId: trawler.id, aliasName: alias },
      });
    }
  }

  if (purseSeine) {
    await prisma.vesselTypeAlias.upsert({
      where: { aliasName: 'PURSE SEINE ' },
      update: {},
      create: { vesselTypeId: purseSeine.id, aliasName: 'PURSE SEINE ' },
    });
  }

  // Seed Violation Types
  console.log('Seeding violation types...');
  const violationTypes = [
    { code: 'TRAWLING', name: 'Trawling', description: 'Illegal trawling activity within restricted zone', severityLevel: 2, basePenalty: 100000 },
    { code: 'PURSE_SEINE', name: 'Purse Seine Fishing', description: 'Observed doing purse seine fishing', severityLevel: 2, basePenalty: 100000 },
    { code: 'LED_CARRYING', name: 'LED Vessel', description: 'LED light carrying vessel for illegal fishing', severityLevel: 3, basePenalty: 150000 },
    { code: 'PAIR_TRAWLING', name: 'Pair Trawling', description: 'Two vessels trawling together illegally', severityLevel: 3, basePenalty: 200000 },
    { code: 'OTHER_STATE_BOAT', name: 'Other State Vessels', description: 'Boat from another state fishing in restricted waters', severityLevel: 2, basePenalty: 100000 },
    { code: 'NO_REGISTRATION', name: 'No Registration', description: 'Vessel operating without valid registration', severityLevel: 4, basePenalty: 200000 },
    { code: 'MALPE_TRAWLING', name: 'Malpe Boat Trawling', description: 'Malpe registered boat trawling in restricted area', severityLevel: 2, basePenalty: 100000 },
  ];

  for (const type of violationTypes) {
    await prisma.violationType.upsert({
      where: { code: type.code },
      update: {},
      create: type,
    });
  }

  // Seed Violation Patterns
  console.log('Seeding violation patterns...');
  const trawlingType = await prisma.violationType.findUnique({ where: { code: 'TRAWLING' } });
  const purseSeineType = await prisma.violationType.findUnique({ where: { code: 'PURSE_SEINE' } });
  const ledType = await prisma.violationType.findUnique({ where: { code: 'LED_CARRYING' } });
  const pairType = await prisma.violationType.findUnique({ where: { code: 'PAIR_TRAWLING' } });
  const otherStateType = await prisma.violationType.findUnique({ where: { code: 'OTHER_STATE_BOAT' } });

  const patterns = [
    { violationTypeId: trawlingType?.id, pattern: 'TRAWL', priority: 1 },
    { violationTypeId: purseSeineType?.id, pattern: 'PURSE SEINE', priority: 2 },
    { violationTypeId: ledType?.id, pattern: 'LED', priority: 3 },
    { violationTypeId: ledType?.id, pattern: 'GENERATOR', priority: 3 },
    { violationTypeId: pairType?.id, pattern: 'PAIR', priority: 4 },
    { violationTypeId: otherStateType?.id, pattern: 'OTHER STATE', priority: 5 },
    { violationTypeId: otherStateType?.id, pattern: 'MALPE', priority: 5 },
    { violationTypeId: otherStateType?.id, pattern: 'GUJRAT', priority: 5 },
  ];

  for (const pattern of patterns) {
    if (pattern.violationTypeId) {
      await prisma.violationPattern.create({
        data: {
          violationTypeId: pattern.violationTypeId,
          pattern: pattern.pattern,
          priority: pattern.priority,
        },
      });
    }
  }

  // Seed Admin User
  console.log('Seeding admin user...');
  const adminPassword = await hashPassword('Admin@123');

  await prisma.user.upsert({
    where: { userId: 'admin' },
    update: {},
    create: {
      userId: 'admin',
      passwordHash: adminPassword,
      fullName: 'System Administrator',
      email: 'admin@drone.gov.in',
      role: 'admin',
      status: 'active',
      mustChangePassword: true,
    },
  });

  console.log('Database seed completed successfully!');
  console.log('\nDefault Admin Credentials:');
  console.log('  User ID: admin');
  console.log('  Password: Admin@123');
  console.log('\n(Please change the password after first login)');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
