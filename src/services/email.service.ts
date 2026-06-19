/**
 * Email Service
 * Sends emails using Brevo (formerly SendinBlue)
 * Handles case notification emails to ACF, RDC, Commissioner, and Joint Commissioner
 */

import { BrevoClient } from '@getbrevo/brevo';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/database';

// ============================================================
// INTERFACES
// ============================================================

interface EmailRecipient {
  email: string;
  name?: string;
  role: 'acf' | 'rdc' | 'commissioner' | 'joint_commissioner' | 'owner';
}

interface CaseEmailData {
  caseNumber: string;
  vesselName: string;
  registrationNumber: string;
  ownerName: string;
  violationType: string;
  districtName: string;
  observationDate: string;
  penaltyAmount: number;
  occurrence: number;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  recipient: string;
  role: string;
}

interface SendCaseEmailsResult {
  success: boolean;
  totalSent: number;
  totalFailed: number;
  results: SendEmailResult[];
}

// ============================================================
// EMAIL SERVICE CLASS
// ============================================================

class EmailService {
  private client: BrevoClient | null = null;
  private isConfigured: boolean;

  constructor() {
    this.isConfigured = Boolean(env.brevoApiKey && env.brevoApiKey !== 'your_brevo_api_key');

    if (this.isConfigured) {
      this.client = new BrevoClient({
        apiKey: env.brevoApiKey,
      });
      logger.info('Brevo email service initialized');
    } else {
      logger.warn('Brevo API key not configured - emails will be logged only');
    }
  }

  /**
   * Send case notification emails to all required recipients
   */
  async sendCaseNotificationEmails(
    caseId: string,
    caseData: CaseEmailData,
    pdfBuffer: Buffer,
    pdfUrl?: string
  ): Promise<SendCaseEmailsResult> {
    const results: SendEmailResult[] = [];
    let totalSent = 0;
    let totalFailed = 0;

    // Get recipients
    const recipients = await this.getCaseRecipients(caseId, caseData.districtName);

    try {
      if (recipients.length === 0) {
        logger.warn(`No email recipients found for case ${caseData.caseNumber}`);
        return {
          success: false,
          totalSent: 0,
          totalFailed: 0,
          results: [],
        };
      }

      // Send email to each recipient
      for (const recipient of recipients) {
        const result = await this.sendCaseEmail(recipient, caseData, pdfBuffer, pdfUrl);
        results.push(result);

        if (result.success) {
          totalSent++;
        } else {
          totalFailed++;
        }

        // Small delay between emails to avoid rate limiting
        await this.delay(200);
      }

      // Log email activity
      await this.logEmailActivity(caseId, results);

      logger.info(`Case emails sent: ${totalSent} successful, ${totalFailed} failed for case ${caseData.caseNumber}`);

      return {
        success: totalFailed === 0,
        totalSent,
        totalFailed,
        results,
      };
    } catch (error) {
      logger.error('Error sending case notification emails:', error);
      return {
        success: false,
        totalSent,
        totalFailed: recipients.length - totalSent,
        results,
      };
    }
  }

  /**
   * Get all recipients for a case
   */
  private async getCaseRecipients(caseId: string, _districtName: string): Promise<EmailRecipient[]> {
    const recipients: EmailRecipient[] = [];

    try {
      // Get case to find ACF user and owner email
      const observation = await prisma.observation.findUnique({
        where: { id: caseId },
        select: {
          createdByUserId: true,
          disposedBy: true,
          enforcementAreaId: true,
          ownerEmail: true,
          ownerName: true,
        },
      });

      if (!observation) {
        return recipients;
      }

      // 1. Get ACF users for the district
      // First try the disposer/creator, then find any ACF assigned to the district
      const acfUserId = observation.disposedBy || observation.createdByUserId;
      const addedAcfEmails = new Set<string>();

      // Add the case disposer/creator if they're an ACF
      if (acfUserId) {
        const acfUser = await prisma.user.findUnique({
          where: { id: acfUserId },
          select: { email: true, fullName: true, role: true },
        });
        if (acfUser?.email && acfUser.role === 'acf') {
          recipients.push({
            email: acfUser.email,
            name: acfUser.fullName,
            role: 'acf',
          });
          addedAcfEmails.add(acfUser.email);
        }
      }

      // Also find ACF users assigned to this district (enforcementArea)
      if (observation.enforcementAreaId) {
        const districtAcfUsers = await prisma.user.findMany({
          where: {
            role: 'acf',
            enforcementAreaId: observation.enforcementAreaId,
            status: 'active',
            email: { not: null },
          },
          select: { email: true, fullName: true },
        });

        for (const acf of districtAcfUsers) {
          if (acf.email && !addedAcfEmails.has(acf.email)) {
            recipients.push({
              email: acf.email,
              name: acf.fullName,
              role: 'acf',
            });
            addedAcfEmails.add(acf.email);
          }
        }
      }

      // 2. Get RDC users (users with commissioner role in the system)
      const rdcUsers = await prisma.user.findMany({
        where: {
          role: 'commissioner',
          status: 'active',
          email: { not: null },
        },
        select: { email: true, fullName: true },
      });

      for (const rdc of rdcUsers) {
        if (rdc.email) {
          recipients.push({
            email: rdc.email,
            name: rdc.fullName,
            role: 'rdc',
          });
        }
      }

      // 3. Add Commissioner from env
      if (env.commissionerEmail) {
        recipients.push({
          email: env.commissionerEmail,
          name: 'Commissioner',
          role: 'commissioner',
        });
      }

      // 4. Add Joint Commissioner from env
      if (env.jointCommissionerEmail) {
        recipients.push({
          email: env.jointCommissionerEmail,
          name: 'Joint Commissioner',
          role: 'joint_commissioner',
        });
      }

      // 5. Add Vessel Owner if email provided
      if (observation.ownerEmail) {
        recipients.push({
          email: observation.ownerEmail,
          name: observation.ownerName || 'Vessel Owner',
          role: 'owner',
        });
        logger.info(`Adding owner email ${observation.ownerEmail} to recipients for case ${caseId}`);
      }

    } catch (error) {
      logger.error('Error getting case recipients:', error);
    }

    return recipients;
  }

  /**
   * Send individual case email
   */
  private async sendCaseEmail(
    recipient: EmailRecipient,
    caseData: CaseEmailData,
    pdfBuffer: Buffer,
    pdfUrl?: string
  ): Promise<SendEmailResult> {
    const subject = `Case Notice: ${caseData.caseNumber} - ${caseData.vesselName}`;
    const htmlContent = this.generateCaseEmailHtml(caseData, recipient.role, pdfUrl);

    if (!this.isConfigured || !this.client) {
      // Log only mode
      logger.info(`[EMAIL LOG] Would send to ${recipient.email} (${recipient.role}): ${subject}`);
      return {
        success: true,
        messageId: 'log-only-' + Date.now(),
        recipient: recipient.email,
        role: recipient.role,
      };
    }

    try {
      const response = await this.client.transactionalEmails.sendTransacEmail({
        subject,
        htmlContent,
        sender: {
          name: env.brevoSenderName,
          email: env.brevoSenderEmail,
        },
        to: [
          {
            email: recipient.email,
            name: recipient.name || recipient.email,
          },
        ],
        attachment: [
          {
            content: pdfBuffer.toString('base64'),
            name: `Case-${caseData.caseNumber.replace(/\//g, '-')}.pdf`,
          },
        ],
      });

      const messageId = (response as { messageId?: string }).messageId || `sent-${Date.now()}`;
      logger.info(`Email sent to ${recipient.email} (${recipient.role}): ${messageId}`);

      return {
        success: true,
        messageId,
        recipient: recipient.email,
        role: recipient.role,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to send email to ${recipient.email}:`, error);

      return {
        success: false,
        error: errorMessage,
        recipient: recipient.email,
        role: recipient.role,
      };
    }
  }

  /**
   * Generate HTML content for case email
   */
  private generateCaseEmailHtml(
    caseData: CaseEmailData,
    recipientRole: string,
    pdfUrl?: string
  ): string {
    const roleLabels: Record<string, string> = {
      acf: 'Assistant Commissioner of Fisheries',
      rdc: 'Regional Deputy Commissioner',
      commissioner: 'Commissioner',
      joint_commissioner: 'Joint Commissioner',
      owner: 'Vessel Owner',
    };

    const roleLabel = roleLabels[recipientRole] || 'Recipient';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 10px 0 0; opacity: 0.9; }
    .content { padding: 30px; }
    .greeting { font-size: 16px; margin-bottom: 20px; }
    .case-info { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .case-info h3 { margin: 0 0 15px; color: #1e40af; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #64748b; font-size: 14px; }
    .info-value { font-weight: 600; color: #1e293b; }
    .penalty-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 15px; margin: 20px 0; text-align: center; }
    .penalty-amount { font-size: 28px; font-weight: bold; color: #dc2626; }
    .penalty-label { color: #991b1b; font-size: 14px; }
    .action-button { display: inline-block; background: #1e40af; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; margin: 20px 0; }
    .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; }
    .attachment-note { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 15px; margin: 20px 0; }
    .attachment-note strong { color: #059669; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Maharashtra Fisheries Department</h1>
      <p>Drone Surveillance - Case Notification</p>
    </div>

    <div class="content">
      <p class="greeting">Dear ${roleLabel},</p>

      <p>A violation case has been registered through the Drone Surveillance System. Please find the details below:</p>

      <div class="case-info">
        <h3>📋 Case Details</h3>
        <div class="info-row">
          <span class="info-label">Case Number</span>
          <span class="info-value">${caseData.caseNumber}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Vessel Name</span>
          <span class="info-value">${caseData.vesselName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Registration No.</span>
          <span class="info-value">${caseData.registrationNumber}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Owner Name</span>
          <span class="info-value">${caseData.ownerName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Violation Type</span>
          <span class="info-value">${caseData.violationType}</span>
        </div>
        <div class="info-row">
          <span class="info-label">District</span>
          <span class="info-value">${caseData.districtName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Observation Date</span>
          <span class="info-value">${caseData.observationDate}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Offence Occurrence</span>
          <span class="info-value">${caseData.occurrence}${caseData.occurrence === 1 ? 'st' : caseData.occurrence === 2 ? 'nd' : caseData.occurrence === 3 ? 'rd' : 'th'} Offence</span>
        </div>
      </div>

      <div class="penalty-box">
        <div class="penalty-label">Proposed Penalty Amount</div>
        <div class="penalty-amount">₹ ${caseData.penaltyAmount.toLocaleString('en-IN')}</div>
      </div>

      <div class="attachment-note">
        <strong>📎 Attachment:</strong> The complete case document with evidence images is attached to this email as a PDF.
      </div>

      ${pdfUrl ? `
      <p style="text-align: center;">
        <a href="${pdfUrl}" class="action-button">View Case Document</a>
      </p>
      ` : ''}

      <p>Please review the attached document and take necessary action as per the Maharashtra Marine Fishing Regulation Act, 2021.</p>

      <p>Regards,<br><strong>Drone Surveillance System</strong><br>Maharashtra Fisheries Department</p>
    </div>

    <div class="footer">
      <p>This is an automated notification from the Drone Surveillance Dashboard.</p>
      <p>© ${new Date().getFullYear()} Maharashtra Fisheries Department. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Log email activity to database
   */
  private async logEmailActivity(caseId: string, results: SendEmailResult[]): Promise<void> {
    try {
      // Create email log entries
      for (const result of results) {
        await prisma.caseEmailLog.create({
          data: {
            observationId: caseId,
            recipientEmail: result.recipient,
            recipientRole: result.role,
            status: result.success ? 'sent' : 'failed',
            messageId: result.messageId,
            errorMessage: result.error,
            sentAt: new Date(),
          },
        });
      }
    } catch (error) {
      logger.error('Error logging email activity:', error);
    }
  }

  /**
   * Utility: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Send a simple email (for testing)
   */
  async sendTestEmail(to: string, subject: string, body: string): Promise<SendEmailResult> {
    if (!this.isConfigured || !this.client) {
      logger.info(`[EMAIL LOG] Test email to ${to}: ${subject}`);
      return { success: true, messageId: 'test-' + Date.now(), recipient: to, role: 'test' };
    }

    try {
      const response = await this.client.transactionalEmails.sendTransacEmail({
        subject,
        htmlContent: `<html><body>${body}</body></html>`,
        sender: {
          name: env.brevoSenderName,
          email: env.brevoSenderEmail,
        },
        to: [{ email: to }],
      });

      const messageId = (response as { messageId?: string }).messageId || `sent-${Date.now()}`;

      return {
        success: true,
        messageId,
        recipient: to,
        role: 'test',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        recipient: to,
        role: 'test',
      };
    }
  }
}

export const emailService = new EmailService();
