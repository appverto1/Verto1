import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const baseline = execFileSync('git', ['cat-file', 'blob', 'fae465718fcc65958b91f598ab25949ef87e7e31'], { encoding: 'utf8', maxBuffer: 8_000_000 });
const server = readFileSync('server.ts', 'utf8');
const source = readFileSync('services/abaRecommendationMutationHandlers.ts', 'utf8');
const specs = [
  ['post', '/api/aba/patients/:patientId/next-session/recommendations/generate', 'createAbaRecommendationsGenerateHandler', true],
  ['post', '/api/aba/recommendations/:recommendationId/accept', 'createAbaRecommendationAcceptHandler', false],
  ['post', '/api/aba/recommendations/:recommendationId/reject', 'createAbaRecommendationRejectHandler', false],
  ['post', '/api/aba/recommendations/:recommendationId/link-target', 'createAbaRecommendationLinkTargetHandler', false],
  ['patch', '/api/aba/recommendations/:recommendationId', 'createAbaRecommendationEditHandler', false],
  ['post', '/api/aba/recommendations/:recommendationId/apply-to-next-session', 'createAbaRecommendationApplyToNextSessionHandler', false]
];
assert.equal(server.split("from './services/abaRecommendationMutationHandlers';").length, 2, 'single import');
const registrations = [];
for (const [method, path, name, checkPatient] of specs) {
  const prefix = "  app." + method + "('" + path + "', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.suggestions.apply'), " + (checkPatient ? 'checkPatientAccess, ' : '');
  const oldHeader = prefix + 'async (req: any, res) => {';
  const begin = baseline.indexOf(oldHeader);
  const end = baseline.indexOf('\n  });', begin + oldHeader.length);
  assert.ok(begin >= 0 && end > begin, 'original handler: ' + path);
  const moduleBegin = source.indexOf('export function ' + name + '(getDeps: () => any) {');
  const bodyBegin = source.indexOf('\n    try {', moduleBegin);
  const bodyEnd = source.indexOf('\n  };', bodyBegin);
  assert.ok(moduleBegin >= 0 && bodyBegin > moduleBegin && bodyEnd > bodyBegin, 'new handler: ' + path);
  assert.equal(source.slice(bodyBegin, bodyEnd), baseline.slice(begin + oldHeader.length, end), 'literal business-logic parity: ' + path);
  assert.ok(!server.includes(oldHeader), 'inline handler removed: ' + path);
  const reg = prefix + name + '(() => ({';
  assert.equal(server.split(reg).length, 2, 'exact route and gate: ' + path);
  registrations.push(server.indexOf(reg));
}
assert.deepEqual(registrations, [...registrations].sort((a, b) => a - b), 'original route order');
assert.ok(server.indexOf("app.get('/api/aba/patients/:patientId/next-session/recommendations'") < registrations[0]);
assert.ok(registrations[5] < server.indexOf("app.get('/api/aba/patients/:patientId/next-session/plan-items'"));
assert.ok(!source.includes("from '../server'") && !source.includes('service_role'), 'no circular imports or secrets');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, console };
vm.runInNewContext(compiled, sandbox);
const handlers = specs.map(([, , name]) => sandbox.exports[name]);
handlers.forEach(handler => assert.equal(typeof handler, 'function'));
const ids = {
  clinic: '11111111-1111-4111-8111-111111111111',
  otherClinic: '99999999-9999-4999-8999-999999999999',
  patient: '22222222-2222-4222-8222-222222222222',
  recommendation: '33333333-3333-4333-8333-333333333333',
  target: '44444444-4444-4444-8444-444444444444',
  actor: '55555555-5555-4555-8555-555555555555'
};
const recommendation = { id: ids.recommendation, organization_id: ids.clinic, clinic_id: ids.clinic, patient_id: ids.patient, title: 'Título', priority: 'MEDIUM', recommendation_type: 'TARGET', target_id: ids.target };
function makeHarness({ patientAllowed = true, payloadOk = true, recommendationRow = recommendation, decisionResult = { ok: true, data: { id: ids.recommendation }, idempotent: false, planItem: null }, rpcResult = { data: { id: ids.recommendation }, error: null } } = {}) {
  const trace = { limits: [], fetches: [], accesses: [], decisions: [], rpc: [], planning: [], focuses: [], writes: [] };
  const user = { id: ids.actor, clinicId: ids.clinic, organizationId: ids.clinic };
  const deps = {
    enforcePayloadLimit(req, res, limit) { trace.limits.push(limit); if (!payloadOk) { res.status(413).json({ success: false }); return false; } return true; },
    sanitizeString: (value, limit) => String(value ?? '').trim().slice(0, limit),
    currentClinicId: value => value.clinicId,
    normalizePlanningFocusType: value => value || 'GENERAL',
    async fetchAbaPlanningContextSummaryDriven(args) { trace.planning.push(args); return {}; },
    generateNextSessionRecommendations: () => ({ recommendations: [], contextHash: 'ctx', reusedExisting: false }),
    abaPlanningHash: () => 'abc',
    cleanObject: value => value,
    normalizeAbaPlanningFocusType: value => value,
    writeAbaRowWithSchemaFallback: async (...args) => { trace.focuses.push(args); },
    normalizeAbaRecommendationType: value => value,
    normalizeAbaRecommendationPriority: value => value,
    sanitizeAbaRecommendationText: (value, limit) => String(value ?? '').slice(0, limit),
    sanitizeClinicalPayload: value => value,
    supabase: { rpc: async (name, params) => { trace.rpc.push({ name, params }); return rpcResult; } },
    hasMissingFinancialSchema: () => false,
    isMissingRelationError: () => false,
    enrichTherapeuticRecommendationContexts: async args => ({ rows: args.recommendations }),
    async fetchAbaRecommendationById(id, clinicId) { trace.fetches.push({ id, clinicId }); return clinicId === ids.clinic ? recommendationRow : null; },
    async canAccessPatientInCurrentClinic(id, actor) { trace.accesses.push({ id, actor }); return patientAllowed && id === ids.patient && actor.clinicId === ids.clinic; },
    async applyAbaRecommendationDecisionV3(args) { trace.decisions.push(args); return decisionResult; },
    abaRecommendationIdempotencyKey: req => req.headers?.['idempotency-key'] || 'stable-key',
    sanitizeTextField: (value, limit) => String(value ?? '').trim().slice(0, limit),
    sendRouteDbError: (res, path, err, options) => res.status(500).json({ success: false, error: options.fallbackMessage })
  };
  async function invoke(index, body = {}, override = {}) {
    const req = { session: { user }, params: { patientId: ids.patient, recommendationId: ids.recommendation }, resolvedPatientId: ids.patient, headers: { 'idempotency-key': 'stable-key' }, body, query: {}, ...override };
    const res = { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
    await handlers[index](() => deps)(req, res);
    return res;
  }
  return { invoke, trace };
}
for (let index = 0; index < handlers.length; index++) {
  const limited = makeHarness({ payloadOk: false });
  assert.equal((await limited.invoke(index)).statusCode, 413, 'payload bounded: ' + index);
  assert.equal(limited.trace.limits[0], [65536, 49152, 49152, 24576, 65536, 49152][index]);
  assert.equal(limited.trace.fetches.length + limited.trace.rpc.length + limited.trace.decisions.length + limited.trace.planning.length, 0);
}
{
  const h = makeHarness();
  const denied = await h.invoke(0, { organizationId: ids.otherClinic });
  assert.equal(denied.statusCode, 403, 'generation tenant body mismatch rejected');
  assert.equal(h.trace.planning.length, 0);
  assert.equal(h.trace.focuses.length, 0);
  const ok = await h.invoke(0, { sourceSessionId: 'session-id', focusType: 'GENERAL' });
  assert.equal(ok.statusCode, 200, 'empty generation succeeds');
  assert.equal(ok.payload.identityVersion, 3);
  assert.equal(h.trace.planning[0].clinicId, ids.clinic);
  assert.equal(h.trace.planning[0].patientId, ids.patient);
  assert.equal(h.trace.planning[0].organizationId, ids.clinic);
  assert.equal(h.trace.rpc.length, 0, 'no recommendation write for empty generation');
}
for (const index of [1, 2, 3, 4, 5]) {
  const denied = makeHarness({ patientAllowed: false });
  const res = await denied.invoke(index, index === 2 ? { reason: 'No' } : index === 3 ? { targetId: ids.target } : {});
  assert.equal(res.statusCode, 403, 'patient authorization: ' + index);
  assert.equal(denied.trace.decisions.length + denied.trace.rpc.length, 0, 'no write when patient unauthorized');
  const missing = makeHarness({ recommendationRow: null });
  assert.equal((await missing.invoke(index, index === 3 ? { targetId: ids.target } : {})).statusCode, 404, 'missing recommendation: ' + index);
  assert.equal(missing.trace.decisions.length + missing.trace.rpc.length, 0);
  const forged = makeHarness();
  const ret = await forged.invoke(index, index === 2 ? { reason: 'No' } : index === 3 ? { targetId: ids.target } : {});
  assert.equal(forged.trace.fetches[0].clinicId, ids.clinic, 'server clinic, not frontend');
  assert.equal(forged.trace.accesses[0].id, ids.patient, 'patient from persisted recommendation');
}
{
  const h = makeHarness();
  const res = await h.invoke(1, { applyToNextSession: true });
  assert.equal(res.statusCode, 200); assert.equal(h.trace.decisions[0].actionType, 'APPLIED_TO_NEXT_SESSION');
  assert.equal(h.trace.decisions[0].idempotencyKey, 'stable-key');
  assert.equal(h.trace.decisions[0].actor.id, ids.actor);
}
{
  const h = makeHarness();
  assert.equal((await h.invoke(2, {})).statusCode, 400, 'reject needs reason');
  assert.equal(h.trace.decisions.length, 0);
  const res = await h.invoke(2, { reason: '  not now  ', observation: 'note' });
  assert.equal(res.statusCode, 200); assert.equal(h.trace.decisions[0].actionType, 'REJECTED');
  assert.equal(h.trace.decisions[0].payload.reason, 'not now');
}
{
  const h = makeHarness();
  const res = await h.invoke(3, { targetId: ids.target, organizationId: ids.otherClinic, patientId: ids.otherClinic });
  assert.equal(res.statusCode, 200, 'RPC success');
  assert.equal(h.trace.rpc[0].name, 'link_therapeutic_recommendation_target');
  assert.equal(h.trace.rpc[0].params.p_organization_id, ids.clinic);
  assert.equal(h.trace.rpc[0].params.p_patient_id, ids.patient);
  assert.equal(h.trace.rpc[0].params.p_actor_id, ids.actor);
  assert.equal(h.trace.rpc[0].params.p_target_id, ids.target);
  assert.equal(h.trace.decisions.length, 0);
  const noTarget = makeHarness();
  assert.equal((await noTarget.invoke(3, {})).statusCode, 400);
  assert.equal(noTarget.trace.rpc.length, 0);
  const conflict = makeHarness({ rpcResult: { data: null, error: { message: 'THERAPEUTIC_RECOMMENDATION_ALREADY_CONVERTED' } } });
  assert.equal((await conflict.invoke(3, { targetId: ids.target })).statusCode, 409);
}
{
  const h = makeHarness();
  const result = await h.invoke(4, { title: 'Edited' });
  assert.equal(result.statusCode, 200); assert.equal(h.trace.decisions[0].actionType, 'EDITED');
  assert.equal(h.trace.decisions[0].payload.title, 'Edited');
}
{
  const h = makeHarness({ decisionResult: { ok: false, status: 409, error: 'CONFLICT', data: null } });
  const result = await h.invoke(5);
  assert.equal(result.statusCode, 409, 'failed persisted decision does not report success');
  assert.equal(result.payload.success, false);
  assert.equal(h.trace.decisions[0].actionType, 'APPLIED_TO_NEXT_SESSION');
  assert.equal(h.trace.decisions[0].idempotencyKey, 'stable-key');
}
console.log('ABA-M15: literal route parity, guards, clinic/patient boundaries, idempotency, RPC, body limits and error contracts PASS');
