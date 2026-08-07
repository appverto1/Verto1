import assert from 'node:assert/strict';
import fs from 'node:fs';

const checklist = fs.readFileSync('src/services/tissAntiGlosaChecklist.ts', 'utf8');
const engine = fs.readFileSync('src/services/tissPreGuideEngine.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

assert.match(checklist, /clinical_report_linked[\s\S]*clinicalEvidence\?\.reportPresent/);
assert.match(engine, /clinicalEvidence\?: Record<string, any> \| null/);
assert.match(engine, /clinicalEvidence: \{/);
assert.match(engine, /reportPresent: Boolean\(/);
assert.match(server, /from\('aba_session_summaries'\)[\s\S]*appointment_id/);
assert.match(server, /document_type', 'SESSION_REPORT'/);
assert.match(server, /clinicalReportPresent/);
assert.match(server, /clinicalEvidence/);

console.log('tissClinicalEvidence.regression: ok');
