# API Test Report

**Generated:** Sun Apr 19 15:06:07 IST 2026

**Base URL:** http://localhost:5000/api/v1

---

### 1. Health Check

- **Endpoint:** `GET /health`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 2. Login - Valid Credentials

- **Endpoint:** `POST /auth/login`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 3. Login - Invalid Credentials

- **Endpoint:** `POST /auth/login`
- **Status:** ✅ PASS (HTTP 401)
- **Response:**
```json
```

### 4. Login - Missing Password

- **Endpoint:** `POST /auth/login`
- **Status:** ✅ PASS (HTTP 400)
- **Response:**
```json
```

### 5. Get Current User Profile

- **Endpoint:** `GET /auth/me`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 6. Protected Route - No Token

- **Endpoint:** `GET /auth/me`
- **Status:** ✅ PASS (HTTP 401)
- **Response:**
```json
```

### 7. Get All Users (Admin)

- **Endpoint:** `GET /auth/users`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 8. Create New User (Admin)

- **Endpoint:** `POST /auth/users`
- **Status:** ✅ PASS (HTTP 201)
- **Response:**
```json
```

### 9. Create User - Duplicate UserId

- **Endpoint:** `POST /auth/users`
- **Status:** ✅ PASS (HTTP 409)
- **Response:**
```json
```

### 10. Dashboard Stats

- **Endpoint:** `GET /dashboard/stats`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 11. Dashboard Trends (7 days)

- **Endpoint:** `GET /dashboard/trends?days=7`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 12. Dashboard Trends (30 days)

- **Endpoint:** `GET /dashboard/trends?days=30`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 13. Dashboard Regions

- **Endpoint:** `GET /dashboard/regions`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 14. Dashboard Violations

- **Endpoint:** `GET /dashboard/violations`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 15. Dashboard Vessel Types

- **Endpoint:** `GET /dashboard/vessel-types`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 16. Dashboard Monthly (6 months)

- **Endpoint:** `GET /dashboard/monthly?months=6`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 17. Dashboard Top Offenders

- **Endpoint:** `GET /dashboard/top-offenders?limit=10`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 18. Dashboard Observations (Paginated)

- **Endpoint:** `GET /dashboard/observations?page=1&limit=10`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 19. Dashboard Heatmap

- **Endpoint:** `GET /dashboard/heatmap`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 20. Dashboard Sync Info

- **Endpoint:** `GET /dashboard/sync-info`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 21. Dashboard Filters

- **Endpoint:** `GET /dashboard/filters`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 22. Sync Status

- **Endpoint:** `GET /sync/status`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 23. Sync Config (Admin)

- **Endpoint:** `GET /sync/config`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 24. Reset User Password

- **Endpoint:** `POST /auth/users/7f7c14c0-fefa-4a2e-9eae-6c0e6797e6f8/reset-password`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 25. Update User Status

- **Endpoint:** `PATCH /auth/users/7f7c14c0-fefa-4a2e-9eae-6c0e6797e6f8/status`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 26. Delete User

- **Endpoint:** `DELETE /auth/users/7f7c14c0-fefa-4a2e-9eae-6c0e6797e6f8`
- **Status:** ✅ PASS (HTTP 200)
- **Response:**
```json
```

### 27. Change Password - Wrong Current Password

- **Endpoint:** `POST /auth/change-password`
- **Status:** ✅ PASS (HTTP 401)
- **Response:**
```json
```

### 28. Change Password - Password Too Short

- **Endpoint:** `POST /auth/change-password`
- **Status:** ✅ PASS (HTTP 400)
- **Response:**
```json
```

---

## Summary

| Metric | Count |
|--------|-------|
| Total Tests | 28 |
| ✅ Passed | 28 |
| ❌ Failed | 0 |
| Success Rate | 100% |

**Result:** ✅ All tests passed!
