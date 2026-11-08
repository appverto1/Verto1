import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';

// ABA-M07: freeze all four PTS writer bodies against the pre-extraction blob.
const before = execFileSync('git', ['cat-file', 'blob', '2acedc6c4de569111b9210638780d6fbe2dfa979'], { encoding: 'utf8', maxBuffer: 8_000_000 });
const server = readFileSync('server.ts', 'utf8');
const moduleSource = readFileSync('services/ptsVersionWriteHandlers.ts', 'utf8');
const specs = [
  ['post', '/api/aba/patients/:patientId/therapeutic-plans/:planId/pts-draft', 'createDraft'],
  ['patch', '/api/aba/patients/:patientId/therapeutic-plans/:planId/pts-draft/:versionId', 'saveDraft'],
  ['post', '/api/aba/patients/:patientId/therapeutic-plans/:planId/pts-draft/:versionId/activate', 'activateDraft'],
  ['post', '/api/aba/patients/:patientId/therapeutic-plans/:planId/pts-events', 'appendEvent'],
];
let lastPos = -1;
for (const [method, path, key] of specs) {
  const oldHeader = "  app." + method + "('" + path + "', checkAuth, requireClinicCapability('treatment_plan.edit'), checkPatientAccess, async (req: any, res) => {";
  const start = before.indexOf(oldHeader);
  const end = before.indexOf('\n  });', start + oldHeader.length);
  assert.ok(start >= 0 && end > start, 'original route exists: ' + key);
  const body = before.slice(start + oldHeader.length, end);
  const newHeader = '    ' + key + ': async (req: any, res: any) => {';
  const extracted = moduleSource.indexOf(newHeader);
  const bodyStart = moduleSource.indexOf('\n    try {', extracted);
  const bodyEnd = moduleSource.indexOf('\n    },', bodyStart);
  assert.ok(extracted >= 0 && bodyStart > extracted && bodyEnd > bodyStart, 'module handler exists: ' + key);
  assert.equal(moduleSource.slice(bodyStart, bodyEnd), body, 'clinical business logic is byte-identical: ' + key);
  const registration = "app." + method + "('" + path + "', checkAuth, requireClinicCapability('treatment_plan.edit'), checkPatientAccess, ptsVersionWriteHandlers." + key + ")";
  assert.equal(server.split(registration).length, 2, 'middleware and handler registered once: ' + key);
  const pos = server.indexOf(registration);
  assert.ok(pos > lastPos, 'registration order preserved: ' + key);
  lastPos = pos;
}
assert.ok(server.includes('createPtsVersionWriteHandlers(() => ({'), 'lazy injection at original route site');
assert.ok(!moduleSource.includes("from '../server'"), 'no import cycle from server');
for (const guard of [
  "loadPtsPlanWriteContext({ patientId, planId, organizationId, actorId, actorRole })",
  "if (!access.plan) return res.status(404)",
  "if (!access.allowed) return res.status(403)",
  "Number.isSafeInteger(expectedDraftRevision)",
  "p_expected_draft_revision: expectedDraftRevision",
  "create_patient_pts_draft_v2",
  "save_patient_pts_draft_v2",
  "activate_patient_pts_draft_v3",
  "PTS_DRAFT_VERSION_CONFLICT",
  "validationFailed === true",
  "draftPreserved: true",
  "PTS_ACTIVATION_PERSISTENCE_MIGRATION_REQUIRED",
  "resolve_patient_pts_plan_version_v1",
  ".eq('source_session_id', sessionId)",
  ".eq('organization_id', organizationId)",
  "PTS_COLLECTION_CONTEXT_REQUIRED",
  "append_patient_pts_event_v2",
  "p_idempotency_key: idempotencyKey",
  "PTS_EVENT_IDEMPOTENCY_CONFLICT",
]) assert.ok(moduleSource.includes(guard), 'preserve safety/persistence guard: ' + guard);

// Synthetic API-direct negative cases: no Supabase writes without legitimate scope.
const js = ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(js, context);
const factory = context.exports.createPtsVersionWriteHandlers;
assert.equal(typeof factory, 'function');
const ids = { clinic: '11111111-1111-4111-8111-111111111111', patient: '22222222-2222-4222-8222-222222222222', plan: '33333333-3333-4333-8333-333333333333', version: '44444444-4444-4444-8444-444444444444', actor: '55555555-5555-4555-8555-555555555555' };
const request = (body = {}) => ({ params: { patientId: ids.patient, planId: ids.plan, versionId: ids.version }, resolvedPatientId: ids.patient, session: { user: { organizationId: ids.clinic, id: ids.actor } }, effectiveClinicRole: 'director', body });
const response = () => ({ code: 200, payload: null, status(n) { this.code = n; return this; }, json(p) { this.payload = p; return this; } });
function harness(overrides = {}, answer = { data: { id: ids.version, draft_revision: 2 }, error: null }) {
  const writes = [];
  const supabase = { rpc: async (name, args) => { writes.push({ name, args }); return answer; } };
  const deps = {
    enforcePayloadLimit: () => true,
    sanitizeString: (v, n) => String(v ?? '').slice(0, n),
    currentClinicId: () => ids.clinic,
    isUuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    loadPtsPlanWriteContext: async () => ({ plan: { id: ids.plan }, allowed: true }),
    ptsDraftInput: () => ({ commonObjectives: [], specialtyObjectives: [], ptsPayload: {}, reviewDueDate: null }),
    normalizePtsEventPayload: () => ({ payload: { status: 'open' } }),
    sanitizeClinicalPayload: (v) => v,
    supabase,
    crypto: { randomUUID: () => ids.version },
    sendRouteDbError: (res) => res.status(500).json({ success: false }),
    ...overrides,
  };
  return { handlers: factory(() => deps), writes };
}
{
  const t = harness();
  const req = request();
  req.params.planId = 'foreign-id';
  const res = response();
  await t.handlers.createDraft(req, res);
  assert.equal(res.code, 400);
  assert.equal(t.writes.length, 0, 'invalid plan ID cannot write');
}
{
  const t = harness({ loadPtsPlanWriteContext: async () => ({ plan: null, allowed: false }) });
  const res = response();
  await t.handlers.createDraft(request(), res);
  assert.equal(res.code, 404);
  assert.equal(t.writes.length, 0, 'nonexistent/cross-tenant plan cannot write');
}
{
  const t = harness({ loadPtsPlanWriteContext: async () => ({ plan: { id: ids.plan }, allowed: false }) });
  const res = response();
  await t.handlers.activateDraft(request({ expectedDraftRevision: 2 }), res);
  assert.equal(res.code, 403);
  assert.equal(t.writes.length, 0, 'read-only role cannot activate');
}
{
  const t = harness();
  const res = response();
  await t.handlers.saveDraft(request({ expectedDraftRevision: 0 }), res);
  assert.equal(res.code, 400);
  assert.equal(t.writes.length, 0, 'invalid CAS cannot save');
}
{
  const t = harness();
  const res = response();
  await t.handlers.saveDraft(request({ expectedDraftRevision: 2 }), res);
  assert.equal(res.code, 200);
  assert.equal(t.writes[0].name, 'save_patient_pts_draft_v2');
  assert.equal(t.writes[0].args.p_organization_id, ids.clinic);
  assert.equal(t.writes[0].args.p_patient_id, ids.patient);
  assert.equal(t.writes[0].args.p_expected_draft_revision, 2);
}
{
  const t = harness({}, { data: { validationFailed: true, version: { id: ids.version } }, error: null });
  const res = response();
  await t.handlers.activateDraft(request({ expectedDraftRevision: 2 }), res);
  assert.equal(t.writes[0].name, 'activate_patient_pts_draft_v3');
  assert.equal(res.code, 422);
  assert.equal(res.payload.draftPreserved, true, 'invalid activation does not pretend to publish');
}
{
  const t = harness({}, { data: null, error: { message: 'PTS_DRAFT_VERSION_CONFLICT' } });
  const res = response();
  await t.handlers.saveDraft(request({ expectedDraftRevision: 2 }), res);
  assert.equal(res.code, 409);
  assert.equal(res.payload.error, 'PTS_DRAFT_VERSION_CONFLICT');
}
{
  const t = harness();
  const res = response();
  await t.handlers.appendEvent(request({ eventType: 'RISK_OPENED', idempotencyKey: 'short' }), res);
  assert.equal(res.code, 400);
  assert.equal(t.writes.length, 0);
}
{
  const t = harness();
  const res = response();
  await t.handlers.appendEvent(request({ eventType: 'RISK_STATUS_UPDATED', idempotencyKey: 'valid-idempotency-key' }), res);
  assert.equal(res.code, 422);
  assert.equal(t.writes.length, 0, 'event needs existing entity');
}
{
  const t = harness();
  const res = response();
  await t.handlers.appendEvent(request({ eventType: 'RISK_OPENED', idempotencyKey: 'valid-idempotency-key' }), res);
  assert.equal(res.code, 201);
  assert.equal(t.writes[0].name, 'append_patient_pts_event_v2');
  assert.equal(t.writes[0].args.p_idempotency_key, 'valid-idempotency-key');
  assert.equal(t.writes[0].args.p_organization_id, ids.clinic);
  assert.equal(t.writes[0].args.p_patient_id, ids.patient);
}
console.log('ABA-M07: literal parity, middleware order, tenant, CAS, activation and event idempotency OK');
