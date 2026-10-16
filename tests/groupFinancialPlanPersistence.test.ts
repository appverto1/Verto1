import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { normalizePatientFinancialPlans, isPatientFinancialPlanComplete, serializePatientFinancialPlanForPayload } from '../src/utils/patientFinancialPlan';

// Execute the real server mapper, not a test copy, across a Save/read/Save cycle.
const source = fs.readFileSync('server.ts', 'utf8');
const start = source.indexOf('function buildPatientFinancialPlanRows(');
const end = source.indexOf('\nasync function persistPatientFinancialPlans', start);
const context: any = {
  normalizePatientFinancialPlans, isPatientFinancialPlanComplete, serializePatientFinancialPlanForPayload,
  sanitizeString: (v: any, n = 1000) => String(v ?? '').trim().slice(0, n),
  sanitizeTextField: (v: any, n = 1000) => String(v ?? '').trim().slice(0, n),
  sanitizeIsoDateOnly: (v: any) => v || null,
  isUuid: (v: any) => /^[0-9a-f-]{36}$/i.test(v),
  asSafeNumber: (v: any, min: number, max: number) => v ? Math.min(max, Math.max(min, Number(v))) : null,
  cleanObject: (v: any) => Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined)),
};
vm.createContext(context);
vm.runInContext(ts.transpileModule(source.slice(start, end), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, context);
const build = (plans: any[]) => JSON.parse(JSON.stringify(context.buildPatientFinancialPlanRows({
  financialPlans: plans, patientId: '10000000-0000-4000-8000-000000000001',
  clinicId: '20000000-0000-4000-8000-000000000001',
})));
const original = {id: '30000000-0000-4000-8000-000000000001', serviceType: 'SPEECH_THERAPY', billingMode: 'PRIVATE', amount: '150,00', groupAmount: '80,00'};
const saved = build([original])[0];
assert.equal(saved.amount_cents, 15000);
assert.equal(saved.group_amount_cents, 8000);
const reload = normalizePatientFinancialPlans([saved])[0];
assert.equal(reload.groupAmount, '80,00');
const resaved = build([reload])[0];
assert.equal(resaved.group_amount_cents, 8000);
assert.equal(resaved.amount_cents, 15000);
assert.equal(build([{...reload, groupAmount: '95,00'}])[0].group_amount_cents, 9500);
assert.equal(build([{...reload, groupAmount: ''}])[0].group_amount_cents, 0);
for (const key of ['groupAmountCents', 'group_amount_cents']) {
  const plan: any = {...original, [key]: 7000}; delete plan.groupAmount;
  assert.equal(build([plan])[0].group_amount_cents, 7000);
}
const legacy: any = {...original}; delete legacy.groupAmount;
assert.equal(Object.hasOwn(build([legacy])[0], 'group_amount_cents'), false, 'legacy Save must preserve the stored group rate');
assert.match(source.slice(source.indexOf('const PATIENT_FINANCIAL_PLAN_BASE_SELECT'), source.indexOf('const PATIENT_FINANCIAL_PLAN_TISS_OPERATIONAL_SELECT')), /'group_amount_cents'/);
assert.match(source.slice(source.indexOf('function patientFinancialPlanSemanticFingerprint'), source.indexOf('function patientFinancialPlanIdentityKeys')), /group_amount_cents:/);
console.log('groupFinancialPlanPersistence: Save, canonical reload, resave, independent rates and legacy omission passed');
