import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  clean, hasEnvironmentHint, parseHttpUrl, vapidPublicKeyFingerprint,
} from '../services/deploymentEnvironmentHelpers';
import {
  validateVertoDeploymentConfiguration,
  vapidPublicKeyFingerprint as publicFingerprint,
} from '../services/deploymentEnvironment';

assert.strictEqual(publicFingerprint, vapidPublicKeyFingerprint, 'Existing public API must be re-exported identically');
assert.equal(clean(undefined), '');
assert.equal(clean(null), '');
assert.equal(clean('  abcdef  ', 3), 'abc');
assert.equal(clean(false), 'false');
assert.equal(clean('  STAGING '), 'STAGING');

for (const raw of ['', '  ', 'a', ' public-key ', 'x'.repeat(3000), '🐈'.repeat(1000)]) {
  const canonical = raw.trim().slice(0, 2000);
  const expected = canonical ? crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24) : null;
  assert.equal(vapidPublicKeyFingerprint(raw), expected, 'Fingerprint changed');
}
for (const [raw, expected] of [
  ['https://example.com/a?x=1', 'https://example.com/a?x=1'],
  [' http://localhost:8000/ ', 'http://localhost:8000/'],
  ['ftp://example.com/', null],
  ['javascript:alert(1)', null],
  ['/relative', null],
  ['http://[', null],
  ['', null],
  [null, null],
] as const) {
  assert.equal(parseHttpUrl(raw)?.toString() ?? null, expected, 'URL acceptance changed');
}
assert.equal(hasEnvironmentHint('PREVIEW.mydomain.com', ['preview', 'stage']), true);
assert.equal(hasEnvironmentHint('production.example', ['preview', 'stage']), false);
assert.equal(hasEnvironmentHint(null, ['stage']), false);
assert.equal(hasEnvironmentHint('staging-xyz', ['stage']), false, 'Preserve exact substring matching');
assert.equal(hasEnvironmentHint('stage-xyz', ['stage']), true);

const stagingEnv = {
  VERTO_DEPLOYMENT_ENV: 'staging',
  VERTO_APP_BASE_URL: 'https://staging.example.invalid',
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  SUPABASE_EXPECTED_PROJECT_REF: 'test-project',
  VAPID_PUBLIC_KEY: ' public-key ',
} as NodeJS.ProcessEnv;
const staging = validateVertoDeploymentConfiguration({ env: stagingEnv, requireEnvironment: true });
assert.equal(staging.ok, true);
assert.equal(staging.appHost, 'staging.example.invalid');
assert.equal(staging.vapidPublicKeyFingerprint, vapidPublicKeyFingerprint('public-key'));
assert.equal(validateVertoDeploymentConfiguration({ env: { ...stagingEnv, VERTO_DEPLOYMENT_ENV: 'production' }, requireEnvironment: true }).ok, false);
assert.equal(validateVertoDeploymentConfiguration({ env: { ...stagingEnv, RAILWAY_ENVIRONMENT_NAME: 'production' }, requireEnvironment: true }).ok, false);
assert.equal(validateVertoDeploymentConfiguration({ env: { ...stagingEnv, VERTO_APP_BASE_URL: 'ftp://example.invalid' }, requireEnvironment: true }).ok, false);
assert.equal(validateVertoDeploymentConfiguration({ env: { ...stagingEnv, VERTO_DEPLOYMENT_ENV: '' }, requireEnvironment: true }).ok, false);
assert.equal(validateVertoDeploymentConfiguration({ env: { ...stagingEnv, VERTO_DEPLOYMENT_ENV: 'production', VERTO_APP_BASE_URL: 'https://app.example.invalid', RAILWAY_ENVIRONMENT_NAME: 'production' }, requireEnvironment: true }).ok, true);
console.log('deploymentEnvironmentHelpers.test: PASS');
