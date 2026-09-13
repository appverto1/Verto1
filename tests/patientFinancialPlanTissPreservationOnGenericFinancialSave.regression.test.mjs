import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.env.VERTO_SOURCE_ROOT || process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const server = read('server.ts');
const utilSource = read('src/utils/patientFinancialPlan.ts');
const coordinator = read('src/components/CoordinatorDashboard.tsx');
const reconciliationSql = read('supabase/migrations/20260905101500_monthly_session_patient_billing.sql');
const persistenceGuaranteesSql = read('supabase/migrations/20260813110000_persistence_guarantees.sql');

// Execute the real generic/full serializers.
const moduleHolder = { exports: {} };
const utilContext = {
  module: moduleHolder,
  exports: moduleHolder.exports,
  console,
  Date,
  Math,
  String,
  Number,
  Boolean,
  Array,
  Object,
  RegExp,
  JSON,
  Intl,
};
vm.createContext(utilContext);
vm.runInContext(ts.transpileModule(utilSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, utilContext);
const serializeGeneric = moduleHolder.exports.serializePatientFinancialPlanForGenericFinancialPayload;
const serializeFull = moduleHolder.exports.serializePatientFinancialPlanForPayload;
const normalizePlans = moduleHolder.exports.normalizePatientFinancialPlans;
const isComplete = moduleHolder.exports.isPatientFinancialPlanComplete;
assert.equal(typeof serializeGeneric, 'function');
assert.equal(typeof serializeFull, 'function');

const sanitizeString = (value, limit = 1000) => {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, limit);
};
const sanitizeIsoDateOnly = (value) => {
  const text = sanitizeString(value, 80);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

// Execute exact server semantic identity + preservation helper.
const semanticStart = server.indexOf('function normalizeFinancialPlanSemanticText');
const semanticEnd = server.indexOf('function areInsuranceFinancialPlanSetsSemanticallyEqual');
assert.ok(semanticStart >= 0 && semanticEnd > semanticStart, 'financial-plan preservation helper must exist');
const semanticContext = { sanitizeString, sanitizeIsoDateOnly, isUuid, JSON, String, Number, Math, Set, Array, Object };
vm.createContext(semanticContext);
const semanticJs = ts.transpileModule(server.slice(semanticStart, semanticEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
vm.runInContext(`${semanticJs}\nglobalThis.hydrateTiss = hydrateOmittedPatientFinancialPlanTissFieldsForPersistence;`, semanticContext);
const hydrateTiss = semanticContext.hydrateTiss;
assert.equal(typeof hydrateTiss, 'function');

// Execute the exact DB-row builder that feeds reconcile_patient_financial_plans_v2.
const buildStart = server.indexOf('function buildPatientFinancialPlanRows');
const buildEnd = server.indexOf('async function persistPatientFinancialPlans', buildStart);
assert.ok(buildStart >= 0 && buildEnd > buildStart);
const buildContext = {
  normalizePatientFinancialPlans: normalizePlans,
  isPatientFinancialPlanComplete: isComplete,
  serializePatientFinancialPlanForPayload: serializeFull,
  cleanObject(input) { return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)); },
  isUuid,
  sanitizeString,
  sanitizeIsoDateOnly,
  asSafeNumber(value, min, max) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(max, Math.max(min, parsed));
  },
  sanitizeTextField(value, limit = 1000) { return sanitizeString(value, limit); },
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
};
vm.createContext(buildContext);
const buildJs = ts.transpileModule(server.slice(buildStart, buildEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
vm.runInContext(`${buildJs}\nglobalThis.buildRows = buildPatientFinancialPlanRows;`, buildContext);
const buildRows = buildContext.buildRows;

const patientId = '99999999-9999-4999-8999-999999999999';
const clinicId = '88888888-8888-4888-8888-888888888888';
const payerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const planId = '11111111-1111-4111-8111-111111111111';
const before = {
  id: planId,
  client_plan_key: planId,
  logical_plan_id: planId,
  organization_id: clinicId,
  patient_id: patientId,
  service_type: 'SPEECH_THERAPY',
  service_name_snapshot: 'Fonoaudiologia',
  billing_mode: 'INSURANCE',
  payer_id: payerId,
  payer_name_snapshot: 'Unimed',
  amount_cents: 10000,
  due_day: 10,
  insurance_plan_name: 'Plano Ouro',
  authorization_code: 'AUTH-999',
  authorization_valid_until: '2026-12-31',
  status: 'ACTIVE',
};

const genericPayload = serializeGeneric({
  id: planId,
  serviceType: 'SPEECH_THERAPY',
  billingMode: 'INSURANCE',
  payerId,
  payerNameSnapshot: 'Unimed',
  amountCents: 12000,
  dueDay: 10,
  status: 'ACTIVE',
});
for (const key of ['insurancePlanName', 'authorizationCode', 'authorizationValidUntil']) {
  assert.equal(Object.prototype.hasOwnProperty.call(genericPayload, key), false, `${key} must be absent before persistence`);
}

const hydrated = hydrateTiss([genericPayload], [before]);
assert.equal(hydrated[0].amountCents, 12000);
assert.equal(hydrated[0].insurancePlanName, 'Plano Ouro');
assert.equal(hydrated[0].authorizationCode, 'AUTH-999');
assert.equal(hydrated[0].authorizationValidUntil, '2026-12-31');

const rpcRows = buildRows({
  financialPlans: hydrated,
  patientId,
  clinicId,
  actorId: null,
});
assert.equal(rpcRows.length, 1);
const after = rpcRows[0];
assert.equal(after.amount_cents, 12000, 'authorized financial field must change');
assert.equal(after.insurance_plan_name, before.insurance_plan_name, 'insurance plan must survive generic save');
assert.equal(after.authorization_code, before.authorization_code, 'authorization code must survive generic save');
assert.equal(after.authorization_valid_until, before.authorization_valid_until, 'authorization validity must survive generic save');

// Execute the real persistPatientFinancialPlans orchestration with a mocked Supabase boundary.
// This captures the exact p_plans payload sent to reconcile_patient_financial_plans_v2.
let capturedRpc = null;
let canonicalForMock = [before];
const fakeSupabase = {
  from(table) {
    assert.equal(table, 'clinic_payers');
    return {
      select() { return this; },
      eq() { return this; },
      async in(_column, ids) {
        assert.deepEqual(Array.from(ids), [payerId]);
        return { data: [{ id: payerId, name: 'Unimed' }], error: null };
      },
    };
  },
  async rpc(name, args) {
    assert.equal(name, 'reconcile_patient_financial_plans_v2');
    capturedRpc = args;
    return { data: { success: true, data: args.p_plans }, error: null };
  },
};
const persistStart = server.indexOf('async function persistPatientFinancialPlans');
const persistEnd = server.indexOf('async function updatePatientStatusIfNeeded', persistStart);
const persistContext = {
  isUuid,
  loadCanonicalActivePatientFinancialPlansForTissPreservation: async () => canonicalForMock,
  hydrateOmittedPatientFinancialPlanTissFieldsForPersistence: hydrateTiss,
  buildPatientFinancialPlanRows: buildRows,
  patientFinancialPlanIsInsurance: (row) => String(row?.billing_mode || row?.billingMode || '').toUpperCase() === 'INSURANCE',
  sanitizeString,
  isMissingRelationError: () => false,
  redactPatientFinancialPlanTissOperationalFields: (value) => value,
  supabase: fakeSupabase,
  Math, Number, String, Array, Set, Map, Object,
};
vm.createContext(persistContext);
vm.runInContext(`${ts.transpileModule(server.slice(persistStart, persistEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText}\nglobalThis.persistPlans = persistPatientFinancialPlans;`, persistContext);
const persisted = await persistContext.persistPlans({
  patientId,
  clinicId,
  actorId: null,
  financialPlans: [genericPayload],
  preserveOmittedInsuranceOperationalFields: true,
});
assert.equal(persisted.success, true);
assert.ok(capturedRpc, 'reconciliation RPC must be called');
assert.equal(capturedRpc.p_plans[0].amount_cents, 12000);
assert.equal(capturedRpc.p_plans[0].insurance_plan_name, 'Plano Ouro');
assert.equal(capturedRpc.p_plans[0].authorization_code, 'AUTH-999');
assert.equal(capturedRpc.p_plans[0].authorization_valid_until, '2026-12-31');

// No pre-existing TISS data: finance-only INSURANCE save remains valid (previous hotfix).
canonicalForMock = [];
capturedRpc = null;
const newFinanceOnlyPlan = serializeGeneric({
  id: '22222222-2222-4222-8222-222222222222',
  serviceType: 'PSYCHOLOGY',
  billingMode: 'INSURANCE',
  payerId,
  payerNameSnapshot: 'Unimed',
  amountCents: 15000,
  dueDay: 10,
  status: 'ACTIVE',
});
const newFinanceOnlyResult = await persistContext.persistPlans({
  patientId, clinicId, actorId: null, financialPlans: [newFinanceOnlyPlan],
  preserveOmittedInsuranceOperationalFields: true,
});
assert.equal(newFinanceOnlyResult.success, true);
assert.equal(capturedRpc.p_plans[0].amount_cents, 15000);
assert.equal(capturedRpc.p_plans[0].insurance_plan_name, null);
assert.equal(capturedRpc.p_plans[0].authorization_code, null);

// Authorized TISS mutation keeps the full serializer semantics and reaches persistence explicitly.
canonicalForMock = [before];
capturedRpc = null;
const authorizedPersistenceResult = await persistContext.persistPlans({
  patientId,
  clinicId,
  actorId: null,
  financialPlans: [serializeFull({
    id: planId,
    serviceType: 'SPEECH_THERAPY',
    billingMode: 'INSURANCE',
    payerId,
    payerNameSnapshot: 'Unimed',
    amountCents: 12000,
    dueDay: 10,
    status: 'ACTIVE',
    insurancePlanName: 'Plano Diamante',
    authorizationCode: 'AUTH-NEW',
    authorizationValidUntil: '2027-01-31',
  })],
  preserveOmittedInsuranceOperationalFields: false,
});
assert.equal(authorizedPersistenceResult.success, true);
assert.equal(capturedRpc.p_plans[0].insurance_plan_name, 'Plano Diamante');
assert.equal(capturedRpc.p_plans[0].authorization_code, 'AUTH-NEW');
assert.equal(capturedRpc.p_plans[0].authorization_valid_until, '2027-01-31');

// The real RPC is a complete row replacement/update, so the preserved values above are
// exactly what will be written. This is the data-loss boundary the helper protects.
assert.match(reconciliationSql, /insurance_plan_name = v_insurance_plan_name/);
assert.match(reconciliationSql, /authorization_code = v_authorization_code/);
assert.match(reconciliationSql, /authorization_valid_until = v_authorization_valid_until/);
assert.match(reconciliationSql, /v_insurance_plan_name, v_authorization_code, v_authorization_valid_until/);

// Explicit null/empty must not be server-hydrated over: authorization catches these first.
const explicitNull = hydrateTiss([{ ...genericPayload, authorizationCode: null }], [before]);
assert.equal(explicitNull[0].authorizationCode, null);
const explicitEmpty = hydrateTiss([{ ...genericPayload, insurancePlanName: '' }], [before]);
assert.equal(explicitEmpty[0].insurancePlanName, '');

const inspectStart = server.indexOf('function inspectFinancialPlanInsuranceOperationalFields');
const inspectEnd = server.indexOf('function normalizeFinancialPlanSemanticText');
const inspectContext = { sanitizeString };
vm.createContext(inspectContext);
vm.runInContext(`${ts.transpileModule(server.slice(inspectStart, inspectEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText}\nglobalThis.inspectTiss = inspectFinancialPlanInsuranceOperationalFields;`, inspectContext);
assert.equal(inspectContext.inspectTiss([genericPayload]).any, false);
assert.equal(inspectContext.inspectTiss([{ ...genericPayload, authorizationCode: null }]).any, true);
assert.equal(inspectContext.inspectTiss([{ ...genericPayload, insuranceCardNumber: '' }]).any, true);

// Execute the real patient identity persistence builder with controlled dependencies.
const identityStart = server.indexOf('function buildPatientIdentityPersistenceFields');
const identityEnd = server.indexOf('function normalizePatientInsuranceEligibilityPayload', identityStart);
assert.ok(identityStart >= 0 && identityEnd > identityStart);
const identityContext = {
  buildPatientProfileTypeFields() { return {}; },
  cleanObject(input) { return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)); },
  sanitizeString,
  sanitizeIsoDateOnly,
  normalizeCpf(value) { const digits = String(value || '').replace(/\D/g, ''); return digits.length === 11 ? digits : null; },
  sanitizeTextField(value, limit) { return sanitizeString(value, limit); },
  normalizeBrazilMobilePhone() { return null; },
  sanitizePhone(value) { return sanitizeString(value, 40); },
  sanitizeEmail(value) { return sanitizeString(value, 320); },
  readPatientInsurancePayerId(body) {
    const keys = ['insurancePayerId','insurance_payer_id','convenioPayerId','convenio_payer_id'];
    const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(body || {}, candidate));
    return key ? { provided: true, value: body[key] || null, invalid: false } : { provided: false, value: null, invalid: false };
  },
  Boolean,
  Object,
};
vm.createContext(identityContext);
vm.runInContext(`${ts.transpileModule(server.slice(identityStart, identityEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText}\nglobalThis.buildIdentity = buildPatientIdentityPersistenceFields;`, identityContext);
const genericIdentityPatch = identityContext.buildIdentity({
  socialName: 'João',
  insuranceType: 'convenio',
  insurancePayerId: payerId,
  insuranceName: 'Unimed',
});
assert.equal(genericIdentityPatch.insurance_type, 'convenio');
assert.equal(genericIdentityPatch.insurance_name, 'Unimed');
for (const field of [
  'insurance_card_number', 'insurance_card_valid_until', 'insurance_plan_category',
  'insurance_holder_name', 'insurance_holder_cpf', 'insurance_holder_relationship', 'eligibility_notes',
]) {
  assert.equal(Object.prototype.hasOwnProperty.call(genericIdentityPatch, field), false, `${field} must remain absent`);
}
const explicitCardClear = identityContext.buildIdentity({ insuranceCardNumber: '' });
assert.equal(Object.prototype.hasOwnProperty.call(explicitCardClear, 'insurance_card_number'), true);
assert.equal(explicitCardClear.insurance_card_number, '');

const patientBefore = {
  insurance_card_number: '123456',
  insurance_card_valid_until: '2027-12-31',
  insurance_plan_category: 'Plano Ouro',
  insurance_holder_name: 'João da Silva',
  insurance_holder_cpf: '12345678901',
  insurance_holder_relationship: 'Titular',
  eligibility_notes: 'Elegibilidade confirmada',
};
const patientAfterGenericPatch = { ...patientBefore, ...genericIdentityPatch };
for (const [key, value] of Object.entries(patientBefore)) {
  assert.equal(patientAfterGenericPatch[key], value, `${key} must survive generic identity patch`);
}

// The patient aggregate RPC is a true JSON patch: only keys present in p_patient_patch
// are added to the UPDATE SET clause. Therefore omitted TISS patient columns remain untouched.
assert.match(persistenceGuaranteesSql, /for v_key in select jsonb_object_keys\(p_patient_patch\)/);
assert.match(persistenceGuaranteesSql, /v_set_clause := v_set_clause \|\| format\([\s\S]{0,220}jsonb_populate_record/);

// Route ordering: TISS authorization rejection occurs before any mutation path.
const patchStart = server.indexOf("app.patch('/api/patients/:id'");
const patchEnd = server.indexOf("app.get('/api/patients/:patientId/financial-plans'", patchStart);
const patchRoute = server.slice(patchStart, patchEnd);
const guardAt = patchRoute.indexOf('PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED');
assert.ok(guardAt >= 0);
assert.match(patchRoute, /hasInsurancePatchOutsideFinancialPlans = patientPayloadRequestsInsuranceOperationalOutsideFinancialPlans\(req\.body\)/);
assert.match(server, /const PATIENT_INSURANCE_PAYLOAD_KEYS = new Set\(\[[\s\S]{0,320}'insuranceCardNumber'/);
for (const writeToken of ["supabase.rpc('verto_update_patient_aggregate_atomic'", ".update(safePatientUpdates)", 'persistPatientFinancialPlans({']) {
  const writeAt = patchRoute.indexOf(writeToken);
  assert.ok(writeAt > guardAt, `${writeToken} must occur after TISS guard`);
}

const putStart = server.indexOf("app.put('/api/patients/:patientId/financial-plans'");
const putEnd = server.indexOf('// Secure patient record storage', putStart);
const putRoute = server.slice(putStart, putEnd);
assert.ok(putRoute.indexOf('PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED') < putRoute.indexOf('persistPatientFinancialPlans({'));

// Persistence is explicitly instructed to preserve omitted TISS for non-editors and not leak
// internally hydrated protected values back to callers that cannot view them.
assert.match(server, /preserveOmittedInsuranceOperationalFields: !context\.capabilities\.has\('patient\.insurance\.edit'\)/);
assert.match(server, /redactInsuranceOperationalFieldsFromResult: !context\.capabilities\.has\('patient\.insurance\.view'\)/);
assert.match(server, /preserveOmittedInsuranceOperationalFields: req\.authorizationContext\?\.capabilities\?\.has\('patient\.insurance\.edit'\) !== true/);

// The preservation read follows the DB performance rule: only identity + the three
// persisted TISS columns are selected, not the full financial-plan row.
const preservationLoaderStart = server.indexOf('async function loadCanonicalActivePatientFinancialPlansForTissPreservation');
const preservationLoaderEnd = server.indexOf('async function assessPatientPayerMutationBoundary', preservationLoaderStart);
const preservationLoader = server.slice(preservationLoaderStart, preservationLoaderEnd);
for (const field of ['id', 'client_plan_key', 'logical_plan_id', 'billing_mode', 'insurance_plan_name', 'authorization_code', 'authorization_valid_until']) {
  assert.ok(preservationLoader.includes(`'${field}'`), `preservation query must select ${field}`);
}
assert.equal(preservationLoader.includes('amount_cents'), false, 'preservation query must not full-load financial columns');

// In a TISS-enabled clinic, a finance editor without TISS edit keeps the generic payer payload
// but the operational TISS fields are structurally capability-gated.
assert.match(coordinator, /const canPersistPatientTissOperationalFields =[\s\S]{0,220}patient\.insurance\.edit[\s\S]{0,160}patient\.insurance\.create/);
assert.match(coordinator, /insuranceName:[\s\S]{0,500}\.\.\.\(canPersistPatientTissOperationalFields/);

// Authorized TISS serialization still contains explicit operational fields.
const authorized = serializeFull({
  id: planId,
  serviceType: 'SPEECH_THERAPY',
  billingMode: 'INSURANCE',
  payerId,
  amountCents: 12000,
  insurancePlanName: 'Plano Diamante',
  authorizationCode: 'AUTH-NEW',
  authorizationValidUntil: '2027-01-31',
});
assert.equal(authorized.insurancePlanName, 'Plano Diamante');
assert.equal(authorized.authorizationCode, 'AUTH-NEW');
assert.equal(authorized.authorizationValidUntil, '2027-01-31');

console.log('patientFinancialPlanTissPreservationOnGenericFinancialSave.regression.test.mjs: ok');
