import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import { patientPlanReadManifest as manifest } from './helpers/patientPlanReadSource.mjs';
const historical = execFileSync('git', ['cat-file', 'blob', manifest.originalBlob], { encoding: 'utf8', maxBuffer: 12_000_000 });
const id = '11111111-1111-4111-8111-111111111111', clinic = '22222222-2222-4222-8222-222222222222';
const clean = value => JSON.parse(JSON.stringify(value));
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-15T12:00:00.000Z'])); } static now() { return 1792065600000; } }
function compile(source, deps = {}) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports, module: { exports }, Date: FixedDate, process: { env: { NODE_ENV: 'test' } }, console: { log() {}, warn() {}, error() {}, info() {} }, ...deps };
  vm.runInNewContext(js, context, { timeout: 5000 }); return context.module.exports;
}
const modules = new Map([...new Set(manifest.routes.map(r => r.module))].map(name => [name, compile(readFileSync(`services/${name}.ts`, 'utf8'))]));
function fixture(route, mode, includePortalProfile = false) {
  const calls = [], error = mode === 'db-error' ? { message: 'DB_UNAVAILABLE' } : mode === 'schema-missing' ? { code: '42P01', message: 'missing relation' } : null;
  function query(table) {
    const chain = new Proxy({}, { get(_target, method) {
      if (method === 'then') return resolve => resolve({ data: [], error, count: 0 });
      return (...args) => { calls.push([table, String(method), clean(args)]); return method === 'maybeSingle' || method === 'single' ? Promise.resolve({
        data: includePortalProfile && table === 'patients' && !error
          ? { patient_profile_type: 'ADULT', panel_type: 'ADULT', type: 'adult_conventional', patient_group: 'adulto', age: 35 }
          : null,
        error,
      }) : chain; };
    } }); return chain;
  }
  const str = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
  const fetched = async params => { const { supabase, logger, ...safe } = params; calls.push(['fetch', clean(safe)]); return { data: [], error }; };
  const deps = {
    sanitizeString: str, sanitizeTextField: str, sanitizeEmail: str,
    isUuid: value => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value)),
    currentClinicId: () => clinic,
    supabase: { from(table) { calls.push(['from', table]); return query(table); }, rpc(name, args) { calls.push(['rpc', name, clean(args)]); return Promise.resolve({ data: [], error }); } },
    resolveCanonicalPatientPortalScope: async () => mode === 'portal-denied' ? null : { patientId: id, clinicId: clinic },
    parseBoundedListLimit: (_value, fallback) => fallback,
    fetchHistoryWithSchemaFallback: fetched, fetchAssignedTasksWithSchemaFallback: fetched, fetchTasksWithSchemaFallback: fetched,
    fetchPatientFilesWithSchemaFallback: fetched, fetchNotesWithRoleFilter: fetched,
    filterNotesForActor: rows => rows, filterPatientFilesForActor: async ({ rows }) => rows || [],
    isMissingRelationError: () => mode === 'schema-missing', hasMissingFinancialSchema: () => mode === 'schema-missing',
    isResponsiblePortalRole: () => false,
    readPatientRecordPayloadForFiles: async () => ({}), buildPatientFilesFromPayload: async () => [],
    normalizePatientFileStorageUsage: value => value || {}, readPatientFileStorageUsage: async () => ({ data: null, error: null }),
    normalizePatientFileAccessScope: () => 'clinic', isPatientFileVisibleToPortal: () => false,
    loadClinicalNoteMentionUserIdsByNote: async () => new Map(),
    composePatientProfessionalLinks: () => [], isPatientProfessionalLinkManager: () => false,
    requestIdForLogs: () => 'fixture-request', logRouteDbError: () => {},
    sendRouteDbError: (res, _route, _error) => res.status(500).json({ success: false, error: 'DB_ERROR' }),
    crypto: { randomUUID: () => id }, uuidFromStableString: () => id,
    cleanObject: value => value, asSafeNumber: value => Number(value),
    updatePatientStatusIfNeeded: async user => { calls.push(['status', clean(user)]); return 'active'; },
    buildSessionUserPayload: user => user,
    resolveHistoricalTherapeuticPlanReadCutoff: () => mode === 'history-denied' ? null : { updatedAt: '2026-10-15T12:00:00.000Z', exclusiveCivilEndAt: '2026-10-16T00:00:00.000Z' },
    normalizePtsClinicalPayload: () => ({ goals: [], risks: [], objectives: [] }),
    filterTherapeuticPlanScopesForActor: rows => rows, resolveTherapeuticPlanScopeAccess: () => ({ canEdit: false, reason: 'fixture' }),
    filterTherapeuticPlanProgramsForActor: rows => rows, isTherapeuticPlanManager: () => false,
    normalizeClinicalSpecialty: str, isAbaV2ApiEnabled: () => true,
    applyAbaChartTenantScope: q => q.eq('clinic_id', clinic),
    filterClinicalGraphPlanScopesForActor: rows => rows, canEditTherapeuticPlanScope: () => false,
    isClinicalPlanV3ReaderUnavailable: () => false, normalizeClinicalPlanOutcomesV3ForDashboard: () => [],
    mergeClinicalOutcomeRowsV3First: () => ({ rows: [], deduplicatedLegacyCount: 0 }),
  };
  for (const key of route.deps) if (!(key in deps)) deps[key] = /^[A-Z_]+$/.test(key) ? (key.endsWith('ROLES') ? [] : 'fixture-columns') : () => { throw Error('Missing fixture ' + key); };
  const req = { params: { patientId: mode === 'invalid-id' ? 'invalid' : id }, query: mode === 'bad-range' ? { dateFrom: 'invalid', dateTo: '2026-10-15' } : {}, session: { save: callback => { calls.push(['session-save']); callback(); }, user: { id, clinicId: clinic, role: route.module === 'patientPortalRecordReadHandlers' ? 'patient' : 'therapist' } }, headers: {}, patientProfessionalHistoricalReadOnly: mode.startsWith('history-') };
  const response = { code: 200, body: null, headers: {} };
  const res = { status(code) { response.code = code; return res; }, json(body) { response.body = body; return res; }, setHeader(key, value) { response.headers[key] = value; return res; } };
  return { deps, req, res, response, calls };
}
let scenarios = 0;
for (const route of manifest.routes) {
  for (const mode of ['empty', 'invalid-id', 'db-error', 'schema-missing', 'portal-denied', 'history-denied', 'history-valid', 'bad-range']) {
    const isPortalHistory = route.name === 'createPatientSelfHistoryReadHandler';
    const before = fixture(route, mode), after = fixture(route, mode, isPortalHistory); let captured = 0;
    const old = compile('module.exports = ' + historical.slice(route.start, route.end), before.deps);
    const next = modules.get(route.module)[route.name](() => { captured++; return after.deps; });
    assert.equal(captured, 0); await old(before.req, before.res); await next(after.req, after.res); assert.equal(captured, 1);
    if (isPortalHistory && after.response.body?.success === true) {
      // Only the selected clinic-scoped patient's portal mode is new.
      // Existing clinical history fields and status must be unchanged.
      const { portalProfile, ...originalBody } = after.response.body;
      assert.deepEqual(clean(portalProfile), {
        patientId: id, clinicId: clinic,
        patient_profile_type: 'ADULT', panel_type: 'ADULT', type: 'adult_conventional',
        patient_group: 'adulto', age: 35,
      }, route.name + ': ' + mode + ' authenticated portal profile');
      assert.deepEqual(clean({ ...after.response, body: originalBody }), clean(before.response),
        route.name + ': ' + mode + ' historical HTTP fields');
    } else {
      assert.deepEqual(clean(after.response), clean(before.response), route.name + ': ' + mode + ' HTTP');
    }
    if (isPortalHistory && mode !== 'portal-denied') {
      // One new read via the already-requested history HTTP response; never
      // choose a patient by shared guardian email or change original reads.
      const extraRead = [
        ['from', 'patients'],
        ['patients', 'select', ['patient_profile_type,panel_type,type,patient_group,age']],
        ['patients', 'eq', ['id', id]],
        ['patients', 'eq', ['clinic_id', clinic]],
        ['patients', 'is', ['deleted_at', null]],
        ['patients', 'maybeSingle', []],
      ];
      const first = after.calls.findIndex(call => call[0] === 'from' && call[1] === 'patients');
      assert.ok(first >= 0, route.name + ': ' + mode + ' canonical read required');
      assert.deepEqual(clean(after.calls.slice(first, first + extraRead.length)), clean(extraRead),
        route.name + ': ' + mode + ' patient + clinic scope');
      const unchangedCalls = after.calls.filter((_call, index) => index < first || index >= first + extraRead.length);
      assert.deepEqual(clean(unchangedCalls), clean(before.calls), route.name + ': ' + mode + ' original DB/helper sequence');
    } else {
      assert.deepEqual(clean(after.calls), clean(before.calls), route.name + ': ' + mode + ' exact DB/helper sequence');
    }
    if (mode === 'empty') assert.equal(after.response.code, 200, `${route.name}: ${JSON.stringify(after.response.body)}`);
    if (mode === 'portal-denied' && route.module === 'patientPortalRecordReadHandlers') { assert.equal(after.response.code, 409); assert.equal(after.calls.length, 0); }
    if (mode === 'history-denied' && route.name === 'createTherapeuticPlanReadHandler') { assert.equal(after.response.code, 403); assert.equal(after.calls.length, 0); }
    scenarios++;
  }
}
for (const route of manifest.routes) {
  const deniedStages = ['auth', ...(route.header.includes('requireClinicCapability') ? ['capability'] : []), ...(route.header.includes('checkPatientAccess') ? ['patient'] : []), ...(route.header.includes('requireRoles') ? ['role'] : []), ...(route.header.includes('requireAbaV2Feature') ? ['feature'] : [])];
  for (const denied of deniedStages) {
    let chain, reached = false, code = 200;
    const res = { status(value) { code = value; return res; }, json() { return res; } };
    const guard = stage => (_req, response, next) => stage === denied ? response.status(stage === 'auth' ? 401 : 403).json({}) : next();
    vm.runInNewContext(route.header + 'handler);', { app: { get(_path, ...handlers) { chain = handlers; } }, checkAuth: guard('auth'), checkPatientAccess: guard('patient'), requireClinicCapability: () => guard('capability'), requireClinicCapabilityOrPatientPortal: () => guard('capability'), requireRoles: () => guard('role'), requireAbaV2Feature: guard('feature'), noStoreDynamicResponse: (_req, _res, next) => next(), handler: () => { reached = true; } });
    let position = 0; const next = () => chain[position++]({}, res, next); next();
    assert.equal(reached, false); assert.equal(code, denied === 'auth' ? 401 : 403); scenarios++;
  }
}
console.log(`Patient/plan reads: ${scenarios} differential/authorization scenarios PASS`);
