/**
 * Notification Utilities
 * Email, SMS, WhatsApp, and Voice Call services
 * Currently mocked - replace with actual API calls when accounts are ready
 */

import { logger } from '../config/logger';

// ============================================================
// CONFIGURATION
// ============================================================

const config = {
  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
    senderEmail: process.env.BREVO_SENDER_EMAIL || 'noreply@fisheries.gov.in',
    senderName: process.env.BREVO_SENDER_NAME || 'Maharashtra Fisheries Department',
  },
  fast2sms: {
    apiKey: process.env.FAST2SMS_API_KEY || '',
    senderId: process.env.FAST2SMS_SENDER_ID || 'MHFISH',
    voiceApiKey: process.env.FAST2SMS_VOICE_API_KEY || '',
  },
  whatsapp: {
    apiKey: process.env.WHATSAPP_API_KEY || '',
    senderNumber: process.env.WHATSAPP_SENDER_NUMBER || '',
  },
};

// Check if services are configured
const isBrevoConfigured = () => config.brevo.apiKey && config.brevo.apiKey !== 'your_brevo_api_key';
const isFast2SMSConfigured = () => config.fast2sms.apiKey && config.fast2sms.apiKey !== 'your_fast2sms_api_key';
const isWhatsAppConfigured = () => config.whatsapp.apiKey && config.whatsapp.apiKey !== 'your_whatsapp_api_key';

// ============================================================
// INTERFACES
// ============================================================

interface EmailOptions {
  to: string | string[];
  subject: string;
  htmlContent: string;
  textContent?: string;
  attachments?: Array<{
    name: string;
    content: string; // Base64 encoded
    contentType: string;
  }>;
}

interface SMSOptions {
  to: string | string[];
  message: string;
}

interface WhatsAppOptions {
  to: string;
  message: string;
  mediaUrl?: string;
}

interface VoiceCallOptions {
  to: string;
  message: string; // Text to speech
}

interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  mocked?: boolean;
}

// ============================================================
// EMAIL SERVICE (Brevo/SendinBlue)
// ============================================================

export async function sendEmail(options: EmailOptions): Promise<NotificationResult> {
  const { to, subject, htmlContent, textContent, attachments } = options;

  logger.info(`Sending email to: ${Array.isArray(to) ? to.join(', ') : to}`);

  // If not configured, return mocked response
  if (!isBrevoConfigured()) {
    logger.warn('Brevo not configured, mocking email send');
    return {
      success: true,
      messageId: `mock-email-${Date.now()}`,
      mocked: true,
    };
  }

  try {
    // TODO: Replace with actual Brevo API call
    // const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    //   method: 'POST',
    //   headers: {
    //     'accept': 'application/json',
    //     'api-key': config.brevo.apiKey,
    //     'content-type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     sender: { email: config.brevo.senderEmail, name: config.brevo.senderName },
    //     to: Array.isArray(to) ? to.map(email => ({ email })) : [{ email: to }],
    //     subject,
    //     htmlContent,
    //     textContent,
    //     attachment: attachments,
    //   }),
    // });

    // Mocked response for now
    logger.info(`Email would be sent to: ${to}, Subject: ${subject}`);
    return {
      success: true,
      messageId: `brevo-${Date.now()}`,
      mocked: true,
    };
  } catch (error) {
    logger.error('Email send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Email send failed',
    };
  }
}

// ============================================================
// SMS SERVICE (Fast2SMS)
// ============================================================

export async function sendSMS(options: SMSOptions): Promise<NotificationResult> {
  const { to, message } = options;
  const recipients = Array.isArray(to) ? to : [to];

  // Clean phone numbers (remove +91 and spaces)
  const cleanNumbers = recipients.map(num =>
    num.replace(/\D/g, '').replace(/^91/, '').slice(-10)
  );

  logger.info(`Sending SMS to: ${cleanNumbers.join(', ')}`);

  // If not configured, return mocked response
  if (!isFast2SMSConfigured()) {
    logger.warn('Fast2SMS not configured, mocking SMS send');
    return {
      success: true,
      messageId: `mock-sms-${Date.now()}`,
      mocked: true,
    };
  }

  try {
    // TODO: Replace with actual Fast2SMS API call
    // const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    //   method: 'POST',
    //   headers: {
    //     'authorization': config.fast2sms.apiKey,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     route: 'dlt',
    //     sender_id: config.fast2sms.senderId,
    //     message,
    //     language: 'english',
    //     flash: 0,
    //     numbers: cleanNumbers.join(','),
    //   }),
    // });

    // Mocked response for now
    logger.info(`SMS would be sent to: ${cleanNumbers.join(', ')}, Message: ${message.substring(0, 50)}...`);
    return {
      success: true,
      messageId: `fast2sms-${Date.now()}`,
      mocked: true,
    };
  } catch (error) {
    logger.error('SMS send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SMS send failed',
    };
  }
}

// ============================================================
// WHATSAPP SERVICE
// ============================================================

export async function sendWhatsApp(options: WhatsAppOptions): Promise<NotificationResult> {
  const { to, message, mediaUrl } = options;

  // Clean phone number
  const cleanNumber = to.replace(/\D/g, '');

  logger.info(`Sending WhatsApp to: ${cleanNumber}`);

  // If not configured, return mocked response
  if (!isWhatsAppConfigured()) {
    logger.warn('WhatsApp not configured, mocking WhatsApp send');
    return {
      success: true,
      messageId: `mock-whatsapp-${Date.now()}`,
      mocked: true,
    };
  }

  try {
    // TODO: Replace with actual WhatsApp API call (Twilio, Fast2SMS, or similar)
    // const response = await fetch('https://api.whatsapp-provider.com/send', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${config.whatsapp.apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     from: config.whatsapp.senderNumber,
    //     to: cleanNumber,
    //     message,
    //     mediaUrl,
    //   }),
    // });

    // Mocked response for now
    logger.info(`WhatsApp would be sent to: ${cleanNumber}, Message: ${message.substring(0, 50)}...`);
    return {
      success: true,
      messageId: `whatsapp-${Date.now()}`,
      mocked: true,
    };
  } catch (error) {
    logger.error('WhatsApp send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'WhatsApp send failed',
    };
  }
}

// ============================================================
// VOICE CALL SERVICE (Fast2SMS)
// ============================================================

export async function makeVoiceCall(options: VoiceCallOptions): Promise<NotificationResult> {
  const { to, message } = options;

  // Clean phone number
  const cleanNumber = to.replace(/\D/g, '').replace(/^91/, '').slice(-10);

  logger.info(`Making voice call to: ${cleanNumber}`);

  // If not configured, return mocked response
  if (!config.fast2sms.voiceApiKey || config.fast2sms.voiceApiKey === 'your_fast2sms_voice_api_key') {
    logger.warn('Fast2SMS Voice not configured, mocking voice call');
    return {
      success: true,
      messageId: `mock-call-${Date.now()}`,
      mocked: true,
    };
  }

  try {
    // TODO: Replace with actual Fast2SMS Voice API call
    // const response = await fetch('https://www.fast2sms.com/dev/voice', {
    //   method: 'POST',
    //   headers: {
    //     'authorization': config.fast2sms.voiceApiKey,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     numbers: cleanNumber,
    //     message, // Text to speech
    //     language: 'english',
    //   }),
    // });

    // Mocked response for now
    logger.info(`Voice call would be made to: ${cleanNumber}, Message: ${message.substring(0, 50)}...`);
    return {
      success: true,
      messageId: `voice-${Date.now()}`,
      mocked: true,
    };
  } catch (error) {
    logger.error('Voice call error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Voice call failed',
    };
  }
}

// ============================================================
// BULK NOTIFICATION HELPER
// ============================================================

interface NotificationTarget {
  email?: string;
  phone?: string;
  whatsapp?: string;
}

interface BulkNotificationOptions {
  targets: NotificationTarget[];
  emailOptions?: Omit<EmailOptions, 'to'>;
  smsMessage?: string;
  whatsAppMessage?: string;
  voiceMessage?: string;
}

interface BulkNotificationResult {
  email: NotificationResult[];
  sms: NotificationResult[];
  whatsapp: NotificationResult[];
  voice: NotificationResult[];
}

export async function sendBulkNotifications(
  options: BulkNotificationOptions
): Promise<BulkNotificationResult> {
  const results: BulkNotificationResult = {
    email: [],
    sms: [],
    whatsapp: [],
    voice: [],
  };

  for (const target of options.targets) {
    // Send email
    if (target.email && options.emailOptions) {
      const result = await sendEmail({
        ...options.emailOptions,
        to: target.email,
      });
      results.email.push(result);
    }

    // Send SMS
    if (target.phone && options.smsMessage) {
      const result = await sendSMS({
        to: target.phone,
        message: options.smsMessage,
      });
      results.sms.push(result);
    }

    // Send WhatsApp
    if ((target.whatsapp || target.phone) && options.whatsAppMessage) {
      const result = await sendWhatsApp({
        to: target.whatsapp || target.phone!,
        message: options.whatsAppMessage,
      });
      results.whatsapp.push(result);
    }

    // Make voice call
    if (target.phone && options.voiceMessage) {
      const result = await makeVoiceCall({
        to: target.phone,
        message: options.voiceMessage,
      });
      results.voice.push(result);
    }
  }

  return results;
}

// ============================================================
// CASE NOTIFICATION TEMPLATES
// ============================================================

export function generateCaseNotificationContent(caseData: {
  caseNumber: string;
  vesselName: string;
  vesselNumber: string;
  violationType: string;
  penaltyAmount: number;
  date: string;
  location: string;
}) {
  const emailContent = `
    <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #c00;">Violation Notice - Maharashtra Fisheries Department</h2>
        <p>Dear Vessel Owner,</p>
        <p>This is to inform you that your vessel has been found in violation of fishing regulations.</p>

        <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Case Number</strong></td>
            <td style="padding: 10px; border: 1px solid #ddd;">${caseData.caseNumber}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Vessel Name</strong></td>
            <td style="padding: 10px; border: 1px solid #ddd;">${caseData.vesselName}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Registration Number</strong></td>
            <td style="padding: 10px; border: 1px solid #ddd;">${caseData.vesselNumber}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Violation Type</strong></td>
            <td style="padding: 10px; border: 1px solid #ddd;">${caseData.violationType}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Location</strong></td>
            <td style="padding: 10px; border: 1px solid #ddd;">${caseData.location}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Date</strong></td>
            <td style="padding: 10px; border: 1px solid #ddd;">${caseData.date}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Penalty Amount</strong></td>
            <td style="padding: 10px; border: 1px solid #ddd; color: #c00;"><strong>Rs. ${caseData.penaltyAmount.toLocaleString('en-IN')}</strong></td>
          </tr>
        </table>

        <p>Please report to the nearest fisheries office within 7 days to resolve this matter.</p>

        <p style="color: #666; font-size: 12px;">
          This is an auto-generated notice. Please do not reply to this email.
        </p>

        <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">
          Maharashtra Fisheries Department<br>
          Mantralaya, Mumbai - 400032
        </p>
      </body>
    </html>
  `;

  const smsMessage = `MHFISH: Violation Notice - Case ${caseData.caseNumber}. Vessel ${caseData.vesselNumber} found for ${caseData.violationType}. Penalty: Rs.${caseData.penaltyAmount.toLocaleString('en-IN')}. Report to nearest fisheries office within 7 days.`;

  const whatsAppMessage = `*Maharashtra Fisheries Department*\n\n*Violation Notice*\n\nCase: ${caseData.caseNumber}\nVessel: ${caseData.vesselName} (${caseData.vesselNumber})\nViolation: ${caseData.violationType}\nLocation: ${caseData.location}\nDate: ${caseData.date}\nPenalty: Rs. ${caseData.penaltyAmount.toLocaleString('en-IN')}\n\nPlease report to the nearest fisheries office within 7 days.`;

  const voiceMessage = `This is a notice from Maharashtra Fisheries Department. Case number ${caseData.caseNumber}. Your vessel ${caseData.vesselNumber} has been found in violation. The penalty amount is Rupees ${caseData.penaltyAmount}. Please report to the nearest fisheries office within 7 days.`;

  return {
    emailSubject: `Violation Notice - Case ${caseData.caseNumber} - Maharashtra Fisheries Department`,
    emailContent,
    smsMessage,
    whatsAppMessage,
    voiceMessage,
  };
}
