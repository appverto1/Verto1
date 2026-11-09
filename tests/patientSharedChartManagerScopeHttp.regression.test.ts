import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { registerPatientSharedChartRoutes } from '../services/patientSharedChartRoutes';

const clinicId = '11111111-1111-4111-8111-111111111111';
const otherClinicId = '99999999-9999-4999-8999-999999999999';
const actorId = '22222222-2222-4222-8222-222222222222';
const patientId = '33333333-3333-4333-8333-333333333333';
const otherPatientId = '44444444-4444-4444-8444-444444444444';
let role = '';
let reads = 0;
let caseChecks = 0;
let fileChecks = 0;
let clearWrites = 0;
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  role = String(req.headers['x-test-role'] || '');
  if (role) {
    req.session = {
      user: {
        id: actorId,
        role,
        clinicId: String(req.headers['x-test-clinic'] || clinicId),
      },
    };
  }
  next();
});
const chain: any = {
  select: () => chain,
  eq: () => chain,
  limit: () => chain,
  maybeSingle: async () => {
    reads++;
    return { data: null, error: null };
  },
};
const supabase = {
  from: (table: string) => {
    assert.equal(table, 'patient_shared_chart_selections');
    return chain;
  },
  rpc: async (name: string, params: any) => {
    const liveScope = params.p_actor_id === actorId && params.p_clinic_id === clinicId
      && params.p_patient_id === patientId;
    if (name === 'patient_shared_chart_case_authority_v1') {
      caseChecks++;
      const leader = liveScope && ['director', 'coordinator', 'supervisor'].includes(role);
      return { data: { canPublish: leader, canDelegate: leader }, error: null };
    }
    if (name === 'patient_file_actor_has_patient_access_v1') {
      fileChecks++;
      return { data: liveScope && role === 'therapist', error: null };
    }
    if (name === 'clear_patient_shared_chart_selection_v2') {
      assert.equal(liveScope, true, 'DB mutation must be scoped to the real clinic and patient');
      assert.ok(['director', 'coordinator', 'supervisor'].includes(role));
      clearWrites++;
      return { data: true, error: null };
    }
    return { data: null, error: { code: 'P0TEST', message: 'unexpected RPC ' + name } };
  },
};
const checkAuth = (req: any, res: any, next: any) =>
  req.session?.user ? next() : res.status(401).json({ error: 'UNAUTHENTICATED' });
const capability = () => (req: any, res: any, next: any) =>
  req.headers['x-test-capability'] === 'yes'
    ? next() : res.status(403).json({ error: 'CAPABILITY_REQUIRED' });
registerPatientSharedChartRoutes(app, {
  supabase, checkAuth, requireAnyClinicCapability: capability,
  noStoreDynamicResponse: (_req: any, _res: any, next: any) => next(),
  portalActionLimiter: (_req: any, _res: any, next: any) => next(),
  enforcePayloadLimit: () => true,
  sanitizeString: (value: any, max = 120) => String(value ?? '').trim().slice(0, max),
  currentClinicId: (user: any) => user?.clinicId || null,
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = (server.address() as any).port;
const endpoint = (id: string) =>
  'http://127.0.0.1:' + port + '/api/patients/' + id + '/shared-chart-selection';
const request = (id: string, actor: string, method = 'GET', clinic = clinicId, enabled = true) =>
  fetch(endpoint(id), {
    method,
    headers: {
      ...(actor ? { 'x-test-role': actor } : {}),
      ...(enabled ? { 'x-test-capability': 'yes' } : {}),
      'x-test-clinic': clinic,
    },
  });

try {
  let response = await request(patientId, '');
  assert.equal(response.status, 401);
  response = await request(patientId, 'director', 'GET', clinicId, false);
  assert.equal(response.status, 403, 'capability required regardless of role');

  for (const manager of ['director', 'coordinator', 'supervisor']) {
    const previousCaseChecks = caseChecks;
    const previousFileChecks = fileChecks;
    response = await request(patientId, manager);
    assert.equal(response.status, 200, manager + ' must read chart management state');
    const payload = await response.json();
    assert.deepEqual(payload.governance, { canPublish: true, canDelegate: true });
    assert.equal(caseChecks, previousCaseChecks + 1, 'reuse case authority inside GET');
    assert.equal(fileChecks, previousFileChecks, 'case authority must not require the unrelated file policy');
    response = await request(patientId, manager, 'DELETE');
    assert.equal(response.status, 200, manager + ' must be allowed to clear a published chart');
  }
  assert.equal(clearWrites, 3);

  response = await request(patientId, 'therapist');
  assert.equal(response.status, 200, 'ordinary case professional keeps read-only governance');
  assert.deepEqual((await response.json()).governance, { canPublish: false, canDelegate: false });
  assert.equal(fileChecks, 1, 'read-only fallback uses existing file access check');
  response = await request(patientId, 'therapist', 'DELETE');
  assert.equal(response.status, 403, 'nondelegated professional cannot clear a chart');
  assert.equal(clearWrites, 3);

  response = await request(otherPatientId, 'director');
  assert.equal(response.status, 403, 'patient IDOR blocked');
  response = await request(patientId, 'director', 'DELETE', otherClinicId);
  assert.equal(response.status, 403, 'clinic IDOR blocked');
  response = await request(otherPatientId, 'supervisor', 'DELETE');
  assert.equal(response.status, 403, 'supervisor without case must be denied');
  response = await request('not-a-uuid', 'director');
  assert.equal(response.status, 403, 'malformed ID denied');
  assert.equal(clearWrites, 3, 'all unauthorized requests must leave the database unchanged');
  assert.ok(reads >= 3, 'authorized GET reads its clinic-scoped selection');
} finally {
  server.close();
  server.closeAllConnections();
}
console.log('patientSharedChartManagerScopeHttp.regression.test.ts: PASS');
