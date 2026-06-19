# Drone Dashboard Backend - Setup Guide

Complete step-by-step guide to set up and run the backend server.

---

## Prerequisites

Before you begin, ensure you have the following installed:

| Software | Version | Check Command |
|----------|---------|---------------|
| Node.js | v18+ | `node --version` |
| npm | v9+ | `npm --version` |
| PostgreSQL | v14+ | `psql --version` |

---

## Step 1: Clone & Navigate

```bash
# Navigate to the backend directory
cd /path/to/droneDashboard/backend
```

---

## Step 2: Install Dependencies

```bash
npm install
```

This will install all required packages:
- `express` - Web framework
- `prisma` / `@prisma/client` - Database ORM
- `jsonwebtoken` - JWT authentication
- `bcryptjs` - Password hashing
- `googleapis` - Google Sheets API
- `node-cron` - Scheduled sync jobs
- `winston` - Logging
- `helmet` - Security headers
- `cors` - Cross-origin requests
- `express-validator` - Input validation
- `express-rate-limit` - Rate limiting

---

## Step 3: Environment Configuration

### 3.1 Copy the environment template

```bash
cp .env.example .env
```

### 3.2 Edit `.env` file

Open `.env` and configure the following:

```env
# =============================================================================
# APPLICATION
# =============================================================================
NODE_ENV=development
PORT=5000
API_PREFIX=/api/v1

# =============================================================================
# TIMEZONE & SYNC SCHEDULE
# =============================================================================
TZ=Asia/Kolkata
SYNC_CRON_SCHEDULE=0 20 * * *    # Daily at 8 PM IST
SYNC_ENABLED=true

# =============================================================================
# DATABASE (PostgreSQL)
# =============================================================================
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/drone_dashboard?schema=public

# =============================================================================
# JWT AUTHENTICATION
# =============================================================================
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# =============================================================================
# GOOGLE SHEETS API
# =============================================================================
GOOGLE_SERVICE_ACCOUNT_PATH=./config/service-account.json
GOOGLE_SHEET_ID=your-google-sheet-id
GOOGLE_SHEET_TABS=Raigad,Ratnagiri,Sindhudurg,Palghar,Thane

# =============================================================================
# CORS
# =============================================================================
CORS_ORIGIN=http://localhost:3000

# =============================================================================
# LOGGING
# =============================================================================
LOG_LEVEL=debug
LOG_FILE_PATH=./logs

# =============================================================================
# RATE LIMITING
# =============================================================================
RATE_LIMIT_WINDOW_MS=900000      # 15 minutes
RATE_LIMIT_MAX_REQUESTS=1000

# =============================================================================
# SECURITY
# =============================================================================
BCRYPT_SALT_ROUNDS=12
```

### 3.3 Important Configuration Notes

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Secret key for signing tokens | Use a strong random string |
| `GOOGLE_SHEET_ID` | ID from Google Sheet URL | `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms` |
| `SYNC_CRON_SCHEDULE` | Cron expression for sync | `0 20 * * *` = Daily 8 PM |

---

## Step 4: Database Setup

### 4.1 Start PostgreSQL

**macOS (Homebrew):**
```bash
brew services start postgresql
```

**Ubuntu/Debian:**
```bash
sudo systemctl start postgresql
```

**Windows:**
```bash
# Start from Services or
pg_ctl start -D "C:\Program Files\PostgreSQL\14\data"
```

### 4.2 Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE drone_dashboard;

# Exit
\q
```

Or using command line:
```bash
psql -U postgres -c "CREATE DATABASE drone_dashboard;"
```

### 4.3 Generate Prisma Client

```bash
npm run db:generate
```

### 4.4 Push Schema to Database

```bash
npm run db:push
```

This creates all tables based on `prisma/schema.prisma`.

### 4.5 Seed Initial Data

```bash
npm run db:seed
```

This creates:
- Default admin user
- States (Maharashtra, etc.)
- Enforcement areas (Raigad, Ratnagiri, Sindhudurg, Palghar, Thane)
- Flying locations
- Vessel types
- Violation types

**Default Admin Credentials:**
```
User ID:  admin
Password: Admin@123
```
> ⚠️ Change the password after first login!

---

## Step 5: Google Sheets Setup (Optional)

Skip this step if you don't need Google Sheets sync yet.

### 5.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Google Sheets API** and **Google Drive API**

### 5.2 Create Service Account

1. Go to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Give it a name (e.g., `drone-dashboard-sync`)
4. Click **Create and Continue**
5. Skip optional permissions
6. Click **Done**

### 5.3 Generate Key

1. Click on the service account you created
2. Go to **Keys** tab
3. Click **Add Key** → **Create new key**
4. Select **JSON**
5. Download the file

### 5.4 Save Key File

```bash
# Create config directory
mkdir -p config

# Move the downloaded JSON file
mv ~/Downloads/your-service-account-file.json ./config/service-account.json
```

### 5.5 Share Google Sheet

1. Open your Google Sheet
2. Click **Share**
3. Add the service account email (found in the JSON file as `client_email`)
4. Give **Viewer** access

### 5.6 Get Sheet ID

From your Google Sheet URL:
```
https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
                                      ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑
                                      This is your GOOGLE_SHEET_ID
```

Update `.env`:
```env
GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
```

---

## Step 6: Start the Server

### Development Mode (with hot reload)

```bash
npm run dev
```

### Production Mode

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

### Expected Output

```
========================================
  Drone Surveillance Dashboard API
========================================
  Environment: development
  Port: 5000
  API Prefix: /api/v1
  Timezone: Asia/Kolkata
  Sync Schedule: 0 20 * * *
  Sync Enabled: true
========================================
```

---

## Step 7: Verify Installation

### 7.1 Health Check

```bash
curl http://localhost:5000/api/v1/health
```

Expected response:
```json
{
  "success": true,
  "message": "API is running",
  "timestamp": "2024-01-08T10:00:00.000Z"
}
```

### 7.2 Test Login

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId":"admin","password":"Admin@123"}'
```

Expected response:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...",
      "userId": "admin",
      "fullName": "System Administrator",
      "role": "admin"
    },
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expiresAt": "2024-01-15T10:00:00.000Z"
  }
}
```

### 7.3 Run Full API Test Suite

```bash
./scripts/test-apis.sh
```

---

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Start development server with hot reload |
| `build` | `npm run build` | Compile TypeScript to JavaScript |
| `start` | `npm start` | Start production server |
| `db:generate` | `npm run db:generate` | Generate Prisma client |
| `db:push` | `npm run db:push` | Push schema to database |
| `db:seed` | `npm run db:seed` | Seed initial data |
| `sync:manual` | `npm run sync:manual` | Manually trigger Google Sheets sync |

---

## Project Structure

```
backend/
├── config/
│   └── service-account.json    # Google service account (gitignored)
├── logs/                       # Application logs (gitignored)
├── prisma/
│   └── schema.prisma           # Database schema
├── scripts/
│   └── test-apis.sh            # API test script
├── src/
│   ├── config/
│   │   ├── database.ts         # Prisma client setup
│   │   ├── env.ts              # Environment variables
│   │   └── logger.ts           # Winston logger
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── dashboard.controller.ts
│   │   └── sync.controller.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts  # JWT authentication
│   │   └── error.middleware.ts # Error handling
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── dashboard.routes.ts
│   │   ├── sync.routes.ts
│   │   └── index.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── dashboard.service.ts
│   │   ├── googleSheets.service.ts
│   │   └── sync.service.ts
│   ├── utils/
│   │   ├── jwt.ts              # JWT utilities
│   │   └── password.ts         # Password hashing
│   ├── types/
│   │   └── index.ts            # TypeScript interfaces
│   ├── jobs/
│   │   ├── syncScheduler.ts    # Cron job setup
│   │   └── runSync.ts          # Manual sync script
│   ├── prisma/
│   │   └── seed.ts             # Database seeder
│   └── index.ts                # Application entry point
├── .env                        # Environment variables (gitignored)
├── .env.example                # Environment template
├── .gitignore
├── package.json
├── tsconfig.json
├── API_DOCUMENTATION.md
└── SETUP.md                    # This file
```

---

## Troubleshooting

### Database Connection Failed

```
Error: Can't reach database server at `localhost:5432`
```

**Solution:**
1. Check if PostgreSQL is running: `pg_isready`
2. Verify DATABASE_URL in `.env`
3. Ensure database exists: `psql -U postgres -l`

### Port Already in Use

```
Error: listen EADDRINUSE: address already in use :::5000
```

**Solution:**
```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>
```

### Prisma Client Not Generated

```
Error: @prisma/client did not initialize yet
```

**Solution:**
```bash
npm run db:generate
```

### Google Sheets Sync Failed

```
Error: The caller does not have permission
```

**Solution:**
1. Ensure service account email is added to Google Sheet with Viewer access
2. Verify `GOOGLE_SERVICE_ACCOUNT_PATH` points to correct JSON file
3. Check if Google Sheets API is enabled in GCP

---

## Security Checklist

Before deploying to production:

- [ ] Change `JWT_SECRET` to a strong random string
- [ ] Change default admin password
- [ ] Set `NODE_ENV=production`
- [ ] Configure proper `CORS_ORIGIN`
- [ ] Use HTTPS
- [ ] Set up firewall rules
- [ ] Enable rate limiting
- [ ] Review and update `BCRYPT_SALT_ROUNDS` (12 is recommended)

---

## Support

- **API Documentation:** See `API_DOCUMENTATION.md`
- **Test Report:** Run `./scripts/test-apis.sh` to generate `API_TEST_REPORT.md`

---

**Last Updated:** April 2026
