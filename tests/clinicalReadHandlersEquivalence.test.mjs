import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import { clinicalReadManifest as manifest } from './helpers/clinicalReadSource.mjs';

const historical = execFileSync('git', ['cat-file', 'blob', manifest.originalBlob], { encoding: 'utf8', maxBuffer: 12_000_000 });
const id = '11111111-1111-4111-8111-111111111111';
const clinicId = '22222222-2222-4222-8222-222222222222';
const normalize = value => JSON.parse(JSON.stringify(value));
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-15T12:00:00.000Z'])); }
  static now() { return 1792065600000; }
}
function compile(source, context = {}) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const sandbox = { exports, module: { exports }, Date: FixedDate, process: { env: { NODE_ENV: 'test' } }, console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, ...context };
  vm.runInNewContext(js, sandbox, { timeout: 5000 });
  return sandbox.module.exports;
}
const modules = new Map([...new Set(manifest.routes.map(r => r.module))].map(name => [name, compile(readFileSync(`services/${name}.ts`, 'utf8'))]));

function environment(route, mode) {
  const trace = [];
  const missing = mode === 'missing-schema';
  const error = mode === 'database-error' ? { message: 'DB_UNAVAILABLE' } : missing ? { code: '42P01', message: 'relation missing' } : null;
  function query(table) {
    const chain = new Proxy({}, { get(_target, method) {
      if (method === 'then') return resolve => resolve({ data: error ? null : [], error, count: 0 });
      return (...args) => {
        trace.push([table, String(method), ...args]);
        if (method === 'maybeSingle' || method === 'single') return Promise.resolve({ data: error ? null : (mode.startsWith('audit-') ? { id, patient_id: id, session_id: id } : null), error });
        return chain;
      };
    } });
    return chain;
  }
  const strings = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
  const deps = {
    sanitizeString: strings, sanitizeTextField: strings,
    isUuid: value => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value)),
    currentClinicId: () => clinicId,
    currentClinicTimeZone: () => 'America/Sao_Paulo',
    hasGlobalClinicAccess: () => false,
    hasMissingFinancialSchema: () => missing, isMissingRelationError: () => missing,
    resolveAbaSessionReadScope: async (...args) => {
      trace.push(['scope', ...args]);
      return mode === 'foreign-session' ? { ok: false, status: 403, error: 'SESSION_SCOPE_DENIED' } : { ok: true, patientId: id, clinicId, session: { id, patient_id: id, clinic_id: clinicId, reference_date: '2026-10-15' } };
    },
    supabase: { from(table) { trace.push(['from', table]); return query(table); } },
    parseAbaPageParams: () => ({ page: 1, pageSize: 20, from: 0, to: 19 }),
    parseAbaRecordListLimit: () => 20,
    applyAbaTenantScope: q => q.eq('clinic_id', clinicId),
    resolveMaintenanceProbeAvailability: () => ({availableNow:[],availableItems:[],upcomingItems:[]}),
    dateKeyInMaintenanceTimeZone: () => '2026-10-15',
    getPatientPeiTargets: async () => [],
    parsePatientPeiArray: () => [],
    readPatientRecordPayloadForFiles: async () => ({}),
    materializePeiTargetsForMaintenance: async params => { trace.push(['materialize', params]); return {targets:[], peiTargets:[]}; },
    enrichMaintenanceRowsWithTargetDisplay: async rows => rows,
    fetchFutureAppointmentsForMaintenance: async () => [],
    countCalendarMaintenanceProbesByAppointment: async () => new Map(),
    fetchNextMaintenanceProbeForTarget: async () => null,
    canAccessPatientInCurrentClinic: async () => mode !== 'foreign-session',
    enrichTherapeuticRecommendationContexts: async rows => rows,
    persistActivityLog: async value => { trace.push(['audit', value]); return mode !== 'audit-denied'; },
    parseStoredJsonObject: value => value || {},
    cleanObject: value => value,
    sanitizeClinicalPayload: value => value,
    readMaintenanceStoredPayload: () => ({}),
    normalizeAbaMaintenanceScheduleStatus: value => value,
    normalizeAbaPlanItemStatus: value => value,
  };
  for (const name of route.deps) {
    if (name in deps) continue;
    if (/^[A-Z_]+$/.test(name)) deps[name] = name.endsWith('STATUSES') ? ['active'] : `fixture:${name}`;
    else deps[name] = () => { throw new Error(`Unmocked dependency: ${name}`); };
  }
  const req = { params: { patientId: mode === 'invalid-id' ? 'not-a-uuid' : id, sessionId: mode === 'invalid-id' ? '' : id, targetId: id }, query: { patientId: id }, session: { user: { id, clinicId, role: 'therapist' } }, headers: {} };
  const response = { status: 200, body: null, headers: {} };
  const res = { setHeader(key, value) { response.headers[key] = value; return res; }, status(code) { response.status = code; return res; }, json(body) { response.body = body; return res; } };
  return { deps, req, res, trace, response };
}

let scenarios = 0;
for (const route of manifest.routes) {
  const oldArrow = historical.slice(route.start, route.end);
  for (const mode of ['empty', 'invalid-id', 'foreign-session', 'database-error', 'missing-schema']) {
    const old = environment(route, mode), next = environment(route, mode);
    const oldHandler = compile('module.exports = ' + oldArrow, old.deps);
    let reads = 0;
    const handler = modules.get(route.module)[route.name](() => { reads++; return next.deps; });
    assert.equal(reads, 0, 'dependency capture remains lazy');
    await oldHandler(old.req, old.res);
    await handler(next.req, next.res);
    assert.equal(reads, 1, 'one dependency snapshot per request');
    assert.deepEqual(normalize(next.response), normalize(old.response), `${route.path}: ${mode} HTTP contract`);
    assert.deepEqual(normalize(next.trace), normalize(old.trace), `${route.path}: ${mode} exact query/helper calls`);
    if (mode === 'empty') assert.equal(next.response.status, 200, `${route.name}: empty canonical data works ${JSON.stringify(next.response.body)}`);
    if (mode === 'foreign-session' && route.deps.includes('resolveAbaSessionReadScope')) {
      assert.equal(next.response.status, 403);
      assert.ok(!next.trace.some(item => item[0] === 'from'), 'denied session never queries clinical data');
    }
    scenarios++;
  }
}

const report = manifest.routes.find(r => r.name === 'createAbaSessionReportReadHandler');
for (const mode of ['audit-allowed', 'audit-denied']) {
  const old = environment(report, mode), next = environment(report, mode);
  await compile('module.exports = ' + historical.slice(report.start, report.end), old.deps)(old.req, old.res);
  await modules.get(report.module)[report.name](() => next.deps)(next.req, next.res);
  assert.deepEqual(normalize(next.response), normalize(old.response));
  assert.deepEqual(normalize(next.trace), normalize(old.trace));
  assert.equal(next.response.status, mode === 'audit-denied' ? 503 : 200, 'immutable audit failure stays fail-closed');
  scenarios++;
}

// Evaluate the actual registration headers to retain feature/auth/capability/
// patient-scope guard order. Stubs only choose a denial; handler code must stay idle.
for (const route of manifest.routes) {
  for (const denied of ['feature', 'auth', 'capability', ...(route.header.includes('checkPatientAccess') ? ['patient'] : [])]) {
    let chain, reached = false;
    const response = { status: 200, body: null };
    const res = { status(code) { response.status = code; return res; }, json(body) { response.body = body; return res; } };
    const guard = key => (_req, response, next) => denied === key ? response.status(key === 'auth' ? 401 : 403).json({ denied: key }) : next();
    vm.runInNewContext(route.header + 'handler);', {
      app: { get(_path, ...handlers) { chain = handlers; } },
      requireAbaV2Feature: guard('feature'), requireAbaCollectionFeature: guard('feature'),
      checkAuth: guard('auth'), requireClinicCapability: () => guard('capability'),
      checkPatientAccess: guard('patient'), handler: () => { reached = true; },
    });
    let position = 0;
    const next = () => chain[position++]({}, res, next);
    next();
    assert.equal(reached, false, `${route.path}: ${denied} denied before handler/dependency/DB access`);
    assert.equal(response.status, denied === 'auth' ? 401 : 403);
    scenarios++;
  }
}
console.log(`Clinical read handlers: ${scenarios} original/extracted differential scenarios PASS`);
