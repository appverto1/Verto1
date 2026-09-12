import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.VERTO_SOURCE_ROOT
  ? path.resolve(process.env.VERTO_SOURCE_ROOT)
  : path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const server = read('server.ts');
const migration = read('supabase/migrations/20260902170000_notification_environment_isolation.sql');

const count = (source, pattern) => [...source.matchAll(pattern)].length;

function extractBalancedCallObjects(source, functionName) {
  const results = [];
  const needle = `${functionName}({`;
  let cursor = 0;
  while (true) {
    const start = source.indexOf(needle, cursor);
    if (start < 0) break;
    const objectStart = start + functionName.length + 1;
    let depth = 0;
    let quote = null;
    let escaped = false;
    let templateDepth = 0;
    let end = -1;
    for (let i = objectStart; i < source.length; i += 1) {
      const ch = source[i];
      const next = source[i + 1];
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (quote === '`' && ch === '$' && next === '{') { templateDepth += 1; i += 1; continue; }
        if (quote === '`' && ch === '}' && templateDepth > 0) { templateDepth -= 1; continue; }
        if (ch === quote && templateDepth === 0) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    assert.notEqual(end, -1, `Unable to parse ${functionName} call at ${start}`);
    results.push(source.slice(start, end));
    cursor = end;
  }
  return results;
}

function statementAround(source, index) {
  const start = source.lastIndexOf(';', index) + 1;
  const semicolon = source.indexOf(';', index);
  const end = semicolon >= 0 ? semicolon + 1 : source.length;
  return source.slice(start, end);
}

function assertEveryCallReceivesCanonicalEnv(functionName, expectedCount = null) {
  const calls = extractBalancedCallObjects(server, functionName);
  if (expectedCount !== null) assert.equal(calls.length, expectedCount, `${functionName} call count changed`);
  assert.ok(calls.length > 0, `${functionName} must be called`);
  for (const call of calls) {
    assert.match(call, /deploymentEnv:\s*vertoDeploymentEnv\b/, `${functionName} call missing canonical deploymentEnv`);
  }
}

// One server-side authority, resolved from process.env only.
assert.match(server, /import\s*\{\s*requireVertoDeploymentEnvironment\s*\}\s*from\s*['"]\.\/services\/deploymentEnvironment['"]/);
assert.match(server, /const\s+vertoDeploymentEnv\s*=\s*requireVertoDeploymentEnvironment\(process\.env\)/);
assert.match(server, /const\s+deploymentEnv\s*=\s*vertoDeploymentEnv\s*;/);
assert.doesNotMatch(server, /(?:req|request)\.headers\s*\[\s*['"]x-verto-deployment-env['"]\s*\]/i);
assert.doesNotMatch(server, /(?:req|request)\.(?:body|query)\??\.(?:deploymentEnv|deployment_env)\b/i);

// Trusted header belongs only to Node -> Supabase service_role traffic.
assert.equal(count(server, /x-verto-deployment-env/g), 1, 'server must have exactly one trusted deployment header wiring point');
assert.match(server, /supabase\s*=\s*createClient\(supabaseUrl,\s*supabaseServiceKey,[\s\S]{0,500}global:\s*\{[\s\S]{0,160}headers:\s*\{\s*['"]x-verto-deployment-env['"]:\s*vertoDeploymentEnv\s*\}/);
assert.doesNotMatch(server, /supabaseAuthClient\s*=\s*createClient\([\s\S]{0,500}x-verto-deployment-env/);
assert.match(migration, /coalesce\(v_claims->>'role',\s*''\)\s*<>\s*'service_role'/i);
assert.match(migration, /v_headers->>'x-verto-deployment-env'/i);
assert.match(migration, /NOTIFICATION_DEPLOYMENT_ENV_REQUIRED/);
assert.match(migration, /NOTIFICATION_DEPLOYMENT_ENV_MISMATCH/);

// Every server caller of the environment-aware push APIs must receive the bootstrap authority.
assertEveryCallReceivesCanonicalEnv('savePatientPushSubscription', 1);
assertEveryCallReceivesCanonicalEnv('removePatientPushSubscription', 1);
assertEveryCallReceivesCanonicalEnv('renewPatientPushSubscription', 1);
assertEveryCallReceivesCanonicalEnv('sendAppointmentNotification', 3);

// Both workers and school routes receive the same authority.
assertEveryCallReceivesCanonicalEnv('startAppointmentReminderCron', 1);
assertEveryCallReceivesCanonicalEnv('startClinicAnnouncementCron', 1);
assert.match(server, /registerSchoolManagementRoutes\(app,\s*\{[\s\S]{0,180}deploymentEnv:\s*vertoDeploymentEnv\b/);

// Every direct portal_notifications access is either DB-filtered, or a direct write carrying
// the canonical environment into a trigger that revalidates it from the trusted request header.
const portalNeedle = ".from('portal_notifications')";
const portalIndexes = [];
for (let i = server.indexOf(portalNeedle); i >= 0; i = server.indexOf(portalNeedle, i + portalNeedle.length)) portalIndexes.push(i);
assert.ok(portalIndexes.length > 0, 'portal_notifications direct accesses must exist for this regression to be meaningful');
for (const index of portalIndexes) {
  const statement = statementAround(server, index);
  if (/\.(?:insert|upsert)\(/.test(statement)) {
    assert.match(statement, /notificationPayload/, 'direct portal write must use the environment-bearing notificationPayload');
    const prior = server.slice(Math.max(0, index - 1800), index);
    assert.match(prior, /const\s+notificationPayload\s*=\s*cleanObject\(\{[\s\S]{0,500}deployment_env:\s*deploymentEnv/, 'direct portal write payload must persist deployment_env');
    if (/\.upsert\(/.test(statement)) {
      assert.match(statement, /onConflict:\s*['"]deployment_env,idempotency_key['"]/, 'portal upsert conflict identity must be environment-scoped');
    }
  } else {
    assert.match(statement, /\.eq\(\s*['"]deployment_env['"]\s*,\s*deploymentEnv\s*\)/, `unscoped portal_notifications direct access:\n${statement.slice(0, 500)}`);
  }
}

// Every direct clinic_announcements access in server.ts is a scoped read; mutations are handled by protected RPC/worker paths.
const clinicNeedle = ".from('clinic_announcements')";
const clinicIndexes = [];
for (let i = server.indexOf(clinicNeedle); i >= 0; i = server.indexOf(clinicNeedle, i + clinicNeedle.length)) clinicIndexes.push(i);
assert.ok(clinicIndexes.length > 0, 'clinic_announcements direct accesses must exist for this regression to be meaningful');
for (const index of clinicIndexes) {
  const statement = statementAround(server, index);
  assert.match(statement, /\.eq\(\s*['"]deployment_env['"]\s*,\s*deploymentEnv\s*\)/, `unscoped clinic_announcements direct access:\n${statement.slice(0, 500)}`);
}
assert.match(server, /rpc\(['"]create_clinic_announcement_delivery_v3['"]/);
assert.match(migration, /create or replace function public\.create_clinic_announcement_delivery_v3[\s\S]{0,900}v_env text := public\.verto_request_deployment_env_v1\(\)/i);

// Finance reminder notification identity is separated by environment without changing payment identity itself.
assert.match(server, /const\s+idempotencyKey\s*=\s*`\$\{deploymentEnv\}:patient-finance:\$\{paymentId\}:reminder:/);

// NULL remains legacy/untrusted; this task must not introduce a production/staging fallback or backfill.
assert.match(migration, /NULL means legacy\/untrusted/i);
assert.doesNotMatch(migration, /update\s+public\.(?:push_subscriptions|notification_jobs|portal_notifications|clinic_announcements)[\s\S]{0,200}set\s+deployment_env\s*=\s*['"](?:staging|production)['"]/i);

console.log('notificationEnvironmentWiring.regression.test.mjs: OK');
