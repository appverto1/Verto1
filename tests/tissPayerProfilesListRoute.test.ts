import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';
import { registerTissPayerProfilesListRoute } from '../services/tissPayerProfilesListRoute';

const source = readFileSync('server.ts', 'utf8');
const marker = 'registerTissPayerProfilesListRoute(app, {';
assert.equal(source.split(marker).length, 2, 'exactly one registration');
assert.ok(source.indexOf(marker) < source.indexOf("app.get('/api/admin/tiss/payer-profiles/:payerId'"), 'original route order');
assert.ok(!source.includes("app.get('/api/admin/tiss/payer-profiles',"), 'no duplicated original route');

const clinicOne = '10000000-1000-4000-8000-000000000001';
const clinicTwo = '20000000-1000-4000-8000-000000000002';
const queries: Array<{ table: string; select?: string; predicates: unknown[]; order?: unknown[]; limit?: number }> = [];
const queued: Array<{ data: unknown; error: any }> = [];
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const app = express();
registerTissPayerProfilesListRoute(app, {
  noStoreDynamicResponse: (_req: any, res: any, next: any) => { res.setHeader('Cache-Control', 'no-store'); next(); },
  checkAuth: (req: any, res: any, next: any) => {
    if (req.headers['x-test-auth'] === 'deny') return res.status(401).json({ error: 'UNAUTHORIZED' });
    req.session = { user: { id: 'actor', clinicId: req.headers['x-test-clinic'] || clinicOne } };
    next();
  },
  requireClinicModule: (module: string) => {
    assert.equal(module, 'insurance_tiss');
    return (req: any, res: any, next: any) =>
      req.headers['x-test-module'] === 'deny' ? res.status(403).json({ error: 'MODULE_DENIED' }) : next();
  },
  requireClinicCapability: (capability: string) => {
    assert.equal(capability, 'billing.mapping.manage');
    return (req: any, res: any, next: any) =>
      req.headers['x-test-capability'] === 'deny' ? res.status(403).json({ error: 'CAPABILITY_DENIED' }) : next();
  },
  sanitizeString: (value: unknown, max: number) => String(value ?? '').trim().slice(0, max),
  currentClinicId: (user: any) => user?.clinicId,
  isUuid: uuid,
  payerSafeError: (status: number) => ({ success: false, error: 'ERROR_' + status }),
  supabase: {
    from(table: string) {
      assert.equal(table, 'payer_tiss_profiles');
      const record: { table: string; select?: string; predicates: unknown[]; order?: unknown[]; limit?: number } = {
        table, predicates: [],
      };
      queries.push(record);
      const q: any = {
        select(value: string) { record.select = value; return this; },
        eq(...args: unknown[]) { record.predicates.push(args); return this; },
        order(...args: unknown[]) { record.order = args; return this; },
        limit(value: number) { record.limit = value; return this; },
        then(resolve: any, reject: any) {
          assert.ok(queued.length > 0, 'one configured response per DB query');
          return Promise.resolve(queued.shift()).then(resolve, reject);
        }
      };
      return q;
    }
  },
  PAYER_TISS_PROFILE_SELECT: 'full_columns',
  PAYER_TISS_PROFILE_BASE_SELECT: 'legacy_columns',
  PAYER_TISS_PROFILE_OPTIONAL_REVIEW_COLUMNS: ['review_column'],
  extractMissingColumnName: (err: any) => err?.column || null,
  hasMissingFinancialSchema: (err: any) => err?.code === 'SCHEMA_MISSING',
  isMissingRelationError: (err: any) => err?.code === 'TABLE_MISSING',
  sendNoStoreJson: (res: any, payload: unknown) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(payload);
  },
});
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const url = 'http://127.0.0.1:' + address.port + '/api/admin/tiss/payer-profiles';
async function request(headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers });
  return { response, body: await response.json() as any };
}
try {
  for (const [key, expected] of [['x-test-auth', 401], ['x-test-module', 403], ['x-test-capability', 403]] as const) {
    const result = await request({ [key]: 'deny' });
    assert.equal(result.response.status, expected);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    assert.equal(queries.length, 0, 'denied request cannot reach Supabase');
  }
  const invalid = await request({ 'x-test-clinic': 'invalid-id' });
  assert.equal(invalid.response.status, 400);
  assert.deepEqual(invalid.body, { success: false, error: 'ERROR_400' });
  assert.equal(queries.length, 0);
  for (const [clinic, id] of [[clinicOne, 'payer-one'], [clinicTwo, 'payer-two']]) {
    queued.push({ data: [{ id }], error: null });
    const r = await request({ 'x-test-clinic': clinic, 'x-forged-clinic-id': clinic === clinicOne ? clinicTwo : clinicOne });
    assert.equal(r.response.status, 200);
    assert.deepEqual(r.body, { success: true, data: [{ id }] });
    const q = queries.at(-1)!;
    assert.deepEqual(q.predicates, [['organization_id', clinic], ['active', true]], 'DB filter uses session tenant');
    assert.equal(q.select, 'full_columns');
    assert.equal(q.limit, 500);
  }
  queued.push({ data: null, error: { column: 'review_column' } }, { data: [{ id: 'legacy' }], error: null });
  const beforeFallback = queries.length;
  const fallback = await request();
  assert.equal(fallback.response.status, 200);
  assert.deepEqual(fallback.body, { success: true, data: [{ id: 'legacy' }] });
  assert.equal(queries.length - beforeFallback, 2);
  assert.equal(queries.at(-1)!.select, 'legacy_columns');
  queued.push({ data: null, error: { code: 'TABLE_MISSING' } });
  const missing = await request();
  assert.equal(missing.response.status, 200);
  assert.deepEqual(missing.body, { success: true, data: [] });
  queued.push({ data: null, error: { column: 'review_column' } }, { data: null, error: { code: 'SCHEMA_MISSING' } });
  const missingFallback = await request();
  assert.equal(missingFallback.response.status, 200);
  assert.deepEqual(missingFallback.body, { success: true, data: [] });
  queued.push({ data: null, error: { code: 'OTHER_ERROR', message: 'test failure' } });
  const failure = await request();
  assert.equal(failure.response.status, 500);
  assert.deepEqual(failure.body, { success: false, error: 'ERROR_500' });
  assert.equal(queued.length, 0);
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}
console.log('tissPayerProfilesListRoute: auth, module, capability, clinic isolation, schema fallback, HTTP paths passed');
