#!/bin/sh
set -e

echo "========================================"
echo "🚀 Starting Drone Dashboard Backend (PM2)"
echo "========================================"

# Wait for database to be ready
echo "⏳ Waiting for database..."
sleep 5

# Run Prisma migrations/push
echo "📦 Pushing database schema..."
npx prisma db push --skip-generate

# Check if database is already seeded
echo "🔍 Checking if database is seeded..."
ADMIN_EXISTS=$(node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.findUnique({ where: { userId: 'admin' } })
  .then(user => {
    console.log(user ? 'true' : 'false');
    prisma.\$disconnect();
  })
  .catch(() => {
    console.log('false');
    prisma.\$disconnect();
  });
" 2>/dev/null || echo "false")

if [ "$ADMIN_EXISTS" = "true" ]; then
  echo "✅ Database already seeded, skipping seed step"
else
  echo "🌱 Seeding master data..."
  node dist/prisma/seed-master.js || echo "⚠️ Master seed skipped"

  echo "👤 Seeding admin user..."
  node dist/prisma/seed-admin.js || echo "⚠️ Admin seed skipped"

  echo "✅ Database seeding completed"
fi

echo "========================================"
echo "🎯 Starting PM2..."
echo "========================================"

# Start PM2 with ecosystem config (no-daemon mode for Docker)
exec pm2-runtime ecosystem.config.js
