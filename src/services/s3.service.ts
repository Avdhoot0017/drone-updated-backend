/**
 * S3 Service - AWS S3 file upload and management
 * Handles image uploads, presigned URLs, and file management
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';

// S3 Configuration
const s3Config = {
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
};

const BUCKET_NAME = process.env.AWS_S3_BUCKET || 'dof-schnell-drone-tech-dashboard';

// Initialize S3 client
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client(s3Config);
  }
  return s3Client;
}

// Check if S3 is configured
function isS3Configured(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_ACCESS_KEY_ID !== 'your_aws_access_key'
  );
}

interface UploadResult {
  success: boolean;
  key?: string;
  url?: string;
  error?: string;
}

interface PresignedUrlResult {
  success: boolean;
  uploadUrl?: string;
  key?: string;
  error?: string;
}

class S3Service {
  /**
   * Upload a file to S3
   */
  async uploadFile(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    folder: string = 'evidence'
  ): Promise<UploadResult> {
    // If S3 is not configured, return a mock response
    if (!isS3Configured()) {
      logger.warn('S3 not configured, using mock upload');
      const mockKey = `${folder}/${uuidv4()}-${fileName}`;
      return {
        success: true,
        key: mockKey,
        url: `https://${BUCKET_NAME}.s3.${s3Config.region}.amazonaws.com/${mockKey}`,
      };
    }

    try {
      const client = getS3Client();
      const key = `${folder}/${uuidv4()}-${fileName}`;

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      });

      await client.send(command);

      const url = `https://${BUCKET_NAME}.s3.${s3Config.region}.amazonaws.com/${key}`;

      logger.info(`File uploaded to S3: ${key}`);

      return {
        success: true,
        key,
        url,
      };
    } catch (error) {
      logger.error('S3 upload error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }

  /**
   * Upload evidence image for a case
   */
  async uploadEvidence(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    caseId: string
  ): Promise<UploadResult> {
    return this.uploadFile(buffer, fileName, mimeType, `evidence/${caseId}`);
  }

  /**
   * Upload generated notice document
   */
  async uploadNotice(
    buffer: Buffer,
    fileName: string,
    caseId: string
  ): Promise<UploadResult> {
    return this.uploadFile(buffer, fileName, 'application/pdf', `notices/${caseId}`);
  }

  /**
   * Get a presigned URL for uploading
   */
  async getPresignedUploadUrl(
    fileName: string,
    mimeType: string,
    folder: string = 'evidence',
    expiresIn: number = 3600
  ): Promise<PresignedUrlResult> {
    if (!isS3Configured()) {
      logger.warn('S3 not configured, returning mock presigned URL');
      const mockKey = `${folder}/${uuidv4()}-${fileName}`;
      return {
        success: true,
        uploadUrl: `https://${BUCKET_NAME}.s3.${s3Config.region}.amazonaws.com/${mockKey}?mock=true`,
        key: mockKey,
      };
    }

    try {
      const client = getS3Client();
      const key = `${folder}/${uuidv4()}-${fileName}`;

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: mimeType,
      });

      const uploadUrl = await getSignedUrl(client, command, { expiresIn });

      return {
        success: true,
        uploadUrl,
        key,
      };
    } catch (error) {
      logger.error('Error generating presigned URL:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate URL',
      };
    }
  }

  /**
   * Get a presigned URL for downloading/viewing
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600
  ): Promise<string | null> {
    if (!isS3Configured()) {
      return `https://${BUCKET_NAME}.s3.${s3Config.region}.amazonaws.com/${key}?mock=true`;
    }

    try {
      const client = getS3Client();
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      return await getSignedUrl(client, command, { expiresIn });
    } catch (error) {
      logger.error('Error generating download URL:', error);
      return null;
    }
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(key: string): Promise<boolean> {
    if (!isS3Configured()) {
      logger.warn('S3 not configured, mock delete');
      return true;
    }

    try {
      const client = getS3Client();
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await client.send(command);
      logger.info(`File deleted from S3: ${key}`);
      return true;
    } catch (error) {
      logger.error('S3 delete error:', error);
      return false;
    }
  }

  /**
   * Check if a file exists in S3
   */
  async fileExists(key: string): Promise<boolean> {
    if (!isS3Configured()) {
      return false;
    }

    try {
      const client = getS3Client();
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get any file from S3 as a Buffer
   */
  async getFileBuffer(key: string): Promise<Buffer | null> {
    if (!isS3Configured()) {
      logger.warn('S3 not configured, returning null for file buffer');
      return null;
    }

    try {
      const client = getS3Client();
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      const response = await client.send(command);

      if (response.Body) {
        const chunks: Uint8Array[] = [];
        const stream = response.Body as AsyncIterable<Uint8Array>;
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      }

      return null;
    } catch (error) {
      logger.error('Error fetching file buffer from S3:', error);
      return null;
    }
  }

  /**
   * Get digital signature image from S3
   */
  async getDigitalSignature(signatureKey: string): Promise<Buffer | null> {
    if (!isS3Configured()) {
      logger.warn('S3 not configured, returning null for signature');
      return null;
    }

    try {
      const client = getS3Client();
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: signatureKey,
      });

      const response = await client.send(command);

      if (response.Body) {
        const chunks: Uint8Array[] = [];
        const stream = response.Body as AsyncIterable<Uint8Array>;
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      }

      return null;
    } catch (error) {
      logger.error('Error fetching digital signature:', error);
      return null;
    }
  }
}

export const s3Service = new S3Service();
