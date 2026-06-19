/**
 * Admin User Seed Script
 * Seeds only the admin user (idempotent via upsert)
 *
 * Run with: npm run db:seed:admin
 */

import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../utils/password';

const prisma = new PrismaClient();

async function seedAdmin() {
  console.log('👤 Seeding admin user...');

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

  console.log('✅ Admin user seeded successfully!');
  console.log('\nDefault Admin Credentials:');
  console.log('  User ID: admin');
  console.log('  Password: Admin@123');
  console.log('\n(Please change the password after first login)');
}

seedAdmin()
  .catch((e) => {
    console.error('❌ Admin seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
