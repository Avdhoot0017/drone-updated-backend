import { Request } from 'express';
import { User, UserRole } from '@prisma/client';

// =============================================================================
// AUTH TYPES
// =============================================================================

export interface JwtPayload {
  userId: string;
  id: string;
  role: UserRole;
  enforcementAreaId?: string; // For ACF district filtering
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// =============================================================================
// GOOGLE SHEETS TYPES
// =============================================================================

export interface SheetRow {
  srNo: number | null;
  enforcementArea: string | null;
  flyingLocation: string | null;
  vesselName: string | null;
  vesselRegNo: string | null;
  vesselType: string | null;
  latitudeLongitude: string | null;
  date: Date | string | null;
  time: string | null;
  distanceFromCoast: string | null;
  violationOfAct: string | null;
  evidences: string | null;
  expectedPenalty: number | string | null; // Detected penalty from sheet
  actionTakenReport: string | null;
  fishAuctionAmount: number | string | null;
  penaltyImposed: number | string | null;
  penaltyRecovered: number | string | null;
  remarksAcf: string | null;
  remarksHo: string | null;
  finalVerdict: string | null;
}

export interface SheetMetadata {
  lastModifiedTime: string;
  title: string;
}

export interface SyncResult {
  totalRows: number;
  newRecords: number;
  updatedRecords: number;
  unchangedRecords: number;
  errors: number;
  errorDetails: Array<{
    row: number;
    error: string;
    field?: string;
  }>;
}

// =============================================================================
// DASHBOARD TYPES
// =============================================================================

export interface DashboardStats {
  totalObservations: number;
  uniqueVessels: number;
  pendingActions: number;
  detectedPenalty: number; // Total expected/detected penalty from observations
  penaltyImposed: number;
  penaltyRecovered: number;
  recoveryRate: number;
  todayObservations: number;
  thisMonthObservations: number;
}

export interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
  }>;
}

export interface TrendData {
  date: string;
  observations: number;
  vessels: number;
  penaltyImposed: number;
  penaltyRecovered: number;
}

export interface RegionStats {
  id: string;
  name: string;
  totalObservations: number;
  uniqueVessels: number;
  penaltyImposed: number;
  penaltyRecovered: number;
  pendingCases: number;
}

export interface ViolationStats {
  id: string;
  code: string;
  name: string;
  count: number;
  percentage: number;
  severityLevel: number;
}

export interface VesselTypeStats {
  id: string;
  name: string;
  count: number;
  percentage: number;
}

// =============================================================================
// USER MANAGEMENT TYPES
// =============================================================================

export interface CreateUserInput {
  userId: string;
  password: string;
  fullName: string;
  role: UserRole;
  email?: string;
  phone?: string;
  designation?: string;
  enforcementAreaId?: string;
  canViewAllAreas?: boolean;
  signaturePath?: string;
  // Certificate and private key data for ACF users
  certBuffer?: Buffer;
  certFilename?: string;
  privateKeyBuffer?: Buffer;
  privateKeyFilename?: string;
  privateKeyPassword?: string;
}

export interface UpdateUserInput {
  fullName?: string;
  email?: string;
  phone?: string;
  designation?: string;
  enforcementAreaId?: string;
  canViewAllAreas?: boolean;
  status?: 'active' | 'inactive' | 'suspended';
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface LoginInput {
  userId: string;
  password: string;
}

export interface LoginResponse {
  user: {
    id: string;
    userId: string;
    fullName: string;
    role: UserRole;
    email?: string;
    mustChangePassword: boolean;
  };
  token: string;
  expiresAt: Date;
}

// =============================================================================
// FILTER TYPES
// =============================================================================

export interface ObservationFilters {
  startDate?: Date;
  endDate?: Date;
  enforcementAreaId?: string;
  flyingLocationId?: string;
  vesselTypeId?: string;
  violationTypeId?: string;
  status?: string;
  vesselRegNo?: string;
  search?: string;
}

export interface VesselFilters {
  stateId?: string;
  vesselTypeId?: string;
  isFlagged?: boolean;
  riskCategory?: string;
  search?: string;
}
