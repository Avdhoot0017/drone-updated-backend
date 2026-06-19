# Drone Surveillance Dashboard - API Documentation

## Base URL
```
http://localhost:5000/api/v1
```

## Authentication
All protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

---

## Endpoints Summary

| Method | Endpoint | Auth | Admin | Description |
|--------|----------|------|-------|-------------|
| GET | `/health` | No | No | Health check |
| POST | `/auth/login` | No | No | User login |
| GET | `/auth/me` | Yes | No | Get current user profile |
| POST | `/auth/change-password` | Yes | No | Change password |
| POST | `/auth/users` | Yes | Yes | Create new user |
| GET | `/auth/users` | Yes | Yes | List all users |
| POST | `/auth/users/:id/reset-password` | Yes | Yes | Reset user password |
| PATCH | `/auth/users/:id/status` | Yes | Yes | Update user status |
| DELETE | `/auth/users/:id` | Yes | Yes | Delete user |
| GET | `/dashboard/stats` | Yes | No | Dashboard statistics |
| GET | `/dashboard/trends` | Yes | No | Trend data for charts |
| GET | `/dashboard/regions` | Yes | No | Stats by region |
| GET | `/dashboard/violations` | Yes | No | Stats by violation type |
| GET | `/dashboard/vessel-types` | Yes | No | Stats by vessel type |
| GET | `/dashboard/monthly` | Yes | No | Monthly comparison |
| GET | `/dashboard/top-offenders` | Yes | No | Top offending vessels |
| GET | `/dashboard/observations` | Yes | No | Observations list |
| GET | `/dashboard/heatmap` | Yes | No | Hourly distribution |
| GET | `/dashboard/sync-info` | Yes | No | Last sync info |
| GET | `/dashboard/filters` | Yes | No | Filter options |
| POST | `/sync/run` | Yes | Yes | Trigger manual sync |
| GET | `/sync/status` | Yes | No | Sync status & history |
| GET | `/sync/batch/:id` | Yes | No | Sync batch details |
| GET | `/sync/sheet-info` | Yes | No | Google Sheet info |
| GET | `/sync/config` | Yes | Yes | Sync configuration |

---

## Authentication APIs

### POST /auth/login
Login and get JWT token.

**Request:**
```json
{
  "userId": "admin",
  "password": "Admin@123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "userId": "admin",
      "fullName": "System Administrator",
      "role": "admin",
      "mustChangePassword": true
    },
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expiresAt": "2024-01-15T00:00:00.000Z"
  }
}
```

### GET /auth/me
Get current user profile.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "admin",
    "fullName": "System Administrator",
    "email": "admin@drone.gov.in",
    "role": "admin",
    "status": "active",
    "enforcementArea": null,
    "canViewAllAreas": true,
    "mustChangePassword": false,
    "lastLoginAt": "2024-01-08T10:00:00.000Z"
  }
}
```

### POST /auth/change-password
Change current user's password.

**Request:**
```json
{
  "currentPassword": "OldPassword@123",
  "newPassword": "NewPassword@456"
}
```

### POST /auth/users (Admin Only)
Create new user.

**Request:**
```json
{
  "userId": "member1",
  "fullName": "John Doe",
  "role": "member",
  "email": "john@example.com",
  "phone": "9876543210",
  "designation": "Field Officer",
  "enforcementAreaId": "uuid",
  "canViewAllAreas": false
}
```

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "userId": "member1",
    "password": "Auto@Gen123"
  }
}
```

---

## Dashboard APIs

### GET /dashboard/stats
Get summary statistics.

**Query Parameters:**
- `startDate` (optional): Filter start date
- `endDate` (optional): Filter end date
- `enforcementAreaId` (optional): Filter by region
- `status` (optional): Filter by status

**Response:**
```json
{
  "success": true,
  "data": {
    "totalObservations": 1126,
    "uniqueVessels": 543,
    "pendingActions": 234,
    "penaltyImposed": 2810000,
    "penaltyRecovered": 1315000,
    "recoveryRate": 47,
    "todayObservations": 5,
    "thisMonthObservations": 156
  }
}
```

### GET /dashboard/trends
Get daily trend data for charts.

**Query Parameters:**
- `days` (optional): Number of days (default: 30, max: 365)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "date": "2024-01-01",
      "observations": 15,
      "vessels": 12,
      "penaltyImposed": 200000,
      "penaltyRecovered": 100000
    }
  ]
}
```

### GET /dashboard/regions
Get statistics by enforcement area.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "RATNAGIRI",
      "totalObservations": 555,
      "uniqueVessels": 234,
      "penaltyImposed": 1200000,
      "penaltyRecovered": 600000,
      "pendingCases": 89
    }
  ]
}
```

### GET /dashboard/violations
Get statistics by violation type.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "TRAWLING",
      "name": "Trawling",
      "count": 629,
      "percentage": 56,
      "severityLevel": 2
    }
  ]
}
```

### GET /dashboard/vessel-types
Get statistics by vessel type.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "TRAWLER",
      "count": 696,
      "percentage": 62
    }
  ]
}
```

### GET /dashboard/monthly
Get monthly comparison data.

**Query Parameters:**
- `months` (optional): Number of months (default: 6)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "year": 2024,
      "month": 1,
      "monthName": "Jan",
      "observations": 397,
      "vessels": 234,
      "penalty": 800000
    }
  ]
}
```

### GET /dashboard/top-offenders
Get top offending vessels.

**Query Parameters:**
- `limit` (optional): Number of results (default: 10, max: 50)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "VESSEL NAME",
      "registrationNumber": "IND-MH-4-MM-1234",
      "vesselType": "TRAWLER",
      "state": "Maharashtra",
      "totalViolations": 5,
      "isFlagged": true,
      "riskCategory": "high",
      "totalPenalty": 500000,
      "lastObservedAt": "2024-01-08T10:00:00.000Z"
    }
  ]
}
```

### GET /dashboard/observations
Get paginated observations list.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20, max: 100)
- `startDate`, `endDate`, `enforcementAreaId`, `status`, `search`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "date": "2024-01-08",
      "time": "12:30:00",
      "enforcementArea": "RATNAGIRI",
      "flyingLocation": "HARNAI",
      "vesselName": "VESSEL NAME",
      "vesselRegNo": "IND-MH-4-MM-1234",
      "vesselType": "TRAWLER",
      "violationType": "Trawling",
      "status": "reported",
      "latitude": 17.77,
      "longitude": 73.05,
      "distanceFromCoast": 6.1,
      "penaltyImposed": 100000,
      "penaltyRecovered": 0,
      "evidenceUrl": "https://..."
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1126,
    "totalPages": 57
  }
}
```

### GET /dashboard/heatmap
Get hourly distribution matrix for heatmap.

**Response:**
```json
{
  "success": true,
  "data": [
    [0, 0, 0, 0, 0, 0, 5, 10, 15, 20, ...], // Monday (24 hours)
    [0, 0, 0, 0, 0, 0, 4, 12, 18, 22, ...], // Tuesday
    // ... 7 days x 24 hours
  ]
}
```

### GET /dashboard/sync-info
Get last sync information.

**Response:**
```json
{
  "success": true,
  "data": {
    "lastSyncAt": "2024-01-08T20:00:00.000Z",
    "lastModifiedTime": "2024-01-08T18:30:00.000Z",
    "lastBatch": {
      "id": "uuid",
      "completedAt": "2024-01-08T20:05:00.000Z",
      "newRecords": 15,
      "duplicates": 1100,
      "errors": 0
    }
  }
}
```

### GET /dashboard/filters
Get available filter options.

**Response:**
```json
{
  "success": true,
  "data": {
    "enforcementAreas": [
      { "id": "uuid", "name": "RAIGAD" }
    ],
    "flyingLocations": [
      { "id": "uuid", "name": "HARNAI", "enforcementAreaId": "uuid" }
    ],
    "violationTypes": [
      { "id": "uuid", "code": "TRAWLING", "name": "Trawling" }
    ],
    "vesselTypes": [
      { "id": "uuid", "name": "TRAWLER" }
    ],
    "statuses": [
      { "value": "reported", "label": "Reported" }
    ]
  }
}
```

---

## Sync APIs

### POST /sync/run (Admin Only)
Manually trigger Google Sheets sync.

**Response:**
```json
{
  "success": true,
  "message": "Sync completed",
  "data": {
    "totalRows": 1126,
    "newRecords": 15,
    "duplicates": 1100,
    "errors": 11,
    "errorDetails": [
      { "row": 45, "error": "Missing required field", "field": "date" }
    ]
  }
}
```

### GET /sync/status
Get sync status and recent history.

**Response:**
```json
{
  "success": true,
  "data": {
    "lastSyncAt": "2024-01-08T20:00:00.000Z",
    "lastModifiedTime": "2024-01-08T18:30:00.000Z",
    "recentBatches": [
      {
        "id": "uuid",
        "startedAt": "2024-01-08T20:00:00.000Z",
        "completedAt": "2024-01-08T20:05:00.000Z",
        "status": "completed",
        "durationMs": 300000,
        "totalRowsScanned": 1126,
        "newRecordsAdded": 15,
        "duplicateRecords": 1100,
        "errorRecords": 11,
        "triggeredBy": "scheduled"
      }
    ]
  }
}
```

### GET /sync/sheet-info
Get Google Sheet metadata.

**Response:**
```json
{
  "success": true,
  "data": {
    "title": "Drone Surveillance Data",
    "lastModifiedTime": "2024-01-08T18:30:00.000Z",
    "sheetId": "abc123...",
    "tabs": ["Raigad", "Ratnagiri", "Sindhudurg", "Palghar", "Thane"],
    "config": {
      "lastSyncAt": "2024-01-08T20:00:00.000Z",
      "syncEnabled": true,
      "syncSchedule": "0 20 * * *"
    }
  }
}
```

---

## Error Responses

All error responses follow this format:
```json
{
  "success": false,
  "error": "Error message here"
}
```

### Common HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (admin access required)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

---

## Default Admin Credentials
```
User ID: admin
Password: Admin@123
```
*Change password after first login*
