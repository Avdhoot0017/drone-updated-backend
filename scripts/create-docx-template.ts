/**
 * Script to create DOCX template with proper placeholders
 * Run with: npx ts-node scripts/create-docx-template.ts
 */

import PizZip from 'pizzip';
import fs from 'fs';
import path from 'path';

const inputPath = path.join(__dirname, '../../Case Draft (2) (1) (1) (1).docx');
const outputPath = path.join(__dirname, '../src/config/case-template.docx');

// Read the original DOCX
const content = fs.readFileSync(inputPath, 'binary');
const zip = new PizZip(content);

// Get document.xml
let documentXml = zip.file('word/document.xml')?.asText() || '';

// Define replacements based on actual XML patterns
const replacements: [RegExp | string, string][] = [
  // Exact patterns found in document.xml
  [/>----------</g, '>{districtName}<'],
  [/>--------------</g, '>{districtName}<'],
  [/>-----------------------</g, '>{ownerName}<'],
  [/> ----------------</g, '> {registrationNumber}<'],
  [/>----------, अ</g, '>{longitude}, अ<'],
  [/> ------------- </g, '> {latitude} '],
  [/>---------------</g, '>{vesselName}<'],

  // Hearing notice patterns
  [/>नाव: ----------------,रा\.------------------ता\.-----------जि\.-----</g,
   '>नाव: {ownerName}, रा. {ownerAddress} ता. {ownerTaluka} जि. {ownerDistrict}<'],
  [/>नौकेचे नाव : ----------------, नौका क्र\.-----------------</g,
   '>नौकेचे नाव : {vesselName}, नौका क्र. {registrationNumber}<'],

  // Long hearing paragraph
  [/दि\.------- रोजी/g, 'दि. {observationDate} रोजी'],
  [/--------------या ठिकाणी/g, '{flyingLocationName} या ठिकाणी'],
  [/दि\.--------रोजी दु\.------/g, 'दि. {hearingDate} रोजी दु. {hearingTime}'],
  [/जि-------- येथे/g, 'जि. {districtName} येथे'],

  // Case number pattern
  [/क्र\.---------\/202/g, 'क्र. {caseNumber}/202'],

  // Vessel type
  [/पर्ससीन\/ट्रॉलिंग\/दालदी\/डोल/g, '{vesselType}'],

  // District in patrol area
  [/पालघर\/ठाणे\/रायगड\/रत्नागिरी\/सिंधुदुर्ग/g, '{districtName}'],

  // Violation type
  [/पर्ससीन\/एलईडी\/ट्रॉलिंग\/इतर/g, '{violationTypeName}'],

  // रत्नागिरी specific replacements
  [/रत्नागिरी तथा/g, '{districtName} तथा'],
];

// Apply replacements
for (const [pattern, replacement] of replacements) {
  documentXml = documentXml.replace(pattern, replacement);
}

// Update the document.xml in the zip
zip.file('word/document.xml', documentXml);

// Generate the new DOCX
const output = zip.generate({
  type: 'nodebuffer',
  compression: 'DEFLATE',
});

// Ensure config directory exists
const configDir = path.dirname(outputPath);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Write the output
fs.writeFileSync(outputPath, output);
console.log(`Template created at: ${outputPath}`);

// Verify by checking if placeholders exist
const verifyContent = fs.readFileSync(outputPath, 'binary');
const verifyZip = new PizZip(verifyContent);
const verifyXml = verifyZip.file('word/document.xml')?.asText() || '';

const placeholders = [
  '{districtName}',
  '{caseNumber}',
  '{ownerName}',
  '{vesselName}',
  '{registrationNumber}',
  '{latitude}',
  '{longitude}',
];

console.log('\nPlaceholder verification:');
for (const placeholder of placeholders) {
  const count = (verifyXml.match(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g')) || []).length;
  console.log(`  ${placeholder}: ${count} occurrences`);
}
