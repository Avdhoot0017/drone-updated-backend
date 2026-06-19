import crypto from 'crypto';

/**
 * Generate unique key for observation deduplication
 * Uses: flying_location + vessel_reg_no + date + time
 */
export function generateObservationUniqueKey(
  flyingLocation: string | null,
  vesselRegNo: string | null,
  date: Date | null,
  time: string | null = null
): string {
  const normalizedLocation = (flyingLocation || '').toLowerCase().trim();
  const normalizedReg = (vesselRegNo || '').toUpperCase().trim();
  const dateStr = date ? formatDateOnly(date) : '';
  const timeStr = (time || '').trim();

  const combined = `${normalizedLocation}|${normalizedReg}|${dateStr}|${timeStr}`;

  return crypto.createHash('md5').update(combined).digest('hex');
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDateOnly(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Parse various date formats from Excel/Sheets
 */
export function parseDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    // Excel serial date
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return date;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    // Try DD/MM/YYYY format
    const ddmmyyyy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      return new Date(
        parseInt(ddmmyyyy[3]),
        parseInt(ddmmyyyy[2]) - 1,
        parseInt(ddmmyyyy[1])
      );
    }
  }

  return null;
}

/**
 * Parse time from various formats
 */
export function parseTime(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    // Excel time as fraction of day
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  if (typeof value === 'string') {
    const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const date = new Date();
      date.setHours(
        parseInt(match[1]),
        parseInt(match[2]),
        match[3] ? parseInt(match[3]) : 0,
        0
      );
      return date;
    }
  }

  return null;
}

/**
 * Parse coordinates from various formats
 */
export function parseCoordinates(value: string | null): {
  latitude: number | null;
  longitude: number | null;
  format: 'decimal' | 'dms' | null;
} {
  if (!value) {
    return { latitude: null, longitude: null, format: null };
  }

  // Try decimal format: "18.03462, 72.98157"
  const decimalMatch = value.match(
    /(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/
  );
  if (decimalMatch) {
    const lat = parseFloat(decimalMatch[1]);
    const lon = parseFloat(decimalMatch[2]);

    // Validate ranges
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { latitude: lat, longitude: lon, format: 'decimal' };
    }
  }

  // Try DMS format: "17 46 31.92, 73 03 04.54"
  const dmsMatch = value.match(
    /(\d+)\s+(\d+)\s+([\d.]+)\s*,\s*(\d+)\s+(\d+)\s+([\d.]+)/
  );
  if (dmsMatch) {
    const lat =
      parseInt(dmsMatch[1]) +
      parseInt(dmsMatch[2]) / 60 +
      parseFloat(dmsMatch[3]) / 3600;
    const lon =
      parseInt(dmsMatch[4]) +
      parseInt(dmsMatch[5]) / 60 +
      parseFloat(dmsMatch[6]) / 3600;

    return { latitude: lat, longitude: lon, format: 'dms' };
  }

  return { latitude: null, longitude: null, format: null };
}

/**
 * Parse distance from coast (e.g., "2.21KM" -> 2.21)
 */
export function parseDistance(value: string | null): number | null {
  if (!value) return null;

  const match = value.match(/([\d.]+)\s*(?:KM|km|Km)?/);
  if (match) {
    return parseFloat(match[1]);
  }

  return null;
}

/**
 * Parse numeric value from mixed types
 */
export function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '-' || value === ' ') {
    return null;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/[,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }

  return null;
}

/**
 * Normalize text for matching (alias resolution)
 * Returns lowercase to match seed data conventions
 */
export function normalizeText(text: string | null): string {
  if (!text) return '';
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Parse vessel registration number
 */
export function parseVesselRegistration(regNo: string | null): {
  country: string | null;
  state: string | null;
  district: string | null;
  category: string | null;
  serial: string | null;
} {
  if (!regNo) {
    return {
      country: null,
      state: null,
      district: null,
      category: null,
      serial: null,
    };
  }

  // Format: IND-MH-4-MM-736
  const match = regNo.match(
    /^([A-Z]+)-([A-Z]{2})-(\d+)-([A-Z]+)-(\d+)$/i
  );

  if (match) {
    return {
      country: match[1].toUpperCase(),
      state: match[2].toUpperCase(),
      district: match[3],
      category: match[4].toUpperCase(),
      serial: match[5],
    };
  }

  return {
    country: null,
    state: null,
    district: null,
    category: null,
    serial: null,
  };
}

/**
 * Calculate fiscal year from date (April to March)
 */
export function getFiscalYear(date: Date): number {
  const month = date.getMonth(); // 0-11
  const year = date.getFullYear();

  // April (3) onwards is current fiscal year, else previous
  return month >= 3 ? year : year - 1;
}

/**
 * Sleep utility for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Paginate array
 */
export function paginate<T>(
  array: T[],
  page: number,
  limit: number
): { data: T[]; total: number; totalPages: number } {
  const total = array.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const data = array.slice(offset, offset + limit);

  return { data, total, totalPages };
}
