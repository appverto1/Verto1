import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as normalized from '../services/reminderValueNormalization';
import * as cron from '../services/cronService';

const baseline = '43a4d5ee3540072c2daa701cd381f321a7b38111';
const source = execFileSync('git', ['show', baseline + ':services/cronService.ts'], { encoding: 'utf8' });
const current = readFileSync('services/cronService.ts', 'utf8');
const extracted = readFileSync('services/reminderValueNormalization.ts', 'utf8');
const begin = source.indexOf('const sanitizeText = ');
const end = source.indexOf('const hasResponse = ', begin);
assert.ok(begin > 0 && end > begin);
const originalBody = source.slice(begin, end);
const expected = originalBody.replace(
  /^const (sanitizeText|sanitizeEmail|isUuid|isGenericClinicNotificationName|sanitizeClinicNotificationLogoUrl) = /gm,
  'export const $1 = '
);
assert.ok(extracted.endsWith(expected), 'literal code parity except exports');
assert.ok(extracted.includes('const UUID_REGEX = /^[0-9a-f]'), 'original UUID validation preserved');
assert.ok(!current.includes('const sanitizeText = '), 'helper removed from original module');
assert.ok(!current.includes('const UUID_REGEX = '), 'UUID regex moved without duplication');
assert.match(current, /from '.\/reminderValueNormalization'/);
for (const key of ['extractReminderMissingColumnName', 'extractReminderClinicLogoStoragePath', 'isActiveAppointmentStatus'] as const) {
  assert.strictEqual(cron[key], normalized[key], 'public exported API identity: ' + key);
}
assert.equal(normalized.sanitizeText(null), '');
assert.equal(normalized.sanitizeText('  clinic  ', 4), 'clin');
assert.equal(normalized.sanitizeEmail('  TEST@EXAMPLE.COM '), 'test@example.com');
assert.equal(normalized.sanitizeEmail('not-an-email'), '');
assert.equal(normalized.isUuid('00000000-0000-4000-8000-000000000001'), true);
assert.equal(normalized.isUuid('javascript:alert(1)'), false);
assert.equal(normalized.extractReminderMissingColumnName({ message: 'column "patient_email" does not exist' }), 'patient_email');
assert.equal(normalized.extractReminderClinicLogoStoragePath('patient-photos/clinics/logo.png'), 'clinics/logo.png');
assert.equal(normalized.extractReminderClinicLogoStoragePath('/api/storage/patient-photos/view?path=clinic%2Flogo.png'), 'clinic/logo.png');
assert.equal(normalized.isGenericClinicNotificationName('Clínica Verto'), true);
assert.equal(normalized.sanitizeClinicNotificationLogoUrl('javascript:alert(1)'), '');
assert.equal(normalized.isActiveAppointmentStatus('cancelled'), false);
assert.equal(normalized.isActiveAppointmentStatus('scheduled'), true);
console.log('reminderValueNormalization.test.ts: PASS');
