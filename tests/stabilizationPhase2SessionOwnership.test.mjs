import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../services/distributedRuntimeState.ts', import.meta.url), 'utf8');

assert.match(server, /validateDistributedSessionToken/);
assert.doesNotMatch(server, /validateOrClaimDistributedSessionToken/);
assert.match(server, /error: 'SERVER_SESSION_REQUIRED'/);
assert.match(server, /if \(requiresDistributedRuntimeState\(\)\) \{[\s\S]{0,500}SERVER_SESSION_REQUIRED/);
assert.match(runtime, /runtime_validate_active_session_v2/);
assert.doesNotMatch(runtime, /DISTRIBUTED_SESSION_CLAIM_FAILED/);
assert.doesNotMatch(runtime, /\.insert\(\[\{[\s\S]{0,400}runtime_active_sessions/);

console.log('stabilizationPhase2SessionOwnership.test.mjs: ok');
