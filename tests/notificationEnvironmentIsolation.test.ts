import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  matchesVertoDeploymentEnvironment,
  normalizeVertoDeploymentEnvironment,
  validateVertoDeploymentConfiguration,
  vapidPublicKeyFingerprint,
} from '../services/deploymentEnvironment.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260902170000_notification_environment_isolation.sql');
const pushService = read('services/pushNotificationService.ts');
const cronService = read('services/cronService.ts');
const server = read('server.ts');
const serviceWorker = read('public/sw.js');

const env = (overrides: Record<string, string | undefined> = {}) => ({
  VERTO_DEPLOYMENT_ENV: 'staging',
  VERTO_APP_BASE_URL: 'https://staging.example.invalid',
  SUPABASE_EXPECTED_PROJECT_REF: 'example-staging-ref',
  VAPID_PUBLIC_KEY: 'public-vapid-key-for-test',
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  ...overrides,
} as NodeJS.ProcessEnv);

// Canonical allowlist: no NODE_ENV/hostname inference can manufacture a namespace.
assert.equal(normalizeVertoDeploymentEnvironment('staging'), 'staging');
assert.equal(normalizeVertoDeploymentEnvironment('production'), 'production');
assert.equal(normalizeVertoDeploymentEnvironment('PRODUCTION'), 'production');
assert.equal(normalizeVertoDeploymentEnvironment('prod'), null);
assert.equal(normalizeVertoDeploymentEnvironment('development'), null);
assert.equal(normalizeVertoDeploymentEnvironment(undefined), null);

// 1/2/7/8: subscription/job defensive acceptance rejects the opposite environment and legacy NULL.
assert.equal(matchesVertoDeploymentEnvironment('production', 'staging'), false);
assert.equal(matchesVertoDeploymentEnvironment('staging', 'production'), false);
assert.equal(matchesVertoDeploymentEnvironment(null, 'staging'), false);
assert.equal(matchesVertoDeploymentEnvironment(undefined, 'production'), false);
assert.equal(matchesVertoDeploymentEnvironment('staging', 'staging'), true);
assert.equal(matchesVertoDeploymentEnvironment('production', 'production'), true);

// 6: missing/invalid/crossed deployment configuration fails closed in deploy mode.
assert.equal(validateVertoDeploymentConfiguration({ env: env({ VERTO_DEPLOYMENT_ENV: undefined }), requireEnvironment: true }).ok, false);
assert.equal(validateVertoDeploymentConfiguration({ env: env({ VERTO_DEPLOYMENT_ENV: 'prod' }), requireEnvironment: true }).ok, false);
assert.equal(validateVertoDeploymentConfiguration({ env: env({ VERTO_DEPLOYMENT_ENV: 'production', VERTO_APP_BASE_URL: 'https://staging.example.invalid' }), requireEnvironment: true }).ok, false);
assert.equal(validateVertoDeploymentConfiguration({ env: env({ VERTO_DEPLOYMENT_ENV: 'staging', VERTO_APP_BASE_URL: 'https://app.example.invalid', RAILWAY_ENVIRONMENT_NAME: 'production' }), requireEnvironment: true }).ok, false);
assert.equal(validateVertoDeploymentConfiguration({ env: env(), requireEnvironment: true }).ok, true);

const fingerprint = vapidPublicKeyFingerprint('public-vapid-key-for-test');
assert.match(String(fingerprint), /^[a-f0-9]{24}$/);
assert.notEqual(fingerprint, 'public-vapid-key-for-test');

// Persistent namespace exists on every delivery-owned table; legacy is deliberately not backfilled.
for (const table of ['push_subscriptions', 'notification_jobs', 'portal_notifications', 'clinic_announcements']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} add column if not exists deployment_env text`, 'i'));
}
assert.doesNotMatch(migration, /update\s+public\.(push_subscriptions|notification_jobs|portal_notifications|clinic_announcements)[\s\S]{0,200}set\s+deployment_env\s*=\s*['"](?:staging|production)['"]/i);
assert.match(migration, /NULL means legacy\/untrusted/i);

// Trust is established only by service_role + the non-secret backend header.
assert.match(migration, /request\.jwt\.claims/i);
assert.match(migration, /service_role/i);
assert.match(migration, /request\.headers/i);
assert.match(migration, /x-verto-deployment-env/i);
assert.match(server, /headers:\s*\{\s*'x-verto-deployment-env':\s*vertoDeploymentEnv\s*\}/);

// 1/2: every subscription selection path is explicitly environment-scoped.
assert.match(pushService, /from\('push_subscriptions'\)[\s\S]{0,220}eq\('deployment_env', deploymentEnv\)/);
assert.match(pushService, /select\('endpoint, p256dh, auth, subscription, patient_id, user_id, user_email, clinic_id, deployment_env'\)[\s\S]{0,100}eq\('deployment_env', deploymentEnv\)/);
assert.match(pushService, /select\(selectColumns\)[\s\S]{0,100}eq\('deployment_env', deploymentEnv\)/);
const removablePushColumnsBlock = pushService.slice(pushService.indexOf('const isRemovablePushColumn'), pushService.indexOf('const hashPushRenewalToken'));
assert.doesNotMatch(removablePushColumnsBlock, /['"]deployment_env['"]/);

// Endpoint/token uniqueness and renewal are environment-scoped, so the same endpoint may safely exist in both namespaces.
assert.match(migration, /unique index if not exists idx_push_subscriptions_env_endpoint[\s\S]{0,120}\(deployment_env, endpoint\)/i);
assert.match(migration, /unique index if not exists idx_push_subscriptions_env_renewal_token_hash[\s\S]{0,140}\(deployment_env, renewal_token_hash\)/i);
assert.match(migration, /renew_push_subscription_v1\([\s\S]{0,100}p_deployment_env text/i);
assert.match(migration, /where ps\.deployment_env = v_env[\s\S]{0,100}ps\.renewal_token_hash = p_renewal_token_hash/i);

// 3/4: stale recovery and atomic claims can only touch the current environment; SKIP LOCKED remains intact.
assert.match(migration, /claim_due_notification_jobs_v1\(p_deployment_env text, p_worker text/i);
assert.match(migration, /where deployment_env=v_env and status='CLAIMED'/i);
assert.match(migration, /where deployment_env=v_env and status='SCHEDULED' and scheduled_for <= now\(\)/i);
assert.match(migration, /for update skip locked/i);
assert.match(cronService, /claim_due_notification_jobs_v1[\s\S]{0,140}p_deployment_env: options\.deploymentEnv/);
assert.match(cronService, /matchesVertoDeploymentEnvironment\(job\?\.deployment_env, options\.deploymentEnv\)/);

// 5: idempotency uniqueness and generated keys are namespaced instead of global.
assert.match(migration, /unique index if not exists idx_notification_jobs_env_idempotency_v1[\s\S]{0,120}\(deployment_env, idempotency_key\)/i);
assert.match(migration, /verto_notification_idempotency_key_v1\(p_deployment_env text, p_key text\)/i);
assert.match(cronService, /`\$\{options\.deploymentEnv\}:notification-job:/);
assert.match(server, /`\$\{deploymentEnv\}:patient-finance:/);

// Portal/announcement materialization and reads are scoped too, including direct app endpoints.
assert.match(migration, /portal_notifications_env_idempotency_uidx[\s\S]{0,100}\(deployment_env, idempotency_key\)/i);
assert.match(migration, /claim_due_clinic_announcements_v1\(p_deployment_env text,p_worker_id text/i);
assert.match(migration, /materialize_clinic_announcement_portal_notifications_v1\(p_deployment_env text,p_announcement_id uuid\)/i);
assert.match(server, /from\('clinic_announcements'\)[\s\S]{0,220}eq\('deployment_env', deploymentEnv\)/);
assert.match(server, /from\('portal_notifications'\)[\s\S]{0,240}eq\('deployment_env', deploymentEnv\)/);

// Both worker services receive the canonical namespace at startup rather than NODE_ENV.
assert.match(server, /startAppointmentReminderCron\(\{[\s\S]{0,120}deploymentEnv: vertoDeploymentEnv/);
assert.match(server, /startClinicAnnouncementCron\(\{[\s\S]{0,120}deploymentEnv: vertoDeploymentEnv/);
assert.match(cronService, /VERTO_DEPLOYMENT_ENV ausente\/invalida[\s\S]{0,100}fail-closed/i);

// Diagnostic payload is non-secret and lets the receiving SW identify the origin environment.
assert.match(serviceWorker, /deploymentEnv:\s*payload\.data\?\.deploymentEnv\s*\|\|\s*payload\.deploymentEnv\s*\|\|\s*null/);
assert.doesNotMatch(serviceWorker, /VAPID_PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY/);

console.log('notificationEnvironmentIsolation.test.ts: OK');
