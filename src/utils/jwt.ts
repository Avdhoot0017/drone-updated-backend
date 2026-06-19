import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { JwtPayload } from '../types';
import { UserRole } from '@prisma/client';

/**
 * Generate a JWT token
 */
export function generateToken(payload: {
  userId: string;
  id: string;
  role: UserRole;
  enforcementAreaId?: string | null;
}): string {
  // Filter out null/undefined values before signing
  const tokenPayload: Record<string, unknown> = {
    userId: payload.userId,
    id: payload.id,
    role: payload.role,
  };
  if (payload.enforcementAreaId) {
    tokenPayload.enforcementAreaId = payload.enforcementAreaId;
  }
  return jwt.sign(tokenPayload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as string,
  } as jwt.SignOptions);
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

/**
 * Decode a token without verifying (for debugging)
 */
export function decodeToken(token: string): JwtPayload | null {
  const decoded = jwt.decode(token);
  return decoded as JwtPayload | null;
}

/**
 * Get token expiration date
 */
export function getTokenExpiration(): Date {
  const expiresIn = env.jwtExpiresIn;
  const match = expiresIn.match(/^(\d+)([dhms])$/);

  if (!match) {
    // Default to 7 days
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  let milliseconds: number;

  switch (unit) {
    case 'd':
      milliseconds = value * 24 * 60 * 60 * 1000;
      break;
    case 'h':
      milliseconds = value * 60 * 60 * 1000;
      break;
    case 'm':
      milliseconds = value * 60 * 1000;
      break;
    case 's':
      milliseconds = value * 1000;
      break;
    default:
      milliseconds = 7 * 24 * 60 * 60 * 1000;
  }

  return new Date(Date.now() + milliseconds);
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(
  authHeader: string | undefined
): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}
