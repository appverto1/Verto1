import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const server = fs.readFileSync('server.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260904173500_patient_financial_plan_history_safe_payers.sql', 'utf8');

// Server-side canonical comparison is tenant + patient scoped and ACTIVE-only.
assert.match(server, /function loadCanonicalActivePatientFinancialPlansForAuthorization/);
assert.match(server, /\.eq\('organization_id', params\.clinicId\)[\s\S]{0,180}\.eq\('patient_id', params\.patientId\)[\s\S]{0,180}\.eq\('status', 'ACTIVE'\)/);
assert.match(server, /function assessPatientPayerMutationBoundary/);
assert.match(server, /params\.capabilities\?\.has\('finance\.entries\.manage'\) === true[\s\S]{0,120}params\.capabilities\?\.has\('patient\.insurance\.edit'\) === true/);
assert.match(server, /areInsuranceFinancialPlanSetsSemanticallyEqual\(canonicalRows, incomingRows\)/);
assert.match(server, /topLevelGenericPayerReplayMatchesCanonical\(params\.body, canonicalRows\)/);

// payer_id is authoritative; free-text payer name never switches payer identity.
assert.match(server, /payer_name_snapshot is intentionally excluded: payer_id is the tenant-scoped identity/);
assert.match(server, /Free text never proves payer identity; a tenant-scoped payer_id must anchor the replay/);
assert.match(server, /payer_name_snapshot: payerMap\.get\(sanitizeString\(row\.payer_id, 120\)\) \|\| null/);

// Generic financial dimensions are part of replay equality. TISS-only operational fields are
// deliberately excluded because callers without TISS must not receive or echo them.
for (const field of [
  'service_type', 'custom_service_name', 'service_name_snapshot', 'billing_mode', 'payer_id',
  'sessions_quantity', 'quantity_period', 'amount_cents', 'copayment_amount_cents',
  'payment_method', 'due_day', 'package_valid_until', 'notes',
]) {
  assert.match(server, new RegExp(`${field}:`));
}
assert.match(server, /TISS-only operational fields are intentionally excluded from replay equality/);

// Replay is a real financial NO-OP: incoming INSURANCE rows are stripped server-side,
// and the transaction does not end current INSURANCE rows when preserve mode is active.
assert.match(server, /if \(params\.preserveInsuranceContext === true\)[\s\S]{0,500}rows = rows\.filter\(\(row: any\) => !patientFinancialPlanIsInsurance\(row\)\)/);
assert.match(server, /p_preserve_insurance_context: params\.preserveInsuranceContext === true/);
assert.match(migration, /p_preserve_insurance_context boolean default false/);
assert.match(migration, /PATIENT_FINANCIAL_PLAN_INSURANCE_MUTATION_NOT_ALLOWED/);
assert.match(migration, /not coalesce\(p_preserve_insurance_context, false\)[\s\S]{0,160}billing_mode[\s\S]{0,80}INSURANCE/);

// PRIVATE remains under the base patient financial-plan contract; the guard only protects INSURANCE mutations.
assert.match(server, /app\.put\('\/api\/patients\/:patientId\/financial-plans'[\s\S]{0,160}requireClinicCapability\('patient\.demographics\.edit'\)/);
assert.match(server, /patient\.insurance\.edit'[\s\S]{0,180}requestedPlanInsuranceFields\.any/);

// Evaluate the exact semantic comparator implementation extracted from server.ts.
const start = server.indexOf('function normalizeFinancialPlanSemanticText');
const end = server.indexOf('function topLevelGenericPayerReplayMatchesCanonical');
assert.ok(start >= 0 && end > start, 'semantic comparator source must be present');
const comparatorSource = server.slice(start, end);
const context = {
  sanitizeString(value, limit = 1000) {
    if (value === null || value === undefined) return '';
    return String(value).slice(0, limit);
  },
  sanitizeIsoDateOnly(value) {
    const text = value === null || value === undefined ? '' : String(value).trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  },
  isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  },
};
vm.createContext(context);
const transpiledComparator = ts.transpileModule(comparatorSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
vm.runInContext(`${transpiledComparator}\nglobalThis.compareInsurance = areInsuranceFinancialPlanSetsSemanticallyEqual;`, context);
const compareInsurance = context.compareInsurance;

const planId = '11111111-1111-4111-8111-111111111111';
const payerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const canonicalInsurance = {
  id: planId,
  client_plan_key: planId,
  logical_plan_id: planId,
  service_type: 'SPECIALTY',
  custom_service_name: null,
  service_name_snapshot: 'Fonoaudiologia',
  billing_mode: 'INSURANCE',
  payer_id: payerA,
  payer_name_snapshot: 'Unimed',
  insurance_plan_name: 'Plano Ouro',
  authorization_code: 'AUTH-HISTORICA-123',
  authorization_valid_until: '2027-12-31',
  sessions_quantity: 1,
  quantity_period: 'SESSION',
  amount_cents: 10000,
  copayment_amount_cents: 0,
  payment_method: null,
  due_day: 10,
  package_valid_until: null,
  notes: null,
};
const sameReplay = {
  id: planId,
  serviceType: 'specialty',
  serviceNameSnapshot: 'Fonoaudiologia',
  billingMode: 'insurance',
  payerId: payerA,
  payerNameSnapshot: 'texto controlado pelo cliente deve ser ignorado',
  sessionsQuantity: 1,
  quantityPeriod: 'session',
  amountCents: 10000,
  copaymentAmountCents: 0,
  dueDay: 10,
};
const privateCanonical = {
  id: '22222222-2222-4222-8222-222222222222',
  billing_mode: 'PRIVATE',
  service_type: 'SPECIALTY',
  service_name_snapshot: 'Psicologia',
  amount_cents: 15000,
};
const privateChanged = { ...privateCanonical, amount_cents: 19000 };

assert.equal(
  compareInsurance([canonicalInsurance], [sameReplay]),
  true,
  'replay must not require echoing canonical TISS-only operational fields',
);
assert.equal(compareInsurance([privateCanonical, canonicalInsurance], [sameReplay, privateChanged]), true, 'PRIVATE changes must not grant or block INSURANCE replay');
assert.equal(compareInsurance([canonicalInsurance], [{ ...sameReplay, payerId: payerB }]), false, 'payer swap must be blocked');
assert.equal(compareInsurance([canonicalInsurance], [{ ...sameReplay, amountCents: 12000 }]), false, 'price change must be blocked');
assert.equal(compareInsurance([canonicalInsurance], []), false, 'INSURANCE removal must be blocked');
assert.equal(compareInsurance([], [sameReplay]), false, 'new INSURANCE link must be blocked');
assert.equal(compareInsurance([canonicalInsurance], [{ ...sameReplay, serviceNameSnapshot: 'Terapia Ocupacional' }]), false, 'service/specialty mutation must be blocked');
assert.equal(compareInsurance([canonicalInsurance], [{ ...sameReplay, sessionsQuantity: 2 }]), false, 'quantity mutation must be blocked');
assert.equal(compareInsurance([canonicalInsurance], [{ ...sameReplay, dueDay: 15 }]), false, 'due settings mutation must be blocked');

// Explicit presence of a protected TISS field is a mutation attempt even when the client sends
// null/empty to clear it. Omission is the only replay-safe representation without TISS edit.
const inspectStart = server.indexOf('function inspectFinancialPlanInsuranceOperationalFields');
const inspectEnd = server.indexOf('function normalizeFinancialPlanSemanticText');
assert.ok(inspectStart >= 0 && inspectEnd > inspectStart, 'TISS operational-field inspector must be present');
const inspectSource = server.slice(inspectStart, inspectEnd);
const inspectContext = { sanitizeString: context.sanitizeString };
vm.createContext(inspectContext);
const transpiledInspect = ts.transpileModule(inspectSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
vm.runInContext(`${transpiledInspect}\nglobalThis.inspectTiss = inspectFinancialPlanInsuranceOperationalFields;`, inspectContext);
const inspectTiss = inspectContext.inspectTiss;
assert.equal(inspectTiss([sameReplay]).any, false, 'omitted TISS-only fields must not be treated as mutations');
assert.equal(inspectTiss([{ ...sameReplay, authorizationCode: '' }]).any, true, 'explicit empty authorizationCode must be protected');
assert.equal(inspectTiss([{ ...sameReplay, authorizationValidUntil: null }]).any, true, 'explicit null authorizationValidUntil must be protected');
assert.equal(inspectTiss([{ ...sameReplay, insurancePlanName: 'Outro plano' }]).any, true, 'explicit insurancePlanName must be protected');

// A manually tampered demographic-save payload cannot use free text to change payer identity.
const topStart = server.indexOf('function topLevelGenericPayerReplayMatchesCanonical');
const topEnd = server.indexOf('async function loadCanonicalActivePatientFinancialPlansForAuthorization');
assert.ok(topStart >= 0 && topEnd > topStart, 'top-level generic payer comparator source must be present');
const topSource = server.slice(topStart, topEnd);
const topContext = {
  sanitizeString: context.sanitizeString,
  patientPayloadTouchesGenericPayerOutsideFinancialPlans(body) {
    return ['insuranceType', 'insurancePayerId', 'insuranceName'].some((key) => Object.prototype.hasOwnProperty.call(body || {}, key));
  },
  patientFinancialPlanPayloadSources(body) { return [body]; },
  patientFinancialPlanIsInsurance(row) { return String(row?.billing_mode || row?.billingMode || '').toUpperCase() === 'INSURANCE'; },
  normalizePatientInsuranceTypeForPersistence(value) {
    const v = String(value || '').trim().toLowerCase();
    return v === 'insurance' || v === 'convenio' ? 'convenio' : v === 'private' || v === 'particular' ? 'particular' : v;
  },
  isUuid: context.isUuid,
};
vm.createContext(topContext);
const transpiledTop = ts.transpileModule(topSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
vm.runInContext(`${transpiledTop}\nglobalThis.topReplay = topLevelGenericPayerReplayMatchesCanonical;`, topContext);
const topReplay = topContext.topReplay;
assert.equal(topReplay({ insuranceType: 'convenio', insurancePayerId: payerA }, [canonicalInsurance]), true, 'same tenant-scoped payer replay must pass');
assert.equal(topReplay({ insuranceType: 'convenio', insurancePayerId: payerB }, [canonicalInsurance]), false, 'tampered payer_id must be blocked');
assert.equal(topReplay({ insuranceType: 'convenio', insuranceName: 'Bradesco' }, [canonicalInsurance]), false, 'free-text payer name cannot authorize payer mutation');
assert.equal(topReplay({ insuranceType: 'particular', insurancePayerId: payerA }, [canonicalInsurance]), false, 'top-level removal of insurance context must be blocked');

console.log('patientPayerReplayAuthorizationBoundary.regression.test.mjs: ok');
