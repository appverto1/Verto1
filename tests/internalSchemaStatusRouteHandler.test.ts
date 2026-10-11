import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createInternalSchemaStatusHandler } from '../services/internalSchemaStatusRouteHandler';

const serverText = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const registration = "app.get('/api/internal/schema-status', checkAuth, checkPlatformAdmin, createInternalSchemaStatusHandler({ refreshAppointmentActionResolutionSchema, APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION }))";
assert.ok(serverText.includes(registration), 'protected registration must retain its middleware order');
assert.equal(serverText.split("app.get('/api/internal/schema-status'").length - 1, 1);
assert.ok(serverText.indexOf("app.get('/api/health/details'") < serverText.indexOf(registration));
assert.ok(serverText.indexOf(registration) < serverText.indexOf("app.post('/api/auth/2fa/setup'"));

let probeCalls = 0;
const forceValues: boolean[] = [];
let checkedAt: number | null = Date.parse('2026-10-11T17:00:00.000Z');
const app = express();
app.get('/api/internal/schema-status',
  (req, res, next) => {
    if (req.headers['x-test-auth'] !== 'yes') { res.status(401).json({ error: 'SESSION_REQUIRED' }); return; }
    next();
  },
  (req, res, next) => {
    if (req.headers['x-test-platform-admin'] !== 'yes') { res.status(403).json({ error: 'PLATFORM_ADMIN_REQUIRED' }); return; }
    next();
  },
  createInternalSchemaStatusHandler({
    refreshAppointmentActionResolutionSchema: async (force: boolean) => {
      probeCalls += 1;
      forceValues.push(force);
      return {
        approvalReady: true,
        availabilityReady: false,
        schemaVersion: 'runtime.v2',
        reason: 'MIGRATION_PENDING',
        approvalReason: 'MISSING_FUNCTION',
        stage: 'schema-check',
        retryable: false,
        checkedAt,
        ttlMs: 60_000,
      };
    },
    APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION: 'expected.v3',
  }),
);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const url = 'http://127.0.0.1:' + address.port + '/api/internal/schema-status';
try {
  let response = await fetch(url);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'SESSION_REQUIRED' });
  response = await fetch(url, { headers: { 'x-test-auth': 'yes' } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'PLATFORM_ADMIN_REQUIRED' });
  assert.equal(probeCalls, 0, 'no schema diagnostics for unauthorized users');
  const authorizedHeaders = { 'x-test-auth': 'yes', 'x-test-platform-admin': 'yes' };
  response = await fetch(url, { headers: authorizedHeaders });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: {
      reschedule: {
        ready: true,
        availabilityReady: false,
        approvalReady: true,
        expectedVersion: 'expected.v3',
        actualVersion: 'runtime.v2',
        reason: 'MIGRATION_PENDING',
        approvalReason: 'MISSING_FUNCTION',
        stage: 'schema-check',
        retryable: false,
        checkedAt: '2026-10-11T17:00:00.000Z',
        nextCheckAt: '2026-10-11T17:01:00.000Z',
      },
    },
  });
  response = await fetch(url + '?refresh=false', { headers: authorizedHeaders });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.deepEqual(forceValues, [false, true], 'Boolean(req.query?.refresh) semantics must remain unchanged');
  checkedAt = null;
  response = await fetch(url + '?refresh=1', { headers: authorizedHeaders });
  const body = await response.json();
  assert.equal(body.data.reschedule.checkedAt, null);
  assert.equal(body.data.reschedule.nextCheckAt, null);
  assert.equal(probeCalls, 3);
} finally {
  server.close();
  server.closeAllConnections();
}
console.log('internalSchemaStatusRouteHandler.test.ts: PASS');
