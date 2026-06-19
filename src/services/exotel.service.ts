/**
 * Exotel Service
 * Sends SMS and WhatsApp messages using Exotel API
 * Used for vessel owner notifications
 */

import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { logger } from '../config/logger';

// ============================================================
// INTERFACES
// ============================================================

interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  phone: string;
}

interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  error?: string;
  phone: string;
}

interface MakeCallResult {
  success: boolean;
  callSid?: string;
  error?: string;
  phone: string;
}

interface CaseNotificationData {
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

interface SendOwnerNotificationsResult {
  sms: {
    sent: number;
    failed: number;
    results: SendSmsResult[];
  };
  whatsapp: {
    sent: number;
    failed: number;
    results: SendWhatsAppResult[];
  };
  call?: {
    success: boolean;
    result?: MakeCallResult;
  };
}

// ============================================================
// EXOTEL SERVICE CLASS
// ============================================================

class ExotelService {
  private smsClient: AxiosInstance | null = null;
  private whatsappClient: AxiosInstance | null = null;
  private isConfigured: boolean;

  constructor() {
    this.isConfigured = Boolean(
      env.exotelApiKey &&
      env.exotelApiToken &&
      env.exotelAccountSid &&
      env.exotelApiKey !== 'your_exotel_api_key'
    );

    if (this.isConfigured) {
      const subdomain = env.exotelSubdomain || 'api.in.exotel.com'; // Mumbai for India
      logger.info(`Exotel configured: Account=${env.exotelAccountSid}, Subdomain=${subdomain}`);

      // SMS Client
      this.smsClient = axios.create({
        baseURL: `https://${subdomain}/v1/Accounts/${env.exotelAccountSid}`,
        auth: {
          username: env.exotelApiKey,
          password: env.exotelApiToken,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      // WhatsApp Client
      this.whatsappClient = axios.create({
        baseURL: `https://${subdomain}/v2/accounts/${env.exotelAccountSid}`,
        auth: {
          username: env.exotelApiKey,
          password: env.exotelApiToken,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      });

      logger.info('Exotel SMS/WhatsApp service initialized');
    } else {
      logger.warn('Exotel credentials not configured - SMS/WhatsApp will be logged only');
    }
  }

  /**
   * Format phone number to E.164 format for India
   */
  private formatPhoneNumber(phone: string): string {
    // Remove spaces, dashes, and other characters
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');

    // If starts with 0, replace with +91
    if (cleaned.startsWith('0')) {
      cleaned = '+91' + cleaned.substring(1);
    }
    // If doesn't start with +, add +91
    else if (!cleaned.startsWith('+')) {
      // If already has 91 at start without +
      if (cleaned.startsWith('91') && cleaned.length === 12) {
        cleaned = '+' + cleaned;
      } else {
        cleaned = '+91' + cleaned;
      }
    }

    return cleaned;
  }

  /**
   * Send SMS to a phone number
   */
  async sendSms(phone: string, message: string): Promise<SendSmsResult> {
    const formattedPhone = this.formatPhoneNumber(phone);

    if (!this.isConfigured || !this.smsClient) {
      logger.info(`[SMS LOG] Would send to ${formattedPhone}: ${message.substring(0, 50)}...`);
      return {
        success: true,
        messageId: 'log-only-' + Date.now(),
        phone: formattedPhone,
      };
    }

    try {
      const params = new URLSearchParams();
      params.append('From', env.exotelSenderId || 'EXOTEL');
      params.append('To', formattedPhone);
      params.append('Body', message);

      // DLT parameters for India (required for production, optional for sandbox)
      if (env.exotelDltEntityId) {
        params.append('DltEntityId', env.exotelDltEntityId);
      }
      if (env.exotelDltTemplateId) {
        params.append('DltTemplateId', env.exotelDltTemplateId);
      }

      logger.info(`Sending SMS via Exotel to ${formattedPhone}...`);
      const response = await this.smsClient.post('/Sms/send', params.toString());

      // Log full response for debugging
      logger.info(`Exotel SMS response: ${JSON.stringify(response.data)}`);

      const messageId = response.data?.SMSMessage?.Sid || response.data?.sid || `sms-${Date.now()}`;
      logger.info(`SMS sent to ${formattedPhone}: ${messageId}`);

      return {
        success: true,
        messageId,
        phone: formattedPhone,
      };
    } catch (error: any) {
      // Log detailed error from Exotel
      const errorResponse = error?.response?.data;
      const errorMessage = errorResponse
        ? JSON.stringify(errorResponse)
        : (error instanceof Error ? error.message : 'Unknown error');
      logger.error(`Failed to send SMS to ${formattedPhone}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        phone: formattedPhone,
      };
    }
  }

  /**
   * Send WhatsApp template message to a phone number
   */
  async sendWhatsApp(phone: string, templateName: string, templateParams: string[]): Promise<SendWhatsAppResult> {
    const formattedPhone = this.formatPhoneNumber(phone);

    if (!this.isConfigured || !this.whatsappClient) {
      logger.info(`[WHATSAPP LOG] Would send to ${formattedPhone}: Template=${templateName}, Params=${templateParams.join(', ')}`);
      return {
        success: true,
        messageId: 'log-only-' + Date.now(),
        phone: formattedPhone,
      };
    }

    if (!env.exotelWhatsAppNumber) {
      logger.warn('WhatsApp number not configured, skipping WhatsApp notification');
      return {
        success: false,
        error: 'WhatsApp number not configured',
        phone: formattedPhone,
      };
    }

    try {
      // Exotel WhatsApp API format
      const payload = {
        from: env.exotelWhatsAppNumber,
        to: formattedPhone,
        content: {
          recipient_type: 'individual',
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: 'en',
              policy: 'deterministic',
            },
            components: [
              {
                type: 'body',
                parameters: templateParams.map(param => ({
                  type: 'text',
                  text: param,
                })),
              },
            ],
          },
        },
      };

      logger.info(`Sending WhatsApp template to ${formattedPhone}...`);
      const response = await this.whatsappClient.post('/messages', payload);

      // Log full response for debugging
      logger.info(`Exotel WhatsApp response: ${JSON.stringify(response.data)}`);

      const messageId = response.data?.request_id || response.data?.id || `wa-${Date.now()}`;
      logger.info(`WhatsApp sent to ${formattedPhone}: ${messageId}`);

      return {
        success: true,
        messageId,
        phone: formattedPhone,
      };
    } catch (error: any) {
      // Log detailed error from Exotel
      const errorResponse = error?.response?.data;
      const errorMessage = errorResponse
        ? JSON.stringify(errorResponse)
        : (error instanceof Error ? error.message : 'Unknown error');
      logger.error(`Failed to send WhatsApp to ${formattedPhone}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        phone: formattedPhone,
      };
    }
  }

  /**
   * Send simple WhatsApp text message (for testing - only works within 24hr session window)
   */
  async sendWhatsAppText(phone: string, message: string): Promise<SendWhatsAppResult> {
    const formattedPhone = this.formatPhoneNumber(phone);

    if (!this.isConfigured || !this.whatsappClient) {
      logger.info(`[WHATSAPP LOG] Would send text to ${formattedPhone}: ${message.substring(0, 50)}...`);
      return {
        success: true,
        messageId: 'log-only-' + Date.now(),
        phone: formattedPhone,
      };
    }

    if (!env.exotelWhatsAppNumber) {
      logger.warn('WhatsApp number not configured');
      return {
        success: false,
        error: 'WhatsApp number not configured',
        phone: formattedPhone,
      };
    }

    try {
      const payload = {
        from: env.exotelWhatsAppNumber,
        to: formattedPhone,
        content: {
          recipient_type: 'individual',
          type: 'text',
          text: {
            body: message,
          },
        },
      };

      logger.info(`Sending WhatsApp text to ${formattedPhone}...`);
      const response = await this.whatsappClient.post('/messages', payload);

      logger.info(`Exotel WhatsApp response: ${JSON.stringify(response.data)}`);

      const messageId = response.data?.request_id || response.data?.id || `wa-${Date.now()}`;
      logger.info(`WhatsApp text sent to ${formattedPhone}: ${messageId}`);

      return {
        success: true,
        messageId,
        phone: formattedPhone,
      };
    } catch (error: any) {
      const errorResponse = error?.response?.data;
      const errorMessage = errorResponse
        ? JSON.stringify(errorResponse)
        : (error instanceof Error ? error.message : 'Unknown error');
      logger.error(`Failed to send WhatsApp text to ${formattedPhone}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        phone: formattedPhone,
      };
    }
  }

  /**
   * Send case notification to vessel owner via SMS and WhatsApp
   */
  async sendOwnerNotifications(
    phoneNumbers: string[],
    caseData: CaseNotificationData
  ): Promise<SendOwnerNotificationsResult> {
    const results: SendOwnerNotificationsResult = {
      sms: { sent: 0, failed: 0, results: [] },
      whatsapp: { sent: 0, failed: 0, results: [] },
    };

    // Filter valid phone numbers
    const validPhones = phoneNumbers.filter(p => p && p.trim().length >= 10);

    if (validPhones.length === 0) {
      logger.warn(`No valid phone numbers for case ${caseData.caseNumber}`);
      return results;
    }

    // SMS Message content
    const smsMessage = this.generateSmsMessage(caseData);

    // WhatsApp template parameters
    const whatsappParams = [
      caseData.ownerName,
      caseData.caseNumber,
      caseData.vesselName,
      caseData.registrationNumber,
      caseData.violationType,
      `Rs. ${caseData.penaltyAmount.toLocaleString('en-IN')}`,
      caseData.districtName,
    ];

    // Make a greeting call to the first phone number
    if (validPhones.length > 0 && env.exotelGreetingAppId) {
      const callResult = await this.makeGreetingCall(validPhones[0]);
      results.call = {
        success: callResult.success,
        result: callResult,
      };
      logger.info(`Greeting call to ${validPhones[0]}: ${callResult.success ? 'success' : 'failed'}`);
    }

    // Send SMS and WhatsApp to each phone number
    for (const phone of validPhones) {
      // Send SMS
      const smsResult = await this.sendSms(phone, smsMessage);
      results.sms.results.push(smsResult);
      if (smsResult.success) {
        results.sms.sent++;
      } else {
        results.sms.failed++;
      }

      // Send WhatsApp
      const waResult = await this.sendWhatsApp(
        phone,
        env.exotelWhatsAppTemplateName || 'case_notification',
        whatsappParams
      );
      results.whatsapp.results.push(waResult);
      if (waResult.success) {
        results.whatsapp.sent++;
      } else {
        results.whatsapp.failed++;
      }

      // Small delay between messages
      await this.delay(100);
    }

    logger.info(
      `Owner notifications for case ${caseData.caseNumber}: ` +
      `Call ${results.call?.success ? '1' : '0'}/1, ` +
      `SMS ${results.sms.sent}/${validPhones.length}, ` +
      `WhatsApp ${results.whatsapp.sent}/${validPhones.length}`
    );

    return results;
  }

  /**
   * Generate SMS message content for case notification
   */
  private generateSmsMessage(caseData: CaseNotificationData): string {
    return `Maharashtra Fisheries Dept: Case ${caseData.caseNumber} registered against vessel ${caseData.vesselName} (${caseData.registrationNumber}) for ${caseData.violationType}. Penalty: Rs.${caseData.penaltyAmount.toLocaleString('en-IN')}. Contact ACF ${caseData.districtName} for details.`;
  }

  /**
   * Send test SMS
   */
  async sendTestSms(phone: string): Promise<SendSmsResult> {
    const message = 'This is a test SMS from Maharashtra Fisheries Drone Dashboard. If you received this, SMS integration is working correctly.';
    return this.sendSms(phone, message);
  }

  /**
   * Send test WhatsApp (uses text message for testing)
   * Note: Text messages only work within 24hr session window after user messages first
   */
  async sendTestWhatsApp(phone: string): Promise<SendWhatsAppResult> {
    const message = 'This is a test message from Maharashtra Fisheries Drone Dashboard. If you received this, WhatsApp integration is working correctly.';
    return this.sendWhatsAppText(phone, message);
  }

  /**
   * Format phone number for Exotel calls (with 0 prefix for India)
   */
  private formatPhoneForCall(phone: string): string {
    // Remove spaces, dashes, and other characters
    let cleaned = phone.replace(/[\s\-\(\)\+]/g, '');

    // Remove 91 prefix if present
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      cleaned = cleaned.substring(2);
    }

    // Add 0 prefix for Indian mobile numbers
    if (!cleaned.startsWith('0') && cleaned.length === 10) {
      cleaned = '0' + cleaned;
    }

    return cleaned;
  }

  /**
   * Make an outbound call to play a recorded greeting
   * Uses Exotel's Greeting App or audio URL
   */
  async makeGreetingCall(phone: string, audioUrlOrAppId?: string): Promise<MakeCallResult> {
    const formattedPhone = this.formatPhoneForCall(phone);

    if (!this.isConfigured) {
      logger.info(`[CALL LOG] Would call ${formattedPhone} with greeting`);
      return {
        success: true,
        callSid: 'log-only-' + Date.now(),
        phone: formattedPhone,
      };
    }

    if (!env.exotelSenderId) {
      logger.warn('Exotel caller ID (ExoPhone) not configured');
      return {
        success: false,
        error: 'Caller ID not configured',
        phone: formattedPhone,
      };
    }

    try {
      const subdomain = env.exotelSubdomain || 'api.exotel.com';

      // Build form data for outbound call to app/greeting
      const params = new URLSearchParams();
      params.append('From', formattedPhone);
      params.append('CallerId', env.exotelSenderId);
      params.append('CallType', 'trans'); // Transactional call
      params.append('Record', 'true'); // Record the call
      params.append('TimeLimit', '120'); // 2 minutes max
      params.append('TimeOut', '30'); // 30 seconds ring time

      // Use Passthru applet to play audio directly from URL
      // Exotel's passthru applet can call our server which returns ExoML with <Play> tag
      const appId = audioUrlOrAppId || env.exotelGreetingAppId;
      const audioUrl = env.exotelGreetingAudioUrl || 'https://dof-schnell-drone-tech-dashboard.s3.ap-south-1.amazonaws.com/audio/case-notification-greeting.mp3';

      if (appId && /^\d+$/.test(appId)) {
        // Use configured app ID
        params.append('Url', `http://my.exotel.com/${env.exotelAccountSid}/exoml/start_voice/${appId}`);
      } else {
        // Use passthru with direct audio URL - Exotel's greeting flow
        // Try using the play applet with audio URL
        params.append('Url', `http://my.exotel.com/${env.exotelAccountSid}/exoml/start_voice/1262172`);
      }

      // Pass the audio URL as custom field (for reference)
      params.append('CustomField', audioUrl.substring(0, 200));

      logger.info(`Making greeting call to ${formattedPhone}...`);

      const response = await axios.post(
        `https://${subdomain}/v1/Accounts/${env.exotelAccountSid}/Calls/connect`,
        params.toString(),
        {
          auth: {
            username: env.exotelApiKey,
            password: env.exotelApiToken,
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      // Log full response for debugging
      logger.info(`Exotel Call response: ${JSON.stringify(response.data)}`);

      // Parse response (XML format from Exotel)
      let callSid = `call-${Date.now()}`;
      if (typeof response.data === 'string') {
        // Extract Sid from XML response
        const sidMatch = response.data.match(/<Sid>([^<]+)<\/Sid>/);
        if (sidMatch && sidMatch[1]) {
          callSid = sidMatch[1];
        }
      } else if (response.data?.Call?.Sid) {
        callSid = response.data.Call.Sid;
      } else if (response.data?.sid) {
        callSid = response.data.sid;
      }
      logger.info(`Call initiated to ${formattedPhone}: ${callSid}`);

      return {
        success: true,
        callSid,
        phone: formattedPhone,
      };
    } catch (error: any) {
      const errorResponse = error?.response?.data;
      const errorMessage = errorResponse
        ? (typeof errorResponse === 'string' ? errorResponse : JSON.stringify(errorResponse))
        : (error instanceof Error ? error.message : 'Unknown error');
      logger.error(`Failed to make call to ${formattedPhone}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        phone: formattedPhone,
      };
    }
  }

  /**
   * Make a test call
   */
  async makeTestCall(phone: string): Promise<MakeCallResult> {
    return this.makeGreetingCall(phone);
  }

  /**
   * Utility: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const exotelService = new ExotelService();
