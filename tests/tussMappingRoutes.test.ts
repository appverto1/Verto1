import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import express from 'express';
import { registerTussMappingRoutes } from '../services/tussMappingRoutes';

const serverSource = readFileSync('server.ts', 'utf8');
const call = 'registerTussMappingRoutes(app, {';
assert.equal(serverSource.split(call).length, 2, 'one registration only');
assert.ok(serverSource.indexOf(call) < serverSource.indexOf("app.get('/api/admin/tuss/prices'"), 'route registration ordering');

const app = express();
app.use(express.json());
const clinic = '10000000-1000-4000-8000-100000000001';
const payer = '20000000-2000-4000-8000-200000000002';
let queryCount = 0;
let mutationCount = 0;
let invalidAuthHits = 0;
const mkQuery = () => {
  const q: any = {
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    in() { return this; }, update() { mutationCount++; return this; }, insert() { mutationCount++; return this; },
    maybeSingle: async () => ({ data: null, error: null }),
    then(resolve: any, reject: any) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
  };
  return q;
};
const deps: any = new Proxy({
  checkAuth: (req: any, res: any, next: any) => {
    if (req.headers['x-test-auth'] === 'deny') { invalidAuthHits++; return res.status(401).json({ error: 'UNAUTHORIZED' }); }
    req.session = { user: { id: 'actor', clinicId: req.headers['x-test-clinic'] || clinic } };
    next();
  },
  requireClinicModule: () => (req: any, _res: any, next: any) => next(),
  requireClinicCapability: () => (req: any, res: any, next: any) =>
    req.headers['x-test-capability'] === 'deny' ? res.status(403).json({ error: 'FORBIDDEN' }) : next(),
  portalActionLimiter: (_req: any, _res: any, next: any) => next(),
  sanitizeString: (value: any, max = 240) => String(value || '').trim().slice(0, max),
  currentClinicId: (user: any) => String(user?.clinicId || ''),
  isUuid: (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  payerSafeError: (status: number) => ({ success: false, error: 'ERROR_' + status }),
  parseBoundedListLimit: () => 100,
  supabase: { from(table: string) { assert.equal(table, 'payer_tuss_mappings'); queryCount++; return mkQuery(); } },
  PAYER_TUSS_MAPPING_SELECT: 'id',
  hasMissingFinancialSchema: () => false,
  TUSS_SERVICE_CATALOG_SELECT: 'id',
  TUSS_CODE_SELECT: 'id',
  serializePayerTussMapping: (row: any) => row,
  enforcePayloadLimit: () => true,
  normalizeTissCivilDate: (v: string) => v,
  guideTypes040300: [{ code: 'sp_sadt' }],
  tussValidityRangeIsValid: () => true,
  fetchPayerForAdmin: async () => null,
  fetchTussServiceCatalogById: async () => null,
  fetchTussCodeById: async () => null,
  fetchPayerTussMappingById: async () => null,
  tussConfigurationScopeIsConsistent: () => true,
  cleanObject: (x: any) => x,
  crypto: await import('node:crypto'),
  sanitizeTextField: (x: any) => String(x),
  normalizeTussBillingUnit: (x: any) => x,
  normalizeTussQuantityRule: (x: any) => x,
  mergePayerTussMappingCodeMetadata: () => ({}),
  isTussUniqueConflict: () => false,
  markTissPreGuidesStale: async () => null,
  collectTissPipelineAffectedFutureAppointmentIds: async () => [],
  runTissPipelineForAppointments: async () => [],
  revalidateAppointmentBillingForAppointment: async () => ({ ok: true }),
}, { get(target, key) { if (!(key in target)) throw new Error('Undeclared dependency: ' + String(key)); return (target as any)[key]; } });

registerTussMappingRoutes(app, deps);
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const url = 'http://127.0.0.1:' + address.port;
async function request(method: string, path: string, options: { headers?: Record<string, string>; body?: any } = {}) {
  const response = await fetch(url + path, { method, headers: { 'content-type': 'application/json', ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: await response.json() as any };
}
try {
  const good = await request('GET', '/api/admin/tuss/mappings?limit=10');
  assert.equal(good.status, 200); assert.deepEqual(good.body, { success: true, data: [] }); assert.equal(queryCount, 1);
  const wrongClinic = await request('GET', '/api/admin/tuss/mappings', { headers: { 'x-test-clinic': 'attacker-clinic' } });
  assert.equal(wrongClinic.status, 400); assert.equal(wrongClinic.body.error, 'ERROR_400');
  const unauth = await request('GET', '/api/admin/tuss/mappings', { headers: { 'x-test-auth': 'deny' } });
  assert.equal(unauth.status, 401); assert.equal(invalidAuthHits, 1);
  const denied = await request('POST', '/api/admin/tuss/mappings', { headers: { 'x-test-capability': 'deny' }, body: { payerId: payer } });
  assert.equal(denied.status, 403);
  const badInput = await request('POST', '/api/admin/tuss/mappings', { body: { payerId: payer, serviceCatalogId: 'invalid' } });
  assert.equal(badInput.status, 400);
  const invalidGuide = await request('POST', '/api/admin/tuss/mappings', { body: { payerId: payer, serviceCatalogId: clinic, guideType: 'invalid', validFrom: '2026-01-01' } });
  assert.equal(invalidGuide.status, 422); assert.equal(invalidGuide.body.code, 'TUSS_MAPPING_GUIDE_TYPE_UNSUPPORTED');
  const absent = await request('PATCH', '/api/admin/tuss/mappings/' + payer, { body: {} });
  assert.equal(absent.status, 404);
  const invalidPatch = await request('PATCH', '/api/admin/tuss/mappings/attacker-id', { body: {} });
  assert.equal(invalidPatch.status, 400);
  const rejected = await request('PATCH', '/api/admin/tuss/mappings/' + payer, { headers: { 'x-test-capability': 'deny' }, body: {} });
  assert.equal(rejected.status, 403);
  assert.equal(mutationCount, 0, 'negative tests never write');
  assert.equal(queryCount, 1, 'only valid GET performs one read; invalid scope never reaches DB');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}
console.log('tussMappingRoutes.test.ts: 9 HTTP + route order/security/persistence guards passed');
