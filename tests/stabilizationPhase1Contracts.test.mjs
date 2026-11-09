import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readModularServerSource();
const activation = readFileSync(new URL('../src/components/ActivationAccess.tsx', import.meta.url), 'utf8');
const railway = JSON.parse(readFileSync(new URL('../railway.json', import.meta.url), 'utf8'));

assert.match(server, /OTP_TABLE_UNAVAILABLE_RETRY_MS\s*=\s*15_000/);
assert.match(server, /ensureOtpTableAvailability\(force = false\)/);
assert.match(server, /markOtpTableAvailability\(false\)/);
assert.match(server, /error:\s*'PASSWORD_POLICY_INVALID'/);
assert.match(server, /error:\s*'RECOVERY_REQUEST_INVALID'/);
assert.match(activation, /validateRecoveryPassword/);
assert.match(activation, /passwordValidationError/);
assert.match(server, /app\.get\('\/api\/ready'/);
assert.match(server, /sessionPool\.query\('select 1'\)/);
assert.equal(railway.deploy.healthcheckPath, '/api/ready');
assert.match(server, /httpServer\.requestTimeout\s*=\s*120_000/);
assert.match(server, /process\.once\('SIGTERM'/);
assert.match(server, /sessionPool\.end\(\)/);

console.log('stabilizationPhase1Contracts.test.mjs: ok');
