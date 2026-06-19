#!/bin/bash

# API Test Script for Drone Dashboard Backend
# This script tests all API endpoints and generates a report

BASE_URL="http://localhost:5000/api/v1"
REPORT_FILE="./API_TEST_REPORT.md"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TOTAL=0
PASSED=0
FAILED=0

# Start report
echo "# API Test Report" > $REPORT_FILE
echo "" >> $REPORT_FILE
echo "**Generated:** $(date)" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo "**Base URL:** $BASE_URL" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo "---" >> $REPORT_FILE
echo "" >> $REPORT_FILE

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local auth=$4
    local expected_status=$5
    local description=$6

    TOTAL=$((TOTAL + 1))

    # Build curl command
    if [ "$method" == "GET" ]; then
        if [ -n "$auth" ]; then
            response=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL$endpoint" -H "Authorization: Bearer $auth")
        else
            response=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL$endpoint")
        fi
    else
        if [ -n "$auth" ]; then
            response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint" -H "Content-Type: application/json" -H "Authorization: Bearer $auth" -d "$data")
        else
            response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint" -H "Content-Type: application/json" -d "$data")
        fi
    fi

    # Extract status code (last line)
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    # Check success field in response
    success=$(echo "$body" | jq -r '.success // empty' 2>/dev/null)

    if [ "$http_code" == "$expected_status" ]; then
        PASSED=$((PASSED + 1))
        status="✅ PASS"
        echo -e "${GREEN}✅ PASS${NC} - $method $endpoint ($http_code)"
    else
        FAILED=$((FAILED + 1))
        status="❌ FAIL"
        echo -e "${RED}❌ FAIL${NC} - $method $endpoint (Expected: $expected_status, Got: $http_code)"
    fi

    # Add to report
    echo "### $TOTAL. $description" >> $REPORT_FILE
    echo "" >> $REPORT_FILE
    echo "- **Endpoint:** \`$method $endpoint\`" >> $REPORT_FILE
    echo "- **Status:** $status (HTTP $http_code)" >> $REPORT_FILE
    echo "- **Response:**" >> $REPORT_FILE
    echo '```json' >> $REPORT_FILE
    echo "$body" | jq '.' 2>/dev/null || echo "$body" >> $REPORT_FILE
    echo '```' >> $REPORT_FILE
    echo "" >> $REPORT_FILE
}

echo ""
echo "=========================================="
echo "  Drone Dashboard API Test Suite"
echo "=========================================="
echo ""

# ============================================
# 1. Health Check
# ============================================
echo "--- Testing Health Check ---"
test_endpoint "GET" "/health" "" "" "200" "Health Check"

# ============================================
# 2. Authentication Tests
# ============================================
echo ""
echo "--- Testing Authentication ---"

# Login with valid credentials
test_endpoint "POST" "/auth/login" '{"userId":"admin","password":"Admin@123"}' "" "200" "Login - Valid Credentials"

# Get token for authenticated requests
TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d '{"userId":"admin","password":"Admin@123"}' | jq -r '.data.token')
echo "Token obtained: ${TOKEN:0:30}..."

# Login with invalid credentials
test_endpoint "POST" "/auth/login" '{"userId":"admin","password":"wrongpassword"}' "" "401" "Login - Invalid Credentials"

# Login with missing fields
test_endpoint "POST" "/auth/login" '{"userId":"admin"}' "" "400" "Login - Missing Password"

# Get current user profile
test_endpoint "GET" "/auth/me" "" "$TOKEN" "200" "Get Current User Profile"

# Access protected route without token
test_endpoint "GET" "/auth/me" "" "" "401" "Protected Route - No Token"

# Get all users (admin only)
test_endpoint "GET" "/auth/users" "" "$TOKEN" "200" "Get All Users (Admin)"

# Create new user
test_endpoint "POST" "/auth/users" '{"userId":"testuser1","fullName":"Test User","role":"member","email":"test@example.com"}' "$TOKEN" "201" "Create New User (Admin)"

# Try to create user with existing userId
test_endpoint "POST" "/auth/users" '{"userId":"admin","fullName":"Another Admin","role":"admin"}' "$TOKEN" "409" "Create User - Duplicate UserId"

# ============================================
# 3. Dashboard Tests
# ============================================
echo ""
echo "--- Testing Dashboard ---"

test_endpoint "GET" "/dashboard/stats" "" "$TOKEN" "200" "Dashboard Stats"

test_endpoint "GET" "/dashboard/trends?days=7" "" "$TOKEN" "200" "Dashboard Trends (7 days)"

test_endpoint "GET" "/dashboard/trends?days=30" "" "$TOKEN" "200" "Dashboard Trends (30 days)"

test_endpoint "GET" "/dashboard/regions" "" "$TOKEN" "200" "Dashboard Regions"

test_endpoint "GET" "/dashboard/violations" "" "$TOKEN" "200" "Dashboard Violations"

test_endpoint "GET" "/dashboard/vessel-types" "" "$TOKEN" "200" "Dashboard Vessel Types"

test_endpoint "GET" "/dashboard/monthly?months=6" "" "$TOKEN" "200" "Dashboard Monthly (6 months)"

test_endpoint "GET" "/dashboard/top-offenders?limit=10" "" "$TOKEN" "200" "Dashboard Top Offenders"

test_endpoint "GET" "/dashboard/observations?page=1&limit=10" "" "$TOKEN" "200" "Dashboard Observations (Paginated)"

test_endpoint "GET" "/dashboard/heatmap" "" "$TOKEN" "200" "Dashboard Heatmap"

test_endpoint "GET" "/dashboard/sync-info" "" "$TOKEN" "200" "Dashboard Sync Info"

test_endpoint "GET" "/dashboard/filters" "" "$TOKEN" "200" "Dashboard Filters"

# ============================================
# 4. Sync Tests
# ============================================
echo ""
echo "--- Testing Sync ---"

test_endpoint "GET" "/sync/status" "" "$TOKEN" "200" "Sync Status"

test_endpoint "GET" "/sync/config" "" "$TOKEN" "200" "Sync Config (Admin)"

# Note: /sync/run and /sync/sheet-info require Google Sheets setup
echo -e "${YELLOW}⚠️  Skipping /sync/run - Requires Google Sheets setup${NC}"
echo -e "${YELLOW}⚠️  Skipping /sync/sheet-info - Requires Google Sheets setup${NC}"

# ============================================
# 5. User Management Tests (Admin)
# ============================================
echo ""
echo "--- Testing User Management ---"

# Get the test user we created
TEST_USER_ID=$(curl -s "$BASE_URL/auth/users" -H "Authorization: Bearer $TOKEN" | jq -r '.data[] | select(.userId == "testuser1") | .id')

if [ -n "$TEST_USER_ID" ] && [ "$TEST_USER_ID" != "null" ]; then
    echo "Test user ID: $TEST_USER_ID"

    # Reset password
    test_endpoint "POST" "/auth/users/$TEST_USER_ID/reset-password" "" "$TOKEN" "200" "Reset User Password"

    # Update user status
    test_endpoint "PATCH" "/auth/users/$TEST_USER_ID/status" '{"status":"inactive"}' "$TOKEN" "200" "Update User Status"

    # Delete user
    test_endpoint "DELETE" "/auth/users/$TEST_USER_ID" "" "$TOKEN" "200" "Delete User"
else
    echo -e "${YELLOW}⚠️  Test user not found, skipping user management tests${NC}"
fi

# ============================================
# 6. Change Password Test
# ============================================
echo ""
echo "--- Testing Password Change ---"

# Note: This would actually change the password, so we'll test validation only
test_endpoint "POST" "/auth/change-password" '{"currentPassword":"wrongpassword","newPassword":"NewPassword123"}' "$TOKEN" "401" "Change Password - Wrong Current Password"

test_endpoint "POST" "/auth/change-password" '{"currentPassword":"Admin@123","newPassword":"short"}' "$TOKEN" "400" "Change Password - Password Too Short"

# ============================================
# Generate Summary
# ============================================
echo ""
echo "=========================================="
echo "  Test Summary"
echo "=========================================="
echo -e "Total Tests: $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

# Add summary to report
echo "---" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo "## Summary" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo "| Metric | Count |" >> $REPORT_FILE
echo "|--------|-------|" >> $REPORT_FILE
echo "| Total Tests | $TOTAL |" >> $REPORT_FILE
echo "| ✅ Passed | $PASSED |" >> $REPORT_FILE
echo "| ❌ Failed | $FAILED |" >> $REPORT_FILE
echo "| Success Rate | $(( PASSED * 100 / TOTAL ))% |" >> $REPORT_FILE
echo "" >> $REPORT_FILE

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    echo "**Result:** ✅ All tests passed!" >> $REPORT_FILE
else
    echo -e "${RED}Some tests failed. Check the report for details.${NC}"
    echo "**Result:** ❌ Some tests failed. Check details above." >> $REPORT_FILE
fi

echo ""
echo "Report generated: $REPORT_FILE"
