// @ts-nocheck -- isolated handler fixtures without database writes or credentials
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createClinicProtocolImportsReadHandler } from '../services/protocolImportClinicHandlers.ts';

const source = readFileSync('services/protocolImportClinicHandlers.ts', 'utf8');
const clinicId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const row = {
  id: '33333333-3333-4333-8333-333333333333',
  protocol_name: 'Protocolo de teste',
  file_name: 'evidencias.png',
  status: 'pending',
  suggested_canonical_key: 'key-test',
  suggested_canonical_name: 'Teste',
  suggested_confidence: 0.8,
  approved_canonical_key: null,
  approved_canonical_name: null,
  applicable_age_group: 'child',
  age_min: '2',
  age_max: '12',
  created_at: '2026-11-13T10:00:00Z',
  reviewed_at: null,
};

function fixture({ scopeClinic = clinicId, responseRow = row } = {}) {
  const selected = [];
  const filters = [];
  let called = 0;
  const builder = {
    select(columns) { selected.push(columns); return this; },
    gte(column, value) { filters.push(['gte', column, value]); return this; },
    order(column, opts) { filters.push(['order', column, opts.ascending]); return this; },
    limit(value) { filters.push(['limit', value]); return this; },
    eq(column, value) { filters.push(['eq', column, value]); return this; },
    then(resolve, reject) { return Promise.resolve({ data: [responseRow], error: null }).then(resolve, reject); },
  };
  const deps = {
    applyNoStoreHeaders: () => {},
    sanitizeString: (value, max = 120) => String(value ?? '').slice(0, max),
    currentClinicId: () => scopeClinic,
    VERTO_PROTOCOL_PANEL_RESET_AT: '2026-01-01T00:00:00Z',
    isUuid: (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
    isProd: true,
    supabase: { from(table) { assert.equal(table, 'protocol_import_requests'); ++called; return builder; } },
    PROTOCOL_IMPORT_REQUEST_SELECT: 'SHOULD_NOT_BE_USED',
    parseStoredJsonObject: () => { throw new Error('BIG_REPORT_SHOULD_NOT_BE_MATERIALIZED'); },
    asSafeNumber: (value, min, max) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; },
    extractSupabaseErrorMessage: () => '',
    loadProtocolAccessMap: async () => new Map(),
    buildProtocolAccessScopeKeys: () => [],
    VERTO_PROTOCOL_BY_KEY: new Map(),
    normalizeApprovedProtocolKey: (value) => String(value ?? ''),
    identifyVertoProtocolCandidate: () => ({ canonicalKey: '' }),
    redactForLogs: (value) => value,
    sendNoStoreJson: (_res, body) => body,
  };
  const handler = createClinicProtocolImportsReadHandler(() => deps);
  const req = { session: { user: { id: userId, email: 'test@example.invalid' } } };
  return { run: () => handler(req, {}), metrics: () => ({ selected, filters, called }) };
}

test('clinic select projects only tiny metadata and scalar JSON values, not screenshots', () => {
  const projection = source.match(/const PROTOCOL_IMPORT_CLINIC_LIST_SELECT = \[([\s\S]*?)\]\.join\(','\);/)?.[1] ?? '';
  assert.ok(projection);
  for (const alias of [
    'applicable_age_group:scan_report->evidence->>applicableAgeGroup',
    'age_min:scan_report->evidence->>ageMin',
    'age_max:scan_report->evidence->>ageMax',
  ]) assert.ok(projection.includes(alias));
  assert.doesNotMatch(projection, /'scan_report'|'file_data_url'|\*|raw_file_access/);
  assert.match(source, /\.select\(PROTOCOL_IMPORT_CLINIC_LIST_SELECT\)/);
});

test('clinic list retains shape, age defaults and clinic-scoped pagination', async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(result, {
    success: true,
    data: [{
      id: row.id, protocolName: row.protocol_name, fileName: row.file_name,
      status: 'pending', canonicalKey: row.suggested_canonical_key,
      canonicalName: row.suggested_canonical_name, confidence: 0.8,
      applicableAgeGroup: 'child', ageMin: 2, ageMax: 12,
      createdAt: row.created_at, reviewedAt: null,
    }],
  });
  const { selected, filters, called } = f.metrics();
  assert.equal(called, 1);
  assert.equal(selected.length, 1);
  assert.ok(selected[0].includes('applicable_age_group:scan_report->evidence->>applicableAgeGroup'));
  assert.ok(!/(^|,)scan_report(,|$)/.test(selected[0]));
  assert.ok(!selected[0].includes('file_data_url'));
  assert.ok(filters.some(([op, field, value]) => op === 'eq' && field === 'clinic_id' && value === clinicId));
  assert.ok(filters.some(([op, limit]) => op === 'limit' && limit === 50));
  assert.ok(filters.some(([op, column, ascending]) => op === 'order' && column === 'created_at' && ascending === false));
});

test('clinic list retains requester fallback, without unscoped data access', async () => {
  const f = fixture({ scopeClinic: null });
  await f.run();
  assert.ok(f.metrics().filters.some(([op,field,val]) => op === 'eq' && field === 'requester_user_id' && val === userId));
});

test('missing age values preserve existing all/zero/null defaults', async () => {
  const f = fixture({ responseRow: { ...row, applicable_age_group: null, age_min: null, age_max: null } });
  const result = await f.run();
  assert.deepEqual(result.data[0], {
    id: row.id, protocolName: row.protocol_name, fileName: row.file_name,
    status: 'pending', canonicalKey: row.suggested_canonical_key,
    canonicalName: row.suggested_canonical_name, confidence: 0.8,
    applicableAgeGroup: 'all', ageMin: 0, ageMax: null,
    createdAt: row.created_at, reviewedAt: null,
  });
});
