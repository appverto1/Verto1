import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const server = fs.readFileSync('server.ts', 'utf8');

const protectedDbFields = [
  'insurance_plan_name',
  'authorization_code',
  'authorization_valid_until',
];

// The public/base financial-plan read retains generic payer + pricing data but not TISS operations.
const selectStart = server.indexOf('const PATIENT_FINANCIAL_PLAN_BASE_SELECT');
const selectEnd = server.indexOf('const PATIENT_MUTATION_SELECT');
assert.ok(selectStart >= 0 && selectEnd > selectStart, 'financial-plan select boundary must exist');
const selectSource = server.slice(selectStart, selectEnd);
const baseMatch = selectSource.match(/const PATIENT_FINANCIAL_PLAN_BASE_SELECT = \[([\s\S]*?)\]\.join\(','\);/);
assert.ok(baseMatch, 'base financial-plan select must be defined');
const baseBlock = baseMatch[1];
for (const field of ['billing_mode', 'payer_id', 'payer_name_snapshot', 'amount_cents', 'quantity_period']) {
  assert.match(baseBlock, new RegExp(`['\"]${field}['\"]`), `base select must retain ${field}`);
}
for (const field of protectedDbFields) {
  assert.doesNotMatch(baseBlock, new RegExp(`['\"]${field}['\"]`), `base select must not expose ${field}`);
  assert.match(selectSource, new RegExp(`['\"]${field}['\"]`), `TISS select must retain ${field}`);
}

const selectContext = {};
vm.createContext(selectContext);
const transpiledSelect = ts.transpileModule(selectSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
vm.runInContext(`${transpiledSelect}\nglobalThis.selectFor = patientFinancialPlanSelectForCapabilities;`, selectContext);
const selectFor = selectContext.selectFor;
const baseSelect = selectFor(new Set(['patient.demographics.edit', 'finance.entries.manage']));
for (const field of protectedDbFields) assert.equal(baseSelect.includes(field), false, `Finance without TISS must not select ${field}`);
assert.equal(baseSelect.includes('payer_id'), true, 'Finance without TISS must retain payer_id');
assert.equal(baseSelect.includes('amount_cents'), true, 'Finance without TISS must retain pricing');
const tissSelect = selectFor(new Set(['patient.demographics.edit', 'patient.insurance.view']));
for (const field of protectedDbFields) assert.equal(tissSelect.includes(field), true, `TISS read capability must select ${field}`);

// Both generic read paths over the same canonical source must use the capability-aware projection.
const directRouteStart = server.indexOf("app.get('/api/patients/:patientId/financial-plans'");
const directRouteEnd = server.indexOf("app.put('/api/patients/:patientId/financial-plans'", directRouteStart);
assert.ok(directRouteStart >= 0 && directRouteEnd > directRouteStart);
const directRoute = server.slice(directRouteStart, directRouteEnd);
assert.match(directRoute, /patientFinancialPlanSelectForCapabilities\([\s\S]{0,120}req\.authorizationContext\?\.capabilities/);
assert.match(directRoute, /\.select\(financialPlanSelect\)/);

const recordRouteStart = server.indexOf("app.get('/api/patient-records/:patientId'");
const recordRouteEnd = server.indexOf('const NOTE_VISIBILITY_ALLOWED', recordRouteStart);
assert.ok(recordRouteStart >= 0 && recordRouteEnd > recordRouteStart);
const recordRoute = server.slice(recordRouteStart, recordRouteEnd);
assert.match(recordRoute, /\.select\(patientFinancialPlanSelectForCapabilities\(capabilityContext\?\.capabilities\)\)/);

// Legacy/encrypted patient payloads are also redacted before response, preventing a fallback leak.
const redactStart = server.indexOf('function redactPatientFinancialPlanTissOperationalFields');
const redactEnd = server.indexOf('function redactPatientFinancialPayload', redactStart);
assert.ok(redactStart >= 0 && redactEnd > redactStart, 'plan-level TISS redactor must exist');
const redactSource = server.slice(redactStart, redactEnd);
const redactContext = {};
vm.createContext(redactContext);
const transpiledRedact = ts.transpileModule(redactSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
vm.runInContext(`${transpiledRedact}\nglobalThis.redactPlans = redactPatientFinancialPlanTissOperationalFields;`, redactContext);
const redacted = redactContext.redactPlans({
  financialPlans: [{
    billing_mode: 'INSURANCE',
    payer_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    amount_cents: 10000,
    insurance_plan_name: 'Plano Ouro',
    authorization_code: 'AUTH-1',
    authorization_valid_until: '2027-12-31',
  }],
});
assert.equal(redacted.financialPlans[0].payer_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
assert.equal(redacted.financialPlans[0].amount_cents, 10000);
for (const field of protectedDbFields) assert.equal(Object.hasOwn(redacted.financialPlans[0], field), false, `${field} must be redacted`);

// Mutation boundary must distinguish omission from explicit clear/change for callers without TISS edit.
assert.match(server, /Presence is itself a protected mutation attempt for callers without TISS edit/);
assert.match(server, /patient\.insurance\.edit'[\s\S]{0,180}requestedPlanInsuranceFields\.any/);
assert.match(server, /TISS-only operational fields are intentionally excluded from replay equality/);

console.log('patientFinancialPlanTissReadBoundary.regression.test.mjs: ok');
