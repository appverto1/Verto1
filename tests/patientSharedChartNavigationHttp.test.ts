import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { registerPatientSharedChartRoutes } from '../services/patientSharedChartRoutes';

const clinicId = '11111111-1111-4111-8111-111111111111';
const otherClinicId = '99999999-9999-4999-8999-999999999999';
const patientId = '33333333-3333-4333-8333-333333333333';
const otherPatientId = '44444444-4444-4444-8444-444444444444';
const actorId = '22222222-2222-4222-8222-222222222222';

let criticalWrites = 0;
let projectionReads = 0;
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  const role = String(req.headers['x-role'] || 'director');
  req.session = { user: { id: actorId, role, clinicId: req.headers['x-clinic'] || clinicId } };
  req.authorizationContext = { capabilities: new Set(['reports.clinical.indicators']) };
  next();
});
const supabase = {
  rpc: async (name: string, params: any) => {
    if (name === 'patient_shared_chart_case_authority_v1') {
      const allowed = params.p_actor_id === actorId && params.p_clinic_id === clinicId
        && params.p_patient_id === patientId;
      return { data: { canPublish: allowed, canDelegate: allowed }, error: null };
    }
    if (name === 'patient_file_actor_has_patient_access_v1') return { data: false, error: null };
    criticalWrites++;
    return { data: null, error: { code: 'UNEXPECTED_WRITE' } };
  },
  from: () => {
    projectionReads++;
    throw new Error('INVALID_DESCRIPTOR_MUST_BE_REJECTED_BEFORE_DB_READ');
  },
};
registerPatientSharedChartRoutes(app, {
  supabase,
  checkAuth: (_req: any, _res: any, next: any) => next(),
  requireAnyClinicCapability: () => (_req: any, _res: any, next: any) => next(),
  noStoreDynamicResponse: (_req: any, _res: any, next: any) => next(),
  portalActionLimiter: (_req: any, _res: any, next: any) => next(),
  enforcePayloadLimit: () => true,
  sanitizeString: (value: unknown, max = 120) => String(value ?? '').trim().slice(0, max),
  currentClinicId: (user: any) => String(user?.clinicId || ''),
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = (server.address() as any).port;

const primary = {
  schemaVersion: 1,
  family: 'PLAN_PTS',
  domain: 'skills',
  metricSignature: 'TARGET_ACCURACY::%::higher_is_better::::1',
  seriesKeys: ['11111111-1111-4111-8111-111111111111::target::accuracy'],
  axis: 'date',
  comparePrevious: false,
};
const overview = {
  schemaVersion: 1,
  family: 'PLAN_PTS',
  domain: 'overview',
  metricSignature: 'TARGET_ACCURACY::%::higher_is_better::::1',
  planIds: ['55555555-5555-4555-8555-555555555555'],
  seriesKeys: [],
  axis: 'date',
  comparePrevious: false,
};

async function request(descriptor: any, id = patientId, clinic = clinicId) {
  return fetch(`http://127.0.0.1:${port}/api/patients/${id}/shared-chart-selection`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-clinic': clinic },
    body: JSON.stringify({ descriptor }),
  });
}
try {
  const invalid: any[] = [
    { ...primary, allowedDomains: ['skills'] }, // current domain duplicated
    { ...primary, allowedDomains: ['behaviors', 'behaviors'] },
    { ...primary, allowedDomains: ['behaviors', 'private'] },
    { ...primary, allowedDomains: 'behaviors' },
    { ...primary, allowedDomains: ['behaviors', 'mastery', 'maintenance', 'skills'] },
    { ...primary, planIds: overview.planIds }, // non-overview cannot supply plans
    { ...overview, planIds: [] },
    { ...overview, planIds: ['not-a-uuid'] },
    { ...overview, planIds: [...overview.planIds, ...overview.planIds] },
    { ...overview, seriesKeys: primary.seriesKeys },
  ];
  for (const [index, descriptor] of invalid.entries()) {
    const response = await request(descriptor);
    assert.equal(response.status, 400, `forged chart navigation/plan descriptor ${index}`);
    assert.equal((await response.json()).error, 'SHARED_CHART_DESCRIPTOR_INVALID');
  }
  assert.equal((await request(primary, otherPatientId)).status, 403, 'other patient ID denied');
  assert.equal((await request(primary, patientId, otherClinicId)).status, 403, 'cross-clinic actor denied');
  assert.equal(criticalWrites, 0, 'invalid and IDOR requests must never write clinical sharing state');
  assert.equal(projectionReads, 0, 'invalid references must be rejected before reading clinical data');
  console.log('patientSharedChartNavigationHttp.test.ts: PASS');
} finally {
  server.close();
  await once(server, 'close');
}
