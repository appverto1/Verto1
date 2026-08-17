import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260817001500_patient_files_docx_support.sql', import.meta.url), 'utf8');

const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
assert.ok(server.includes('word/document.xml'));
assert.match(server, /vbaProject/);
assert.ok(server.includes(docxMime), 'server must support DOCX MIME');
assert.ok(server.includes("fileBuffer.length > 10 * 1024 * 1024"), 'server must keep 10 MB hard limit');
assert.ok(dataService.includes("'.docx': '" + docxMime + "'"), 'client must normalize DOCX MIME by extension');
assert.ok(dataService.includes("originalSize > 10 * 1024 * 1024"), 'client must enforce 10 MB before upload');
assert.ok(patientDetail.includes('.docx'), 'patient file picker must expose DOCX');
assert.ok(migration.includes(docxMime), 'storage bucket must allow DOCX');
assert.ok(migration.includes('10485760'), 'storage bucket must preserve 10 MB limit');
console.log('patientFileDocxUpload.test.mjs: PASS');
