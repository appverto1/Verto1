import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');

test('IA-02 does not print express-session identifiers or raw login email', () => {
  assert.doesNotMatch(server, /\breq\.sessionID\b/, 'Express session ID must not be logged or serialized by login');
  assert.doesNotMatch(server, /\[Auth\] Saving session for/, 'Legacy authentication PII log must stay removed');
  assert.doesNotMatch(server, /Session ID:\s*\$\{/, 'Do not reintroduce interpolated session ID logs');
});

test('IA-02 retains the existing server-authoritative login session save', () => {
  const start = server.indexOf('const loginResponse = { success: true, user: sessionUser, isFirstLogin:');
  assert.ok(start >= 0, 'Keep the original login success response and role context');
  const loginSave = server.slice(start, start + 2800);
  assert.match(loginSave, /req\.session\.save\(async \(err\) => \{/);
  assert.match(loginSave, /if \(requiresDistributedRuntimeState\(\)\)/);
  assert.match(loginSave, /await saveExpressSession\(req\)/);
  assert.match(loginSave, /res\.json\(loginResponse\)/);
  assert.doesNotMatch(loginSave, /console\.log\(/);
});
