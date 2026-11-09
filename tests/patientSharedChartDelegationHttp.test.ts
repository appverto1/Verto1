import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { registerPatientSharedChartRoutes } from '../services/patientSharedChartRoutes';

const clinicId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const patientId = '33333333-3333-4333-8333-333333333333';
const otherPatientId = '44444444-4444-4444-8444-444444444444';
const professionalId = '55555555-5555-4555-8555-555555555555';
let writes = 0;
let currentActorRole = '';
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  const actor = req.headers['x-test-actor'];
  if (actor) req.session = { user: { id: actorId, clinicId, role: actor } };
  currentActorRole = String(actor || '');
  next();
});
const supabase = {
  rpc: async (name: string, params: any) => {
    if (name === 'patient_file_actor_has_patient_access_v1') {
      return { data: params.p_actor_id === actorId && params.p_clinic_id === clinicId
        && params.p_patient_id === patientId, error: null };
    }
    if (name === 'patient_shared_chart_case_authority_v1') {
      const inScope = params.p_actor_id === actorId && params.p_clinic_id === clinicId
        && params.p_patient_id === patientId;
      const isLead = inScope && currentActorRole === 'director';
      return { data: { canDelegate: isLead, canPublish: isLead }, error: null };
    }
    if (name === 'set_patient_shared_chart_case_delegation_v2') {
      if (currentActorRole !== 'director' || params.p_actor_id !== actorId || params.p_clinic_id !== clinicId
          || params.p_patient_id !== patientId || params.p_professional_id !== professionalId) {
        return { data: null, error: { code: '42501', message: 'SHARED_CHART_CASE_LEAD_REQUIRED' } };
      }
      writes++;
      return { data: true, error: null };
    }
    return { data: null, error: { code: 'P0TEST', message: 'unexpected RPC: ' + name } };
  }
};
const checkAuth = (req: any, res: any, next: any) =>
  req.session?.user ? next() : res.status(401).json({ error: 'UNAUTHENTICATED' });
const requireAnyClinicCapability = (..._keys: string[]) =>
  (req: any, res: any, next: any) =>
    req.headers['x-test-capability'] === 'yes' ? next() : res.status(403).json({ error: 'CAPABILITY_REQUIRED' });
registerPatientSharedChartRoutes(app, {
  supabase, checkAuth, requireAnyClinicCapability,
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
  'http://127.0.0.1:' + port + '/api/patients/' + id + '/shared-chart/delegations';
const post = (id: string, headers: Record<string, string>, payload: object) =>
  fetch(endpoint(id), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload) });
const payload = { professionalId, allow: true };
try {
  let response = await post(patientId, {}, payload);
  assert.equal(response.status, 401);
  response = await post(patientId, { 'x-test-actor': 'director' }, payload);
  assert.equal(response.status, 403, 'capability gate');
  const headers = { 'x-test-actor': 'director', 'x-test-capability': 'yes' };
  response = await post(otherPatientId, headers, payload);
  assert.equal(response.status, 403, 'cross-patient request denied before write');
  response = await post(patientId, headers, { professionalId: 'bad-id', allow: true });
  assert.equal(response.status, 400);
  response = await post(patientId, headers, { professionalId, allow: 'true' });
  assert.equal(response.status, 400, 'only booleans allowed');
  response = await post(patientId, { 'x-test-actor': 'therapist', 'x-test-capability': 'yes' }, payload);
  assert.equal(response.status, 403, 'case professional without grant cannot delegate');
  assert.equal(writes, 0, 'rejected requests must never mutate');
  response = await post(patientId, headers, payload);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(writes, 1, 'authorized Save runs exactly one RPC');
} finally {
  server.close();
  server.closeAllConnections();
}
console.log('patientSharedChartDelegationHttp.test.ts: PASS');
