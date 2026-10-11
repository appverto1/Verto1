import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const utilSource = fs.readFileSync('src/utils/patientFinancialPlan.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

// Execute the real serializer implementation instead of reproducing it in the test.
const patientFinancialPlanModule = { exports: {} };
const specialtyModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/clinicalSpecialties.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { module: specialtyModule, exports: specialtyModule.exports });
const utilContext = {
  require(name) {
    assert.equal(name, './clinicalSpecialties');
    return specialtyModule.exports;
  },
  module: patientFinancialPlanModule,
  exports: patientFinancialPlanModule.exports,
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
const utilJs = ts.transpileModule(utilSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInContext(utilJs, utilContext);
const serializePatientFinancialPlanForPayload = patientFinancialPlanModule.exports.serializePatientFinancialPlanForPayload;
const serializePatientFinancialPlanForGenericFinancialPayload = patientFinancialPlanModule.exports.serializePatientFinancialPlanForGenericFinancialPayload;
assert.equal(typeof serializePatientFinancialPlanForPayload, 'function');
assert.equal(typeof serializePatientFinancialPlanForGenericFinancialPayload, 'function');

// Execute the exact server-side TISS operational-field inspector. This proves the
// serialized payload composes correctly with the real authorization boundary.
const inspectStart = server.indexOf('function inspectFinancialPlanInsuranceOperationalFields');
const inspectEnd = server.indexOf('function normalizeFinancialPlanSemanticText');
assert.ok(inspectStart >= 0 && inspectEnd > inspectStart, 'TISS operational-field inspector must be present');
const inspectSource = server.slice(inspectStart, inspectEnd);
const inspectContext = {
  sanitizeString(value, limit = 1000) {
    if (value === null || value === undefined) return '';
    return String(value).slice(0, limit);
  },
};
vm.createContext(inspectContext);
const inspectJs = ts.transpileModule(inspectSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
vm.runInContext(`${inspectJs}\nglobalThis.inspectTiss = inspectFinancialPlanInsuranceOperationalFields;`, inspectContext);
const inspectTiss = inspectContext.inspectTiss;

const payerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const planId = '11111111-1111-4111-8111-111111111111';
const tissOnlyKeys = [
  'insurancePlanName',
  'insuranceCardNumber',
  'insuranceCardHolder',
  'insuranceCardValidUntil',
  'isPrimaryInsurance',
  'authorizationCode',
  'authorizationValidUntil',
];

const genericInsurancePlan = {
  id: planId,
  serviceType: 'SPEECH_THERAPY',
  billingMode: 'INSURANCE',
  payerId,
  payerNameSnapshot: 'Unimed',
  amountCents: 10000,
  sessionsQuantity: 1,
  quantityPeriod: 'SESSION',
  status: 'ACTIVE',
  // Normalization currently carries these fields even when the financial UI did
  // not edit TISS. The generic serializer mode must remove them structurally.
  insurancePlanName: '',
  insuranceCardNumber: '',
  insuranceCardHolder: '',
  insuranceCardValidUntil: '',
  isPrimaryInsurance: false,
  authorizationCode: '',
  authorizationValidUntil: '',
};

const genericPayload = serializePatientFinancialPlanForGenericFinancialPayload(genericInsurancePlan);
assert.equal(genericPayload.billingMode, 'INSURANCE');
assert.equal(genericPayload.payerId, payerId);
assert.equal(genericPayload.payerNameSnapshot, 'Unimed');
assert.equal(genericPayload.amountCents, 10000);
assert.equal(genericPayload.serviceType, 'SPEECH_THERAPY');
for (const key of tissOnlyKeys) {
  assert.equal(key in genericPayload, false, `${key} must be structurally absent from generic financial payload`);
}
assert.equal(inspectTiss([genericPayload]).any, false, 'generic INSURANCE payload must not request TISS edit capability');
const genericJson = JSON.stringify(genericPayload);
for (const key of tissOnlyKeys) {
  assert.equal(genericJson.includes(`\"${key}\"`), false, `${key} must be absent from final JSON`);
}

// Repeated serialization of an unchanged plan is stable and retains the same logical id.
const repeatedGenericPayloads = Array.from({ length: 3 }, () =>
  serializePatientFinancialPlanForGenericFinancialPayload(genericInsurancePlan),
);
assert.deepEqual(repeatedGenericPayloads[1], repeatedGenericPayloads[0]);
assert.deepEqual(repeatedGenericPayloads[2], repeatedGenericPayloads[0]);
assert.equal(repeatedGenericPayloads[0].id, planId);

// Multiple specialties keep their independent financial identity.
const multipleSpecialties = [
  genericInsurancePlan,
  {
    id: '22222222-2222-4222-8222-222222222222',
    serviceType: 'PSYCHOLOGY',
    billingMode: 'PRIVATE',
    amountCents: 15000,
    status: 'ACTIVE',
  },
].map(serializePatientFinancialPlanForGenericFinancialPayload);
assert.deepEqual(multipleSpecialties.map((plan) => plan.serviceType), ['SPEECH_THERAPY', 'PSYCHOLOGY']);
assert.deepEqual(multipleSpecialties.map((plan) => plan.amountCents), [10000, 15000]);

// Security contract: explicit null/empty remains a protected mutation attempt.
assert.equal(
  inspectTiss([{ ...genericPayload, authorizationCode: null }]).any,
  true,
  'explicit authorizationCode:null must remain protected',
);
assert.equal(
  inspectTiss([{ ...genericPayload, insuranceCardNumber: '' }]).any,
  true,
  'explicit insuranceCardNumber:"" must remain protected',
);

// Authorized TISS serialization preserves the existing contract.
const authorizedTissPayload = serializePatientFinancialPlanForPayload({
  ...genericInsurancePlan,
  insurancePlanName: 'Unimed Nacional',
  insuranceCardNumber: '123456789',
  insuranceCardHolder: 'João da Silva',
  insuranceCardValidUntil: '2027-12-31',
  isPrimaryInsurance: true,
  authorizationCode: 'ABC123',
  authorizationValidUntil: '2027-12-31',
});
assert.equal(authorizedTissPayload.insuranceCardNumber, '123456789');
assert.equal(authorizedTissPayload.authorizationCode, 'ABC123');
assert.equal(authorizedTissPayload.insurancePlanName, 'Unimed Nacional');
assert.equal(inspectTiss([authorizedTissPayload]).any, true, 'authorized TISS payload must remain recognizable as a TISS mutation');

// PRIVATE behavior remains financial-only when the caller is outside TISS context.
const privatePayload = serializePatientFinancialPlanForGenericFinancialPayload({
  id: '22222222-2222-4222-8222-222222222222',
  serviceType: 'PSYCHOLOGY',
  billingMode: 'PRIVATE',
  amountCents: 15000,
  status: 'ACTIVE',
});
assert.equal(privatePayload.billingMode, 'PRIVATE');
assert.equal(privatePayload.amountCents, 15000);
for (const key of tissOnlyKeys) {
  assert.equal(key in privatePayload, false, `${key} must stay absent from PRIVATE generic financial payload`);
}

// The patient create/edit caller must explicitly select the domain boundary.
assert.match(
  coordinator,
  /\.map\([\s\S]{0,260}hasInsuranceTissModule[\s\S]{0,260}serializePatientFinancialPlanForPayload[\s\S]{0,160}serializePatientFinancialPlanForGenericFinancialPayload/,
  'patient save must explicitly select generic financial vs TISS serialization',
);
assert.match(coordinator, /editingPatientId[\s\S]{0,160}patient\.insurance\.edit[\s\S]{0,160}patient\.insurance\.create/);

// The server-side protection itself must remain intact.
assert.match(server, /PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED/);
assert.match(server, /Object\.prototype\.hasOwnProperty\.call\(plan, key\)/);

console.log('patientFinancialPlanFinanceWithoutTissPayload.regression.test.mjs: ok');
