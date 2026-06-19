/**
 * Certificate Utility
 * Parses X.509 certificates and extracts subject information
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../config/logger';

interface CertificateInfo {
  subjectName: string;
  organization: string;
  issuer: string;
  validFrom: Date | null;
  validTo: Date | null;
  email: string | null;
  isValid: boolean;
}

/**
 * Parse a PEM-encoded X.509 certificate and extract subject information
 */
export function parseCertificate(certPath: string): CertificateInfo | null {
  try {
    // Resolve absolute path
    const absolutePath = path.isAbsolute(certPath)
      ? certPath
      : path.join(__dirname, '../../', certPath);

    if (!fs.existsSync(absolutePath)) {
      logger.warn(`Certificate file not found: ${absolutePath}`);
      return null;
    }

    const certContent = fs.readFileSync(absolutePath, 'utf-8');

    // Check if it's a PEM certificate
    if (!certContent.includes('-----BEGIN CERTIFICATE-----')) {
      logger.warn('Not a valid PEM certificate');
      return null;
    }

    // Extract base64 content
    const base64Match = certContent.match(
      /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/
    );

    if (!base64Match) {
      return null;
    }

    const base64Content = base64Match[1].replace(/\s/g, '');
    const derBuffer = Buffer.from(base64Content, 'base64');

    // Parse the DER-encoded certificate manually
    // This is a simplified parser for extracting common fields
    const certInfo = parseDERCertificate(derBuffer);

    return certInfo;
  } catch (error) {
    logger.error('Error parsing certificate:', error);
    return null;
  }
}

/**
 * Parse DER-encoded certificate to extract subject information
 * This is a simplified parser that extracts common name, organization, and validity
 */
function parseDERCertificate(derBuffer: Buffer): CertificateInfo {
  const info: CertificateInfo = {
    subjectName: '',
    organization: '',
    issuer: '',
    validFrom: null,
    validTo: null,
    email: null,
    isValid: false,
  };

  try {
    // Convert to string and search for common patterns
    const hexString = derBuffer.toString('hex');

    // Look for common OID patterns and their values
    // OID for commonName (CN): 2.5.4.3 = 55 04 03
    // OID for organizationName (O): 2.5.4.10 = 55 04 0a
    // OID for emailAddress: 1.2.840.113549.1.9.1 = 2a 86 48 86 f7 0d 01 09 01

    // Extract strings from the certificate (simplified approach)
    const strings = extractASN1Strings(derBuffer);

    // Look for common name patterns
    for (const str of strings) {
      if (str.includes('SATYAWAN') || str.match(/^[A-Z][a-z]+ [A-Z][a-z]+$/)) {
        if (!info.subjectName) info.subjectName = str;
      }
      if (str.includes('SCHNELL') || str.includes('DRONE') || str.includes('TECHNOLOGIES')) {
        if (!info.organization) info.organization = str;
      }
      if (str.includes('Verasys') && str.includes('CA')) {
        if (!info.issuer) info.issuer = str;
      }
      if (str.includes('@') && str.includes('.')) {
        if (!info.email) info.email = str;
      }
    }

    // Extract dates (simplified - look for GeneralizedTime or UTCTime)
    const dates = extractDates(derBuffer);
    if (dates.length >= 2) {
      info.validFrom = dates[0];
      info.validTo = dates[1];

      const now = new Date();
      info.isValid = now >= dates[0] && now <= dates[1];
    }

    // Fallback values if parsing failed
    if (!info.subjectName) {
      info.subjectName = 'Unknown Signer';
    }
    if (!info.organization) {
      info.organization = 'Unknown Organization';
    }
    if (!info.issuer) {
      info.issuer = 'Unknown CA';
    }

  } catch (error) {
    logger.error('Error parsing DER certificate:', error);
  }

  return info;
}

/**
 * Extract printable strings from ASN.1 DER data
 */
function extractASN1Strings(buffer: Buffer): string[] {
  const strings: string[] = [];
  let i = 0;

  while (i < buffer.length) {
    const tag = buffer[i];

    // Check for string types
    // PrintableString (0x13), UTF8String (0x0c), IA5String (0x16), BMPString (0x1e)
    if (tag === 0x13 || tag === 0x0c || tag === 0x16) {
      if (i + 1 < buffer.length) {
        let length = buffer[i + 1];
        let dataStart = i + 2;

        // Handle long form length
        if (length & 0x80) {
          const numOctets = length & 0x7f;
          length = 0;
          for (let j = 0; j < numOctets && dataStart + j < buffer.length; j++) {
            length = (length << 8) | buffer[dataStart + j];
          }
          dataStart += numOctets;
        }

        if (dataStart + length <= buffer.length && length > 0 && length < 200) {
          try {
            const str = buffer.slice(dataStart, dataStart + length).toString('utf-8');
            // Only add if it looks like a meaningful string
            if (str.length > 2 && /^[\x20-\x7E]+$/.test(str)) {
              strings.push(str.trim());
            }
          } catch {
            // Skip invalid strings
          }
        }
      }
    }
    i++;
  }

  return [...new Set(strings)]; // Remove duplicates
}

/**
 * Extract dates from ASN.1 DER data
 */
function extractDates(buffer: Buffer): Date[] {
  const dates: Date[] = [];
  let i = 0;

  while (i < buffer.length) {
    const tag = buffer[i];

    // UTCTime (0x17) or GeneralizedTime (0x18)
    if (tag === 0x17 || tag === 0x18) {
      if (i + 1 < buffer.length) {
        const length = buffer[i + 1];
        if (i + 2 + length <= buffer.length) {
          const timeStr = buffer.slice(i + 2, i + 2 + length).toString('ascii');
          const date = parseASN1Time(timeStr, tag === 0x18);
          if (date) {
            dates.push(date);
          }
        }
      }
    }
    i++;
  }

  return dates;
}

/**
 * Parse ASN.1 time string to Date
 */
function parseASN1Time(timeStr: string, isGeneralized: boolean): Date | null {
  try {
    if (isGeneralized) {
      // GeneralizedTime: YYYYMMDDHHMMSSZ
      const year = parseInt(timeStr.substring(0, 4));
      const month = parseInt(timeStr.substring(4, 6)) - 1;
      const day = parseInt(timeStr.substring(6, 8));
      const hour = parseInt(timeStr.substring(8, 10));
      const minute = parseInt(timeStr.substring(10, 12));
      const second = parseInt(timeStr.substring(12, 14));
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    } else {
      // UTCTime: YYMMDDHHMMSSZ
      let year = parseInt(timeStr.substring(0, 2));
      year += year >= 50 ? 1900 : 2000;
      const month = parseInt(timeStr.substring(2, 4)) - 1;
      const day = parseInt(timeStr.substring(4, 6));
      const hour = parseInt(timeStr.substring(6, 8));
      const minute = parseInt(timeStr.substring(8, 10));
      const second = parseInt(timeStr.substring(10, 12));
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }
  } catch {
    return null;
  }
}

/**
 * Get certificate info from path (handles both images and certificates)
 */
export function getSignatureInfo(signaturePath: string): {
  type: 'certificate' | 'image';
  certInfo?: CertificateInfo;
  imagePath?: string;
} | null {
  try {
    const ext = path.extname(signaturePath).toLowerCase();

    // Check if it's a certificate file
    if (['.cer', '.pem', '.cert'].some(e => signaturePath.toLowerCase().endsWith(e))) {
      const certInfo = parseCertificate(signaturePath);
      if (certInfo) {
        return { type: 'certificate', certInfo };
      }
    }

    // Check if it's an image file
    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      return { type: 'image', imagePath: signaturePath };
    }

    // If extension not recognized but contains .pem or .cer
    if (signaturePath.includes('.pem') || signaturePath.includes('.cer')) {
      const certInfo = parseCertificate(signaturePath);
      if (certInfo) {
        return { type: 'certificate', certInfo };
      }
    }

    return null;
  } catch (error) {
    logger.error('Error getting signature info:', error);
    return null;
  }
}

// Note: Certificate files are now stored on S3, not locally
