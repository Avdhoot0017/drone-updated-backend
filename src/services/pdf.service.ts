/**
 * PDF Generation Service
 * Generates Marathi case documents with images and digital signatures
 * Uses Puppeteer for HTML-to-PDF conversion with proper font support
 */

import puppeteer, { Browser } from 'puppeteer';
import { format } from 'date-fns';
import path from 'path';
import fs from 'fs';
import { logger } from '../config/logger';
import { s3Service } from './s3.service';
import { parseCertificate } from '../utils/certificate';
import { pdfSigner } from '../utils/pdfSigner';

// ============================================================
// INTERFACES
// ============================================================

export interface SignerInfo {
  name: string;
  organization: string;
  designation?: string;
  issuer: string;
  validFrom?: Date | null;
  validTo?: Date | null;
  email?: string | null;
  isValid: boolean;
  signatureImagePath?: string; // Path to signature image (if uploaded as image)
  signatureImageBase64?: string; // Base64 encoded signature image
}

export interface CasePdfData {
  // Case info
  caseNumber?: string;
  currentDate: string;

  // Vessel details
  vesselName: string;
  registrationNumber: string;

  // Owner details
  ownerName: string;
  ownerAddress?: string;
  ownerTaluka?: string;
  ownerDistrict?: string;

  // Location
  districtName: string;
  flyingLocationName: string;
  latitude?: string;
  longitude?: string;
  enforcementAreaId?: string; // Used for finding ACF certificate

  // Violation
  violationTypeName: string;
  fishingLicenseTypeName?: string;
  observationDate: string;

  // Trawling specific
  depth?: string; // Depth in fathoms (वाव) - only for trawling violations

  // Act/Section (कलम)
  actKalam?: string;

  // Hearing
  hearingDate?: string;
  hearingTime?: string;

  // Penalty
  processingFee: number;
  violationPenalty: number;
  totalPenalty: number;
  occurrence: number;

  // Evidence images (base64 or URLs)
  images?: string[];

  // Signer information (ACF user)
  signer?: SignerInfo;
}

interface PdfGenerationResult {
  success: boolean;
  pdfBuffer?: Buffer;
  s3Key?: string;
  error?: string;
  signingWarning?: string; // Warning if PDF couldn't be digitally signed
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Format number in Indian locale
 */
function formatIndianNumber(num: number): string {
  return num.toLocaleString('en-IN');
}

/**
 * Format penalty in lakhs
 */
function formatInLakhs(amount: number): string {
  const lakhs = amount / 100000;
  return lakhs.toFixed(2);
}

/**
 * Get ordinal suffix for number (Marathi)
 */
function getOrdinal(n: number): string {
  const suffixes = ['वी', 'ली', 'री', 'थी', 'वी'];
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

/**
 * National Emblem of India - Load from file and convert to base64
 */
const NATIONAL_EMBLEM_PATH = path.join(__dirname, '../assets/national-emblem.png');

function getNationalEmblemBase64(): string {
  try {
    const imageBuffer = fs.readFileSync(NATIONAL_EMBLEM_PATH);
    return imageBuffer.toString('base64');
  } catch (error) {
    logger.warn('Could not load national emblem image:', error);
    return ''; // Return empty string if file not found
  }
}

// ============================================================
// HTML TEMPLATE
// ============================================================

function generateHtmlTemplate(data: CasePdfData): string {
  const currentDate = data.currentDate || format(new Date(), 'dd/MM/yyyy');
  const nationalEmblemBase64 = getNationalEmblemBase64();
  const observationDate = data.observationDate
    ? format(new Date(data.observationDate), 'dd/MM/yyyy')
    : currentDate;

  // Use provided hearing date/time or fallback to 7 days from now
  let hearingDate: string;
  if (data.hearingDate) {
    hearingDate = format(new Date(data.hearingDate), 'dd/MM/yyyy');
  } else {
    const hearingDateObj = new Date();
    hearingDateObj.setDate(hearingDateObj.getDate() + 7);
    hearingDate = format(hearingDateObj, 'dd/MM/yyyy');
  }
  const hearingTime = data.hearingTime || '11:00';

  // Main document HTML
  let html = `
<!DOCTYPE html>
<html lang="mr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Case Document</title>
  <style>
    /* Load Google Fonts as fallback - local fonts are preferred */
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap');

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      /* Prioritize local Noto Sans Devanagari (installed on Docker), then Google Fonts, then Mangal */
      font-family: 'Noto Sans Devanagari', 'Noto Sans', 'Mangal', 'Lohit Devanagari', 'Gargi', 'FreeSans', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #000;
      background: #fff;
      /* Ensure proper Devanagari text rendering */
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 20mm;
      margin: 0 auto;
      background: white;
      page-break-after: always;
    }

    .page:last-child {
      page-break-after: avoid;
    }

    .header {
      text-align: center;
      margin-bottom: 20px;
    }

    .header h1 {
      font-size: 14pt;
      font-weight: bold;
      margin-bottom: 5px;
    }

    .header h2 {
      font-size: 13pt;
      font-weight: bold;
      margin-bottom: 5px;
    }

    .header p {
      font-size: 10pt;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 15px;
    }

    .text-right {
      text-align: right;
    }

    .section {
      margin-bottom: 15px;
    }

    .section-title {
      font-weight: bold;
      margin-bottom: 5px;
    }

    .underline {
      text-decoration: underline;
      font-weight: 600;
    }

    ol {
      margin-left: 30px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }

    th, td {
      border: 1px solid #000;
      padding: 8px;
      text-align: left;
    }

    th {
      background-color: #f3f4f6;
      font-weight: bold;
    }

    .total-row {
      font-weight: bold;
    }

    .total-amount {
      color: #c00;
      font-size: 12pt;
    }

    .footer-section {
      margin-top: 30px;
      text-align: right;
    }

    .notice-box {
      background: #f9fafb;
      border: 1px solid #ddd;
      padding: 12px;
      border-radius: 4px;
      margin: 15px 0;
      text-align: center;
    }

    .signature-box {
      border: 2px solid #1e40af;
      border-radius: 8px;
      padding: 12px;
      background: #eff6ff;
      max-width: 280px;
      float: right;
      margin-top: 20px;
    }

    .signature-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      color: #1e40af;
      font-weight: bold;
    }

    .signature-details {
      font-size: 9pt;
    }

    .signature-valid {
      color: #16a34a;
      font-weight: bold;
    }

    .evidence-note {
      margin-top: 30px;
      font-size: 10pt;
      color: #666;
    }

    /* Evidence page styles */
    .evidence-header {
      text-align: center;
      padding-bottom: 15px;
      border-bottom: 2px solid #000;
      margin-bottom: 20px;
    }

    .evidence-ref {
      background: #f9fafb;
      border: 1px solid #ddd;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 20px;
    }

    .evidence-ref-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .image-container {
      border: 1px solid #ddd;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 20px;
    }

    .image-header {
      background: #f0f0f0;
      padding: 8px 15px;
      border-bottom: 1px solid #ddd;
      font-weight: bold;
    }

    .image-body {
      padding: 15px;
      text-align: center;
      min-height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .image-body img {
      max-width: 100%;
      max-height: 400px;
      object-fit: contain;
    }

    .image-footer {
      background: #f9fafb;
      padding: 8px 15px;
      border-top: 1px solid #ddd;
      font-size: 9pt;
      color: #666;
    }

    .evidence-footer {
      margin-top: 20px;
      padding-top: 15px;
      border-top: 1px solid #ddd;
      text-align: center;
      font-size: 10pt;
      color: #666;
    }

    .page-divider {
      border-top: 2px solid #000;
      padding-top: 20px;
      margin-top: 30px;
    }

    .govt-header {
      text-align: center;
      margin-bottom: 15px;
    }

    .govt-header p {
      font-weight: bold;
    }

    .vs-text {
      text-align: center;
      font-weight: bold;
      margin: 15px 0;
    }

    @media print {
      .page {
        page-break-after: always;
        padding: 15mm;
      }
    }
  </style>
</head>
<body>
  <!-- Page 1: Main Document (Prativrutt/Prativedan) -->
  <div class="page">
    <div class="header">
      <h1>मा.अभिनिर्णय अधिकारी तथा सहाय्यक आयुक्त मत्स्यव्यवसाय, <span class="underline">${data.districtName || '___________'}</span> याचे न्यायालयात</h1>
      <h2>प्रतिवृत्त/प्रतिवेदन</h2>
      <p>(महाराष्ट्र सागरी मासेमारी नियमन (सुधारणा) अधिनियम, 2021 कलम 16 अन्वये)</p>
    </div>

    <div class="meta-row">
      <span>केस क्र. <strong>${data.caseNumber || 'XXXXX'}</strong></span>
      <span>दिनांक- <strong>${currentDate}</strong></span>
    </div>

    <div class="section">
      <p>प्रति,</p>
      <p style="margin-left: 20px;">अभिनिर्णय अधिकारी, ${data.districtName || '___________'} तथा</p>
      <p style="margin-left: 20px;">सहाय्यक आयुक्त मत्स्यव्यवसाय (जि. ${data.districtName || '___________'}),</p>
    </div>

    <div class="section">
      <p class="section-title">वाचा-</p>
      <ol>
        <li>महाराष्ट्र सागरी मासेमारी नियमन अधिनियम, 1981</li>
        <li>महाराष्ट्र सागरी मासेमारी नियमन (सुधारणा) अधिनियम, 2021</li>
      </ol>
    </div>

    <div class="section">
      <p style="text-align: justify;">
        सामनेवाला श्री. <span class="underline">${data.ownerName || '_______________'}</span> यांच्या
        मालकीची नौका नाव <span class="underline">${data.vesselName || '_______________'}</span> क्रमांक-
        <span class="underline">${data.registrationNumber || '_______________'}</span> या नौकेस
        विभागामार्फत <span class="underline">${data.fishingLicenseTypeName || 'पर्ससीन'}</span> पध्दतीची नोंदणी करण्यात आलेली आहे.
      </p>
    </div>

    <div class="section">
      <p style="text-align: justify;">
        ड्रोन यंत्रप्रणालीद्वारे <strong>${data.districtName || '___________'}</strong> जिल्ह्याच्या जलधी क्षेत्रात गस्त घालुन
        नियंत्रण व देखरेख करित असताना मासेमारी नौका नाव
        <span class="underline">${data.vesselName || '___________'}</span>
        क्रमांक <span class="underline">${data.registrationNumber || '___________'}</span> ही
        रेखांश <span class="underline">${data.longitude || '___________'}</span>,
        अक्षांश <span class="underline">${data.latitude || '___________'}</span> या ठिकाणी${data.depth ? ` <span class="underline">${data.depth}</span> इतक्या वावात` : ''}
        अनधिकृतरित्या <strong>${data.violationTypeName || 'पर्ससीन/एलईडी/ट्रॉलिंग/इतर'}</strong> पध्दतीने मासेमारी करित असल्याचे निदर्शनास आलेली आहे.
      </p>
    </div>

    <div class="section">
      <p style="text-align: justify;">
        सदर नौकेमार्फत महाराष्ट्र सागरी मासेमारी नियमन अधिनियम (सुधारणा), 2021 कायद्यामधील तरतुदीचे भंग करुन
        मासेमारी करित असल्याचे दिसुन आल्याने उक्त कायद्यामधील कलम 16 मधील तरतुदी अन्वये आपल्याकडे प्रतिवृत्त दाखल करण्यात येत आहे.
      </p>
    </div>

    <div class="section">
      <p class="section-title">नौकेमार्फत करण्यात आलेले उल्लघंन व इतर बाबीचा तपशिल खालील प्रमाणे आहे.</p>
      <table>
        <thead>
          <tr>
            <th style="width: 50px; text-align: center;">अ.क्र.</th>
            <th>उल्लघंन तपशिल</th>
            <th style="width: 120px; text-align: center;">कलम तपशिल</th>
            <th style="width: 140px; text-align: center;">प्रस्तावित शास्ती तपशिल</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align: center;">1</td>
            <td>परवानाच्या अटी व शर्तिंचे उल्लंघन</td>
            <td style="text-align: center;">कलम 17 (३) (फ)</td>
            <td style="text-align: center; font-weight: bold;">रू. ${formatInLakhs(data.processingFee)} लक्ष</td>
          </tr>
          <tr>
            <td style="text-align: center;">2</td>
            <td>${data.violationTypeName || ''}</td>
            <td style="text-align: center;">${data.actKalam || ''}</td>
            <td style="text-align: center; font-weight: bold;">रू. ${formatInLakhs(data.violationPenalty)} लक्ष</td>
          </tr>
          <tr class="total-row">
            <td colspan="2"></td>
            <td style="text-align: center; font-weight: bold;">एकुण दंड</td>
            <td style="text-align: center;" class="total-amount">रु. ${formatInLakhs(data.totalPenalty)} लक्ष</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <p style="text-align: justify;">
        तरी, सदर नौकेमार्फत सागरी कायद्याचे उल्लघंन केले असल्याचे निदर्शनास आल्याने शाश्वत मासेमारी टीकुन राहण्याच्या दृष्टीने
        व मत्स्यसाठयाचे संवर्धन होण्याकरिता महाराष्ट्र सागरी मासेमारी नियमन अधिनियम (सुधारणा), 2021 कायद्यामधील
        कलम १७ मधील तरतुदीनुसार जास्तीस जास्त शास्ती लादण्याबाबत आपणांस विनंती करण्यात येत आहे.
      </p>
    </div>

    <div class="footer-section">
      ${data.signer ? `
      <div style="margin-bottom: 5px;">
        ${data.signer?.signatureImageBase64 ? `<img src="data:image/png;base64,${data.signer.signatureImageBase64}" alt="Signature" style="max-width: 120px; max-height: 50px;" />` : ''}
        <p style="margin: 2px 0; font-size: 9pt; color: #1e40af;">🔒 Digitally Signed by: <strong>${data.signer?.name || 'Authorized Signatory'}</strong></p>
        <p style="margin: 0; font-size: 8pt; color: #16a34a;">✓ Valid Certificate | ${currentDate}</p>
      </div>
      ` : ''}
      <p><strong>फिर्यादी तथा अंमलबजावणी अधिकारी</strong></p>
      <p>सहाय्यक मत्स्यव्यवसाय विकास अधिकारी (परवाना अधिकारी)</p>
    </div>

    <div class="evidence-note">
      <p>सोबत : विभागाच्या ड्रोन द्वारे प्राप्त झालेले छायाचित्र (भारतीय साक्ष अधिनियम 2023 कलम 63)</p>
    </div>
  </div>

  <!-- Page 2: Hearing Notice Section (सुनावणी ची नोटिस) -->
  <div class="page">
    <!-- Government Header Box with Emblem, Case Number, Date and Officer Text -->
    <table style="width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 15px;">
      <tr>
        <td style="text-align: center; padding: 15px; border: 1px solid #000;">
          <img src="data:image/png;base64,${nationalEmblemBase64}" alt="National Emblem" style="width: 60px; height: auto; margin-bottom: 8px;" />
          <p style="margin: 0; font-weight: bold; font-size: 14pt;">महाराष्ट्र शासन</p>
          <p style="margin: 0; font-weight: bold; font-size: 12pt;">मत्स्यव्यवसाय विभाग</p>
          <p style="margin: 8px 0 0 0;">अभिनिर्णय अधिकारी तथा सहाय्यक मत्स्यव्यवसाय जि.(<strong>${data.districtName || '___'}</strong>)</p>
          <div style="display: flex; justify-content: space-between; margin-top: 8px; padding: 0 20px;">
            <span>केस क्र. <strong>${data.caseNumber || 'XXXXX'}</strong></span>
            <span>दि. <strong>${currentDate}</strong></span>
          </div>
        </td>
      </tr>
    </table>

      <div style="text-align: center; margin: 20px 0;">
        <h2 style="text-decoration: underline; font-size: 14pt;">सुनावणी ची नोटिस</h2>
      </div>

      <!-- Parties Table - फीर्यादी -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; border: 1px solid #666;">
        <tr>
          <td style="width: 80%; vertical-align: middle; text-align: center; padding: 10px; border: 1px solid #666;">
            <p style="margin: 0;">महाराष्ट्र शासनातर्फे फिर्यादी सहाय्यक आयुक्त मत्स्यव्यवसाय विकास अधिकारी</p>
            <p style="margin: 0;">(अंमलबजावणी अधिकारी), तथा परवाना अधिकारी <strong>${data.flyingLocationName || '___________'}</strong></p>
          </td>
          <td style="width: 20%; vertical-align: middle; text-align: center; padding: 10px; border: 1px solid #666;">
            <p style="margin: 0; font-weight: bold;">फीर्यादी</p>
          </td>
        </tr>
      </table>

      <div class="vs-text">विरूध्द</div>

      <!-- Parties Table - सामनेवाला -->
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; border: 1px solid #666;">
        <tr>
          <td style="width: 80%; vertical-align: middle; text-align: center; padding: 10px; border: 1px solid #666;">
            <p style="margin: 0;">नाव: <span class="underline">${data.ownerName || '_______________'}</span>, रा. <span class="underline">${data.ownerAddress || '_______________'}</span> ता. <strong>${data.ownerTaluka || data.flyingLocationName || '___'}</strong> जि. <strong>${data.ownerDistrict || data.districtName || '___'}</strong></p>
            <p style="margin: 0;">नौकेचे नाव : <span class="underline">${data.vesselName || '_______________'}</span>, नौका क्र. <span class="underline">${data.registrationNumber || '_______________'}</span></p>
          </td>
          <td style="width: 20%; vertical-align: middle; text-align: center; padding: 10px; border: 1px solid #666;">
            <p style="margin: 0; font-weight: bold;">सामनेवाला</p>
          </td>
        </tr>
      </table>

      <div class="notice-box">
        <p style="font-weight: bold;">
          महाराष्ट्र सागरी मासेमारी नियमन अधिनियम 1981 व महाराष्ट्र सागरी मासेमारी नियमन (सुधारीत) अध्यादेश, 2021, 16 (1) अन्वये नोटीस
        </p>
      </div>

      <div class="section">
        <p style="text-align: justify;">
          फिर्यादी यांनी महाराष्ट्र सागरी मासेमारी नियमन अधिनियम 1981 व महाराष्ट्र सागरी मासेमारी नियमन (सुधारीत) अधिनियम, 2021,
          कलम 16 (1) अन्वये ड्रोन यंत्रप्रणाली द्वारे सागरी गस्ती दरम्यान आपली वरील नमुद नौका विनिर्दिष्ट क्षेत्रात अनधिकृत मासेमारी करताना
          दि.<span class="underline">${observationDate}</span> रोजी
          <span class="underline">${data.flyingLocationName || '___________'}</span> या ठिकाणी आढळून आल्याने
          आपल्या नौकेवर दाखल केलेल्या प्रतिवेदनाची सुनावणी दि.<span class="underline">${hearingDate}</span>रोजी
          दु.<span class="underline">${hearingTime}</span> वाजता करणेची ठरविली आहे.
        </p>
      </div>

      <div class="section">
        <p style="text-align: justify;">
          म्हणून तुम्ही अगर तुमचे अधिकृत प्रतिनिधी यांनी सहाय्यक आयुक्त मत्स्यव्यवसाय, जि.<strong>${data.districtName || '___'}</strong> येथे हजर रहावे.
          सदरच्या सुनावणीस आपण गैरहजर राहिल्यास आपले कोणतेही म्हणणे नाही असे गृहित धरून एकतर्फी निकाल दिला जाईल याची नोंद घ्यावी.
        </p>
      </div>

    <!-- Place and Date with Signature Section 2 - अभिनिर्णय अधिकारी -->
    <table style="width: 100%; margin-top: 15px;">
      <tr>
        <td style="width: 50%; vertical-align: top;">
          <p style="margin: 0;">ठिकाण - <strong>${data.districtName || '___________'}</strong></p>
          <p style="margin: 0;">दिनांक - <strong>${currentDate}</strong></p>
        </td>
        <td style="width: 50%; vertical-align: top; text-align: right;">
          <div style="display: inline-block; text-align: center;">
            ${data.signer ? `
            <div style="border: 1px solid #1e40af; border-radius: 6px; padding: 8px; background: #eff6ff; margin-bottom: 8px; font-size: 9pt;">
              <p style="margin: 0; color: #1e40af; font-weight: bold; font-size: 8pt;">🔒 Digital Signature</p>
              ${data.signer?.signatureImageBase64 ? `<img src="data:image/png;base64,${data.signer.signatureImageBase64}" alt="Signature" style="max-width: 100px; max-height: 40px; margin: 5px 0;" />` : ''}
              <p style="margin: 2px 0; font-size: 8pt;"><strong>${data.signer?.name || 'Authorized Signatory'}</strong></p>
              <p style="margin: 0; font-size: 7pt; color: #16a34a;">✓ Valid Certificate</p>
            </div>
            ` : ''}
            <p style="margin: 0;"><strong>(अभिनिर्णय अधिकारी)</strong></p>
            <p style="margin: 0;">अभिनिर्णय अधिकारी तथा</p>
            <p style="margin: 0;">सहाय्यक आयुक्त मत्स्यव्यवसाय (तां.)</p>
          </div>
        </td>
      </tr>
    </table>
  </div>`;

  // Page 3: Evidence Images (if any)
  if (data.images && data.images.length > 0) {
    html += `
  <!-- Page 3: Evidence Images -->
  <div class="page">
    <div class="evidence-header">
      <h2>पुरावे / Evidence Images</h2>
      <p style="color: #666;">(ड्रोन यंत्रप्रणालीद्वारे टिपलेले छायाचित्र / Drone Surveillance Photographs)</p>
    </div>

    <div class="evidence-ref">
      <div class="evidence-ref-grid">
        <div><strong>नौका नाव / Vessel:</strong> ${data.vesselName}</div>
        <div><strong>क्रमांक / Reg:</strong> ${data.registrationNumber}</div>
        <div><strong>दिनांक / Date:</strong> ${observationDate}</div>
        <div><strong>स्थान / Location:</strong> ${data.flyingLocationName}, ${data.districtName}</div>
      </div>
    </div>

    ${data.images.map((image, index) => `
    <div class="image-container">
      <div class="image-header">छायाचित्र ${index + 1} / Image ${index + 1}</div>
      <div class="image-body">
        <img src="${image}" alt="Evidence ${index + 1}" />
      </div>
      <div class="image-footer">GPS: ${data.latitude || 'N/A'}, ${data.longitude || 'N/A'}</div>
    </div>
    `).join('')}

    <div class="evidence-footer">
      <p>वरील छायाचित्रे ड्रोन यंत्रप्रणालीद्वारे ${observationDate} रोजी टिपण्यात आली.</p>
      <p>The above photographs were captured by drone surveillance system on ${observationDate}.</p>
    </div>
  </div>`;
  }

  html += `
</body>
</html>`;

  return html;
}

// ============================================================
// SIGNER HELPERS
// ============================================================

/**
 * Load signer information from certificate or signature file
 */
export function loadSignerInfo(
  signaturePath?: string,
  userName?: string,
  designation?: string
): SignerInfo {
  // Default signer info (fallback to certificate in config)
  let signerInfo: SignerInfo = {
    name: userName || 'SATYAWAN JADHAV',
    organization: 'SCHNELL DRONE TECHNOLOGIES LIMITED',
    designation: designation,
    issuer: 'SpeedSign DSC Sub CA 2022',
    isValid: true,
  };

  // Try to load from certificate if path provided
  if (signaturePath) {
    const ext = path.extname(signaturePath).toLowerCase();
    const absolutePath = signaturePath.startsWith('/uploads')
      ? path.join(__dirname, '../../', signaturePath)
      : signaturePath;

    // Check if it's a certificate file
    if (signaturePath.includes('.cer') || signaturePath.includes('.pem')) {
      const certInfo = parseCertificate(absolutePath);
      if (certInfo) {
        signerInfo = {
          name: certInfo.subjectName || userName || signerInfo.name,
          organization: certInfo.organization || signerInfo.organization,
          designation: designation,
          issuer: certInfo.issuer || signerInfo.issuer,
          validFrom: certInfo.validFrom,
          validTo: certInfo.validTo,
          email: certInfo.email,
          isValid: certInfo.isValid,
        };
      }
    }
    // Check if it's an image file
    else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      if (fs.existsSync(absolutePath)) {
        try {
          const imageBuffer = fs.readFileSync(absolutePath);
          signerInfo.signatureImageBase64 = imageBuffer.toString('base64');
          signerInfo.signatureImagePath = signaturePath;
          // Update name if provided
          if (userName) {
            signerInfo.name = userName;
          }
        } catch (error) {
          logger.warn('Could not load signature image:', error);
        }
      }
    }
  }
  // If no signature path provided, use the default hardcoded signer info

  return signerInfo;
}

// ============================================================
// PDF SERVICE CLASS
// ============================================================

class PdfService {
  private browser: Browser | null = null;

  /**
   * Initialize browser instance
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    }
    return this.browser;
  }

  /**
   * Close browser instance
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Generate case PDF from data
   * @param data - Case data for PDF generation
   * @param signPdf - Whether to digitally sign the PDF (default: true)
   */
  async generateCasePdf(data: CasePdfData, signPdf: boolean = true): Promise<PdfGenerationResult> {
    let signingWarning: string | undefined;

    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      // Generate HTML content
      const html = generateHtmlTemplate(data);

      // Set content and wait for DOM to load
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      // Wait for network to be idle (fonts loading from Google)
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {
        // Timeout is OK - local fonts will be used as fallback
        logger.warn('Network idle timeout - using local fonts');
      });

      // Wait for fonts to be fully loaded and rendered
      await page.evaluateHandle('document.fonts.ready');

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm',
        },
      });

      await page.close();

      let finalPdfBuffer = Buffer.from(pdfBuffer);

      // Digitally sign the PDF using ACF's certificate for the district
      if (signPdf && data.enforcementAreaId && pdfSigner.isSigningAvailable()) {
        logger.info(`Signing PDF with ACF certificate for district: ${data.enforcementAreaId}`);

        const signingResult = await pdfSigner.signPdfForDistrict(finalPdfBuffer, data.enforcementAreaId, {
          name: data.signer?.name,
          reason: 'Digital Signature - Maharashtra Fisheries Department Case Document',
          location: data.districtName || 'Maharashtra, India',
          contactInfo: data.signer?.email || 'fisheries@maharashtra.gov.in',
        });

        if (signingResult.success && signingResult.signedPdf) {
          finalPdfBuffer = Buffer.from(signingResult.signedPdf);
          logger.info('PDF signed successfully with ACF digital certificate');
        } else {
          signingWarning = signingResult.warning || signingResult.error || 'PDF signing failed';
          logger.warn(`PDF signing failed: ${signingResult.error}. ${signingWarning}`);
        }
      } else if (signPdf && !data.enforcementAreaId) {
        signingWarning = 'No district specified for digital signing';
        logger.warn('PDF signing requested but no enforcementAreaId provided. Returning unsigned PDF.');
      } else if (signPdf) {
        signingWarning = 'S3 not configured for certificate storage';
        logger.warn('PDF signing requested but S3 not configured. Returning unsigned PDF.');
      }

      logger.info('PDF generated successfully');

      return {
        success: true,
        pdfBuffer: finalPdfBuffer,
        signingWarning,
      };
    } catch (error) {
      logger.error('PDF generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PDF generation failed',
        signingWarning,
      };
    }
  }

  /**
   * Generate case PDF and upload to S3
   */
  async generateAndUploadCasePdf(
    data: CasePdfData,
    caseId: string
  ): Promise<PdfGenerationResult> {
    try {
      // Generate PDF
      const pdfResult = await this.generateCasePdf(data);

      if (!pdfResult.success || !pdfResult.pdfBuffer) {
        return pdfResult;
      }

      // Upload to S3
      const fileName = `case-${data.caseNumber?.replace(/\//g, '-') || caseId}-${Date.now()}.pdf`;
      const uploadResult = await s3Service.uploadFile(
        pdfResult.pdfBuffer,
        fileName,
        'application/pdf',
        `cases/${caseId}`
      );

      if (!uploadResult.success) {
        return {
          success: false,
          pdfBuffer: pdfResult.pdfBuffer,
          error: uploadResult.error,
          signingWarning: pdfResult.signingWarning,
        };
      }

      logger.info(`Case PDF uploaded to S3: ${uploadResult.key}`);

      return {
        success: true,
        pdfBuffer: pdfResult.pdfBuffer,
        s3Key: uploadResult.key,
        signingWarning: pdfResult.signingWarning,
      };
    } catch (error) {
      logger.error('PDF generation and upload error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PDF generation failed',
      };
    }
  }
}

export const pdfService = new PdfService();
