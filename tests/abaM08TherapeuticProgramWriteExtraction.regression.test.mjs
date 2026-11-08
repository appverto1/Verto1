import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';

// ABA-M08: the four clinical write handlers must remain byte-identical to pre-extraction staging.
const before = execFileSync('git', ['cat-file', 'blob', 'b02a7d87cf49dd4644ec723b6ec307f06b32f986'], { encoding: 'utf8', maxBuffer: 8_000_000 });
const server = readFileSync('server.ts', 'utf8');
const moduleSource = readFileSync('services/therapeuticProgramWriteHandlers.ts', 'utf8');
const specs = [
  ['post', '/api/aba/patients/:patientId/therapeutic-programs', "requireAbaV2Feature, checkAuth, requireAnyClinicCapability('aba.program.create', 'treatment_plan.create'), checkPatientAccess", 'createProgram'],
  ['patch', '/api/aba/patients/:patientId/therapeutic-programs/:programId/status', "requireAbaV2Feature, checkAuth, requireAnyClinicCapability('aba.program.edit', 'treatment_plan.create'), checkPatientAccess", 'updateStatus'],
  ['patch', '/api/aba/patients/:patientId/therapeutic-programs/:programId', "requireAbaV2Feature, checkAuth, requireAnyClinicCapability('aba.program.edit', 'treatment_plan.create'), checkPatientAccess", 'updateProgram'],
  ['post', '/api/aba/patients/:patientId/therapeutic-programs/:programId/targets', "requireAbaV2Feature, checkAuth, requireAnyClinicCapability('aba.program.edit', 'treatment_plan.create'), checkPatientAccess", 'addTarget'],
];
let previous = -1;
for (const [method, path, gates, key] of specs) {
  const originalHeader = "  app." + method + "('" + path + "', " + gates + ", async (req: any, res) => {";
  const start = before.indexOf(originalHeader);
  const end = before.indexOf('\n  });', start + originalHeader.length);
  assert.ok(start >= 0 && end > start, key + ': previous route exists');
  const newHeader = '    ' + key + ': async (req: any, res: any) => {';
  const extracted = moduleSource.indexOf(newHeader);
  const bodyStart = moduleSource.indexOf('\n    try {', extracted);
  const bodyEnd = moduleSource.indexOf('\n    },', bodyStart);
  assert.ok(extracted >= 0 && bodyStart > extracted && bodyEnd > bodyStart, key + ': module route exists');
  assert.equal(moduleSource.slice(bodyStart, bodyEnd), before.slice(start + originalHeader.length, end), key + ': byte-identical handler body');
  const registration = "app." + method + "('" + path + "', " + gates + ", therapeuticProgramWriteHandlers." + key + ")";
  assert.equal(server.split(registration).length, 2, key + ': exactly one registration with original middleware');
  const position = server.indexOf(registration);
  assert.ok(position > previous, key + ': original registration order preserved');
  previous = position;
}
assert.match(server, /createTherapeuticProgramWriteHandlers\(\(\) => \(\{/);
assert.doesNotMatch(moduleSource, /from ['"]\.\.\/server/);
for (const guard of [
  "THERAPEUTIC_PLAN_SCOPE_REQUIRED", "THERAPEUTIC_PROGRAM_SPECIALTY_PLAN_REQUIRED",
  "THERAPEUTIC_PLAN_EDIT_DENIED", "patient_professional_links",
  ".eq('organization_id', organizationId)", ".eq('patient_id', patientId)",
  "isTherapeuticPlanManager(role)", "canActivateSpecialtyPlanForCase",
  "THERAPEUTIC_RECOMMENDATION_CONTEXT_INCOMPLETE", "THERAPEUTIC_PROTOCOL_CONTEXT_INVALID",
  "create_therapeutic_program", "update_therapeutic_program_status",
  "update_therapeutic_program", "add_therapeutic_program_target",
  "p_expected_version", "p_idempotency_key", "p_actor_id",
  "THERAPEUTIC_PROGRAM_PARENT_PLAN_NOT_ACTIVE", "THERAPEUTIC_PROGRAM_STATUS_TRANSITION_INVALID",
]) assert.ok(moduleSource.includes(guard), 'preserve tenant, plan, CAS, clinical and idempotency contract: ' + guard);

// Synthetic API-direct attacks: frontend IDs and roles must never independently authorize writes.
const js = ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(js, context);
const factory = context.exports.createTherapeuticProgramWriteHandlers;
assert.equal(typeof factory, 'function');
const ids = { clinic: '11111111-1111-4111-8111-111111111111', patient: '22222222-2222-4222-8222-222222222222', plan: '33333333-3333-4333-8333-333333333333', program: '44444444-4444-4444-8444-444444444444', actor: '55555555-5555-4555-8555-555555555555' };
const req = (body = {}) => ({ body, params: { patientId: ids.patient, programId: ids.program }, resolvedPatientId: ids.patient, session: { user: { organizationId: ids.clinic, id: ids.actor } }, effectiveClinicRole: 'director' });
const res = () => ({ code: 200, payload: null, status(n) { this.code = n; return this; }, json(p) { this.payload = p; return this; } });
function harness({ plan = { id: ids.plan, organization_id: ids.clinic, patient_id: ids.patient, mode: 'specialty', status: 'active', responsible_professional_id: ids.actor, participant_professional_ids: [] }, program = { id: ids.program, status: 'draft', version: 3, therapeutic_plan_id: ids.plan }, canEdit = true, canManage = true, rpcError = null } = {}) {
  const reads = [];
  const writes = [];
  const supabase = {
    from(table) {
      const filters = [];
      const query = {
        select() { return this; }, eq(field, value) { filters.push([field, value]); return this; },
        neq() { return this; }, limit() { return this; }, order() { return this; },
        async maybeSingle() {
          reads.push({ table, filters: [...filters] });
          const item = table === 'patient_therapeutic_plans' ? plan : table === 'aba_programs' ? program : null;
          if (!item || filters.some(([field,value]) => field in item && String(item[field]) !== String(value))) return { data: null, error: null };
          return { data: item, error: null };
        },
      };
      return query;
    },
    async rpc(name, args) { writes.push({ name, args }); return { data: { id: ids.program }, error: rpcError }; },
  };
  const deps = {
    enforcePayloadLimit: () => true, sanitizeString: (v, n) => String(v ?? '').slice(0, n), sanitizeTextField: (v, n) => String(v ?? '').slice(0, n),
    sanitizeClinicalPayload: v => v, sanitizeIsoDateOnly: () => null, currentClinicId: () => ids.clinic,
    isUuid: v => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v),
    supabase, isTherapeuticPlanManager: () => canManage, canActorEditTherapeuticProgram: async () => canEdit,
    canActivateSpecialtyPlanForCase: async () => true,
    THERAPEUTIC_PROGRAM_ORIGIN_TYPES: new Set(['manual']),
    THERAPEUTIC_PROGRAM_SELECT: 'id', ABA_TARGET_RECOMMENDATION_SELECT: 'id',
    ABA_RECOMMENDATION_TYPES: new Set(), THERAPEUTIC_PROGRAM_CREATION_RECOMMENDATION_TYPES: new Set(),
    crypto: { randomUUID: () => ids.program },
    therapeuticProgramErrorMessage: () => 'RPC_CONFLICT',
    hasMissingFinancialSchema: () => false, isMissingRelationError: () => false,
    persistActivityLog: () => Promise.resolve(),
    sendRouteDbError: (response) => response.status(500).json({ success: false }),
  };
  return { handlers: factory(() => deps), writes, reads };
}
const validCreate = { therapeuticPlanId: ids.plan, name: 'Programa sem PHI', targets: [{ name: 'Alvo teste' }], originType: 'manual', idempotencyKey: 'dedupe-create' };
{
  const h = harness(); const r = res();
  await h.handlers.createProgram(req({ ...validCreate, therapeuticPlanId: undefined }), r);
  assert.equal(r.code, 422); assert.equal(h.writes.length, 0, 'no orphan program without parent plan');
}
{
  const h = harness(); const r = res();
  await h.handlers.createProgram(req({ ...validCreate, therapeuticPlanId: 'forged-id' }), r);
  assert.equal(r.code, 400); assert.equal(h.writes.length, 0, 'forged plan ID rejected');
}
{
  const h = harness({ plan: null }); const r = res();
  await h.handlers.createProgram(req(validCreate), r);
  assert.equal(r.code, 404); assert.equal(h.writes.length, 0, 'missing/cross-tenant plan rejected');
}
{
  const h = harness({ canManage: false, plan: { id: ids.plan, mode: 'specialty', status: 'active', responsible_professional_id: 'other', participant_professional_ids: [] } }); const r = res();
  await h.handlers.createProgram(req(validCreate), r);
  assert.equal(r.code, 403); assert.equal(h.writes.length, 0, 'unrelated professional cannot create program');
}
{
  const h = harness(); const r = res();
  await h.handlers.createProgram(req(validCreate), r);
  assert.equal(r.code, 201); assert.equal(h.writes[0].name, 'create_therapeutic_program');
  assert.equal(h.writes[0].args.p_organization_id, ids.clinic);
  assert.equal(h.writes[0].args.p_patient_id, ids.patient);
  assert.equal(h.writes[0].args.p_advanced_settings.therapeuticPlanId, ids.plan);
  assert.equal(h.writes[0].args.p_idempotency_key, 'dedupe-create');
}
{
  const h = harness({ canEdit: false }); const r = res();
  await h.handlers.updateProgram(req({ name: 'teste' }), r);
  assert.equal(r.code, 403); assert.equal(h.writes.length, 0, 'program edit denies without server authorization');
}
{
  const h = harness(); const r = res();
  await h.handlers.updateProgram(req({ name: 'teste', expectedVersion: 5, idempotencyKey: 'dedupe-update' }), r);
  assert.equal(r.code, 200); assert.equal(h.writes[0].name, 'update_therapeutic_program');
  assert.equal(h.writes[0].args.p_expected_version, 5);
  assert.equal(h.writes[0].args.p_idempotency_key, 'dedupe-update');
}
{
  const h = harness(); const r = res();
  await h.handlers.updateStatus(req({ status: 'invalid' }), r);
  assert.equal(r.code, 400); assert.equal(h.writes.length, 0, 'invalid status cannot mutate');
}
{
  const h = harness({ program: { id: ids.program, status: 'completed', version: 3, therapeutic_plan_id: ids.plan } }); const r = res();
  await h.handlers.updateStatus(req({ status: 'teaching' }), r);
  assert.equal(r.code, 409); assert.equal(h.writes.length, 0, 'forbidden FSM transition cannot mutate');
}
{
  const h = harness({ plan: { id: ids.plan, status: 'draft' } }); const r = res();
  await h.handlers.updateStatus(req({ status: 'teaching' }), r);
  assert.equal(r.code, 409); assert.equal(h.writes.length, 0, 'inactive parent cannot activate program');
}
{
  const h = harness(); const r = res();
  await h.handlers.updateStatus(req({ status: 'teaching', expectedVersion: 3, idempotencyKey: 'dedupe-status' }), r);
  assert.equal(r.code, 200); assert.equal(h.writes[0].name, 'update_therapeutic_program_status');
  assert.equal(h.writes[0].args.p_expected_version, 3);
  assert.equal(h.writes[0].args.p_idempotency_key, 'dedupe-status');
}
{
  const h = harness({ canEdit: false }); const r = res();
  await h.handlers.addTarget(req({ name: 'Meta' }), r);
  assert.equal(r.code, 403); assert.equal(h.writes.length, 0, 'target cannot be added to unauthorized program');
}
{
  const h = harness(); const r = res();
  await h.handlers.addTarget(req({ name: 'Meta', idempotencyKey: 'dedupe-target' }), r);
  assert.equal(r.code, 201); assert.equal(h.writes[0].name, 'add_therapeutic_program_target');
  assert.equal(h.writes[0].args.p_program_id, ids.program);
  assert.equal(h.writes[0].args.p_organization_id, ids.clinic);
  assert.equal(h.writes[0].args.p_patient_id, ids.patient);
  assert.equal(h.writes[0].args.p_idempotency_key, 'dedupe-target');
}
console.log('ABA-M08: literal parity, middleware, tenant, ownership, FSM, CAS and idempotency PASS');
