import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createReminderClinicLogoAssetsService } from '../services/reminderClinicLogoAssets';
import { createAppointmentReminderBrandingService } from '../services/appointmentReminderBranding';

const clinicId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sanitize = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);
const deps = {
  sanitizeText: sanitize,
  isUuid: (value: unknown) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value ?? '')),
  extractReminderClinicLogoStoragePath: (value: unknown) =>
    typeof value === 'string' && !/^https?:\/\//.test(value) ? value.trim() : '',
  sanitizeClinicNotificationLogoUrl: sanitize,
};
const assets = createReminderClinicLogoAssetsService(deps);
const legacy = createAppointmentReminderBrandingService({
  ...deps,
  extractReminderMissingColumnName: () => '',
  isGenericClinicNotificationName: () => false,
  defaultClinicName: 'Clínica',
  cacheTtlMs: 60_000,
});
const prevSecret = process.env.SESSION_SECRET;
const prevAppBase = process.env.VERTO_APP_BASE_URL;
const prevBase = process.env.APP_BASE_URL;
try {
  process.env.SESSION_SECRET = ' session-signing-test-secret ';
  process.env.VERTO_APP_BASE_URL = 'https://staging.example.org/';
  delete process.env.APP_BASE_URL;
  const path = 'clinics/clinic-logo.png';
  const normalizedSecret = 'session-signing-test-secret';
  const expectedSig = crypto.createHmac('sha256', normalizedSecret).update(`${clinicId}:${path}`).digest('hex');
  const built = assets.buildStableClinicNotificationLogoUrl(clinicId, path);
  assert.ok(built);
  const parsed = new URL(built);
  assert.equal(parsed.origin, 'https://staging.example.org');
  assert.equal(parsed.pathname, '/api/public/notification-assets/clinic-logo');
  assert.equal(parsed.searchParams.get('clinic_id'), clinicId);
  assert.equal(parsed.searchParams.get('path'), path);
  assert.equal(parsed.searchParams.get('signature'), expectedSig);
  assert.equal(legacy.buildStableClinicNotificationLogoUrl(clinicId, path), built);
  const signed = { clinicId, storagePath: path, signature: expectedSig };
  assert.equal(assets.verifyStableClinicNotificationLogoSignature(signed), true);
  assert.equal(legacy.verifyStableClinicNotificationLogoSignature(signed), true);
  assert.equal(assets.verifyStableClinicNotificationLogoSignature({ ...signed, signature: expectedSig.toUpperCase() }), true);
  assert.equal(assets.verifyStableClinicNotificationLogoSignature({ ...signed, signature: '0'.repeat(64) }), false);
  assert.equal(assets.verifyStableClinicNotificationLogoSignature({ ...signed, signature: 'bad' }), false);
  assert.equal(assets.verifyStableClinicNotificationLogoSignature({ ...signed, storagePath: path + '/altered' }), false);
  assert.equal(assets.verifyStableClinicNotificationLogoSignature({ ...signed, clinicId: 'not-uuid' }), false);
  assert.equal(assets.buildStableClinicNotificationLogoUrl('not-uuid', path), null);
  assert.equal(assets.buildStableClinicNotificationLogoUrl(clinicId, '../secrets'), null);
  assert.equal(assets.verifyStableClinicNotificationLogoSignature({ ...signed, storagePath: '../secrets' }), false);

  process.env.VERTO_APP_BASE_URL = 'http://localhost:3000';
  assert.equal(assets.buildStableClinicNotificationLogoUrl(clinicId, path), null);
  delete process.env.VERTO_APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://alternative.example.org/';
  assert.equal(new URL(assets.buildStableClinicNotificationLogoUrl(clinicId, path)!).origin, 'https://alternative.example.org');
  delete process.env.APP_BASE_URL;
  assert.equal(new URL(assets.buildStableClinicNotificationLogoUrl(clinicId, path)!).origin, 'https://www.appverto.com.br');

  const warnings: any[] = [];
  const logger = { log() {}, warn(...args: any[]) { warnings.push(args); }, error() {} };
  const options = { supabase: null, logger };
  assert.equal(await assets.resolvePushSafeClinicLogoUrl(options, [path], clinicId),
    assets.buildStableClinicNotificationLogoUrl(clinicId, path));
  assert.equal(await assets.resolvePushSafeClinicLogoUrl(options, ['https://cdn.example.org/logo.png'], clinicId),
    'https://cdn.example.org/logo.png');
  assert.equal(await assets.resolvePushSafeClinicLogoUrl(options, ['../invalid'], clinicId), null);
  assert.equal(warnings.length, 0);

  delete process.env.SESSION_SECRET;
  assert.equal(assets.buildStableClinicNotificationLogoUrl(clinicId, path), null);
  assert.equal(assets.verifyStableClinicNotificationLogoSignature(signed), false);
  assert.equal(await assets.resolvePushSafeClinicLogoUrl(options, [path], clinicId), null);
  assert.equal(warnings.length, 1, 'Missing signing secret should log and not leak storage path');
  console.log('reminderClinicLogoAssets.test: PASS');
} finally {
  if (prevSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prevSecret;
  if (prevAppBase === undefined) delete process.env.VERTO_APP_BASE_URL; else process.env.VERTO_APP_BASE_URL = prevAppBase;
  if (prevBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prevBase;
}
