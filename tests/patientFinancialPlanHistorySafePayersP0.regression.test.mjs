import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260904173500_patient_financial_plan_history_safe_payers.sql', 'utf8');
const privateEngine = fs.readFileSync('supabase/migrations/20260812022000_private_finance_membership_authority_v2.sql', 'utf8');

// P0: no destructive delete-all/insert-all in the server persistence path.
assert.match(server, /supabase\.rpc\('reconcile_patient_financial_plans_v3'/);
assert.doesNotMatch(server, /from\('patient_financial_plans'\)[\s\S]{0,120}\.delete\(\)[\s\S]{0,160}\.eq\('patient_id', params\.patientId\)/);

// Versioning foundation and historical protection.
for (const token of ['client_plan_key', 'logical_plan_id', 'version', 'valid_from', 'valid_until', 'supersedes_plan_id']) {
  assert.match(migration, new RegExp(token));
}
assert.match(migration, /appointment_private_financial_snapshots[\s\S]{0,180}legacy_patient_financial_plan_id/);
assert.match(migration, /status = 'INACTIVE'/);
assert.match(migration, /insert into public\.patient_financial_plans[\s\S]{0,900}coalesce\(v_current\.version, 1\) \+ 1/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /PATIENT_FINANCIAL_PLAN_PAYER_SCOPE_INVALID/);
assert.match(migration, /PATIENT_FINANCIAL_PLAN_STALE_VERSION/);
assert.match(server, /client_plan_key: sanitizeString\(plan\.id, 120\)/);
assert.match(migration, /grant execute on function public\.reconcile_patient_financial_plans_v1\(uuid, uuid, uuid, jsonb, boolean\)[\s\S]{0,80}service_role/);
const monthlyMigration = fs.readFileSync('supabase/migrations/20260905101500_monthly_session_patient_billing.sql', 'utf8');
assert.match(monthlyMigration, /create or replace function public\.reconcile_patient_financial_plans_v2/);
assert.match(monthlyMigration, /appointment_private_financial_snapshots[\s\S]{0,260}payment_appointment_items[\s\S]{0,180}patient_financial_plan_id/);
assert.match(migration, /p_preserve_insurance_context boolean default false/);
assert.match(migration, /PATIENT_FINANCIAL_PLAN_INSURANCE_MUTATION_NOT_ALLOWED/);
assert.match(migration, /not coalesce\(p_preserve_insurance_context, false\)[\s\S]{0,120}billing_mode[\s\S]{0,80}INSURANCE/);
assert.match(server, /preserveInsuranceContext: payerMutationBoundary\.preserveInsuranceContext/);
assert.match(server, /rows = rows\.filter\(\(row: any\) => !patientFinancialPlanIsInsurance\(row\)\)/);

// Current reads are canonical ACTIVE rows only.
const financialPlansGetStart = server.indexOf("app.get('/api/patients/:patientId/financial-plans'");
const financialPlansGetEnd = server.indexOf("app.put('/api/patients/:patientId/financial-plans'", financialPlansGetStart);
assert.ok(financialPlansGetStart >= 0 && financialPlansGetEnd > financialPlansGetStart);
assert.match(server.slice(financialPlansGetStart, financialPlansGetEnd), /\.eq\('status', 'ACTIVE'\)/);
const patientRecordGetStart = server.indexOf("app.get('/api/patient-records/:patientId'");
const patientRecordGetEnd = server.indexOf('const NOTE_VISIBILITY_ALLOWED', patientRecordGetStart);
assert.ok(patientRecordGetStart >= 0 && patientRecordGetEnd > patientRecordGetStart);
assert.match(server.slice(patientRecordGetStart, patientRecordGetEnd), /capabilities\?\.has\('patient\.demographics\.edit'\)[\s\S]*financialPlans: canonicalPlansResult\.data/);

// Convênio as payer identity no longer implies TISS.
assert.match(server, /billingMode=INSURANCE and payer identity are generic financial master data/);
assert.match(server, /const PATIENT_GENERIC_PAYER_PAYLOAD_KEYS = new Set/);
assert.match(server, /if \(!canViewFinance && !canViewTissInsurance\)[\s\S]{0,180}PATIENT_GENERIC_PAYER_PAYLOAD_KEYS/);
assert.doesNotMatch(server, /requestedTypeProvided[\s\S]{0,260}return true/);
assert.doesNotMatch(server, /normalizedMode === 'INSURANCE'[\s\S]{0,120}patientPayloadRequestsInsuranceCreateCapability/);
assert.match(server, /function patientPayloadRequestsGenericPayerCapability\(body: any\): boolean/);
assert.match(server, /PATIENT_PAYER_CONTEXT_CAPABILITY_REQUIRED/);
assert.match(server, /finance\.entries\.manage'[\s\S]{0,120}patient\.insurance\.edit/);
assert.match(server, /app\.get\('\/api\/payer-options'[^\n]*requireAnyClinicCapability\('finance\.payments\.view', 'patient\.insurance\.view'\)/);
assert.match(server, /app\.post\('\/api\/admin\/payers'[^\n]*requireAnyClinicCapability\('finance\.entries\.manage', 'billing\.mapping\.manage'\)/);
assert.match(server, /app\.patch\('\/api\/admin\/payers\/:payerId'[^\n]*requireAnyClinicCapability\('finance\.entries\.manage', 'billing\.mapping\.manage'\)/);

// TISS extensions remain gated.
assert.match(server, /app\.get\('\/api\/admin\/payers\/:payerId\/requirements'[^\n]*requireClinicModule\('insurance_tiss'\)/);
assert.match(server, /payer_tiss_profiles/);

// UI: Finance can select INSURANCE without TISS, but TISS-only details remain hidden.
assert.match(coordinator, /filter\(\(option\) => canAccessClinicFinance \|\| hasInsuranceTissModule \|\| option\.value !== "INSURANCE"\)/);
assert.match(coordinator, /Cadastrar novo convênio/);
assert.match(coordinator, /const canManageSharedPayers = hasCapability\("finance\.entries\.manage"\) \|\| hasCapability\("billing\.mapping\.manage"\);/);
assert.match(coordinator, /\{hasInsuranceTissModule && \([\s\S]{0,900}Plano \/ categoria/);
assert.match(coordinator, /const canManagePatientFinancialPlan = hasCapability\("patient\.demographics\.edit"\);/);

// PRIVATE/SESSION engine remains based on ACTIVE rows and historical snapshot ids.
assert.match(privateEngine, /plan\.status = 'ACTIVE'[\s\S]{0,220}plan\.billing_mode = 'PRIVATE'/);
assert.match(privateEngine, /legacy_patient_financial_plan_id/);

console.log('patientFinancialPlanHistorySafePayersP0.regression.test.mjs: ok');
