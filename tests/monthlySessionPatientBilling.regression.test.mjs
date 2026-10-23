import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const server = fs.readFileSync('server.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const utilSource = fs.readFileSync('src/utils/patientFinancialPlan.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260905101500_monthly_session_patient_billing.sql', 'utf8');
const etapa1 = fs.readFileSync('supabase/migrations/20260904173500_patient_financial_plan_history_safe_payers.sql', 'utf8');
const privateEngine = fs.readFileSync('supabase/migrations/20260812022000_private_finance_membership_authority_v2.sql', 'utf8');
const financeUi = fs.readFileSync('src/components/PatientFinanceWorkspace.tsx', 'utf8');
const ledgerUtil = fs.readFileSync('src/utils/patientFinancialLedger.ts', 'utf8');

// Migration fails before dependent DDL when the shared appointment billing context drifted.
assert.match(migration, /'public\.appointment_billing_contexts'/);
for (const token of [
  "('id','uuid')", "('organization_id','uuid')", "('appointment_id','uuid')", "('patient_id','uuid')",
  "('payer_type','text')", "('payer_id','uuid')", "('payer_name_snapshot','text')",
  "('service_type','text')", "('updated_at','timestamptz')",
]) assert.match(migration, new RegExp(token.replace(/[()]/g, '\\$&')));
assert.match(migration, /MONTHLY_SESSION_BILLING_PREFLIGHT_APPOINTMENT_BILLING_CONTEXT_DRIFT/);
assert.match(migration, /MONTHLY_SESSION_BILLING_PREFLIGHT_ACTIVE_APPOINTMENT_UNIQUENESS_MISSING/);

// Explicit dimensions; legacy behavior is preserved and INSURANCE is not auto-enabled.
for (const field of ['billing_frequency', 'pricing_unit', 'aggregation_method']) {
  assert.match(migration, new RegExp(`add column if not exists ${field} text`));
  assert.match(server, new RegExp(`['"]${field}['"]`));
}
assert.match(migration, /set billing_frequency = 'AT_SESSION', pricing_unit = 'SESSION'[\s\S]{0,120}where billing_mode = 'PRIVATE'/);
assert.match(migration, /set billing_frequency = 'MONTHLY', pricing_unit = 'FIXED_PERIOD'[\s\S]{0,120}where billing_mode = 'MONTHLY'/);
assert.doesNotMatch(migration, /update public\.patient_financial_plans[\s\S]{0,180}billing_mode = 'INSURANCE'[\s\S]{0,180}ELIGIBLE_COMPLETED_SESSIONS/);

// One canonical receivable per coherent monthly group; appointment items are the per-session ledger.
assert.match(migration, /source='MONTHLY_SESSION_AGGREGATE'/);
assert.match(migration, /create unique index if not exists idx_payments_monthly_session_group/);
assert.match(migration, /create unique index if not exists idx_payment_items_monthly_session_key/);
for (const token of [
  'patient_financial_plan_id', 'patient_financial_plan_logical_id', 'patient_financial_plan_version',
  'payer_id_snapshot', 'payer_name_snapshot', 'competence_month', 'completion_at',
]) assert.match(migration, new RegExp(token));
assert.match(migration, /unit_amount=v_unit_amount|v_unit_amount,v_unit_amount/);
assert.match(migration, /v_unit_amount:=round\(v_plan\.amount_cents::numeric\/100,2\)/);
assert.match(migration, /v_plan\.logical_plan_id::text[\s\S]{0,240}v_plan\.payer_id::text[\s\S]{0,160}v_service_key/);

// Session eligibility is canonical COMPLETED; competence comes from the session month, not payment_date.
assert.match(migration, /lower\(coalesce\(v_appointment\.status,''\)\)='completed'/);
assert.match(migration, /v_effective_at:=coalesce\(v_appointment\.scheduled_start_at,v_appointment\.scheduled_at/);
assert.match(migration, /date_trunc\('month',v_effective_at at time zone 'America\/Sao_Paulo'\)/);
assert.doesNotMatch(migration, /v_competence[^\n]*payment_date/);

// Due date is isolated to this engine: September competence + day 5 resolves in October.
assert.match(migration, /create or replace function public\.monthly_session_due_date_v1/);
assert.match(migration, /date_trunc\('month', p_competence_month\)::date \+ interval '1 month'/);
assert.doesNotMatch(migration, /create or replace function public\.private_session_due_date_v1/);

// Incremental/idempotent hot path: trigger at canonical appointment boundary, group/item locks and unique keys.
assert.match(migration, /create trigger appointments_sync_monthly_session_finance/);
assert.match(migration, /sync_monthly_session_billing_for_appointment_v1/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /billing_item_key=v_item_key[\s\S]{0,2400}v_snapshot_material_equal[\s\S]{0,1200}action','NOOP'/);
assert.match(migration, /on conflict \(organization_id,billing_item_key\)/);
assert.doesNotMatch(migration, /select[\s\S]{0,120}from public\.appointments[\s\S]{0,120}date_trunc\('month'/i);

// Price changes do not reprice old sessions: item snapshots point to the exact plan version.
assert.match(migration, /plan\.valid_from<=v_effective_at/);
assert.match(migration, /v_effective_at<plan\.valid_until/);
assert.match(migration, /patient_financial_plan_version[\s\S]{0,700}v_plan\.version/);
assert.match(migration, /payment_appointment_items where patient_financial_plan_id = \$1/);
assert.match(server, /reconcile_patient_financial_plans_v3/);
assert.match(etapa1, /reconcile_patient_financial_plans_v1/); // Etapa 1 migration remains preserved.

// Reversal updates only an open group; financially touched/paid groups are immutable and flagged.
assert.match(migration, /MONTHLY_SESSION_REMOVED/);
assert.match(migration, /monthly_session_payment_locked_v1/);
assert.match(migration, /MONTHLY_SESSION_ADJUSTMENT_REQUIRED/);
assert.match(migration, /monthly_adjustment_required=true/);
assert.doesNotMatch(migration, /MONTHLY_SESSION_ADJUSTMENT_REQUIRED[\s\S]{0,400}update public\.payments[\s\S]{0,180}amount=/i);

// A single resolver owns engine selection. The legacy trigger runs only for AT_SESSION.
assert.match(migration, /create or replace function public\.resolve_appointment_financial_engine_v1/);
assert.match(migration, /when \(public\.resolve_appointment_financial_engine_v1\([\s\S]{0,260}= 'AT_SESSION'\)/);
assert.match(migration, /if v_engine <> 'MONTHLY_SESSION' then/);
assert.match(migration, /MONTHLY_PLAN_AMBIGUOUS|AMBIGUOUS/);
const gateStart=migration.indexOf('create or replace function public.resolve_appointment_financial_engine_v1');
const gateEnd=migration.indexOf('create or replace function public.sync_monthly_session_billing_for_appointment_v1', gateStart);
const gateSource=migration.slice(gateStart,gateEnd);
assert.match(gateSource, /plan\.valid_from<=v_effective_at/);
assert.match(gateSource, /v_effective_at<plan\.valid_until/);
assert.doesNotMatch(gateSource, /plan\.status='ACTIVE'/);
assert.match(gateSource, /v_monthly_count=1 then return 'MONTHLY_SESSION'/);
assert.match(gateSource, /v_monthly_count>1 then return 'AMBIGUOUS'/);
assert.match(privateEngine, /create or replace function public\.sync_private_appointment_finance\(\)/);
assert.match(privateEngine, /plan\.billing_mode = 'PRIVATE'/);

// Context removal is durable even before any item exists and cannot be silently recreated.
assert.match(migration, /create table if not exists public\.appointment_billing_context_tombstones/);
const tombstoneInsertPos = migration.indexOf('insert into public.appointment_billing_context_tombstones');
const tombstoneNoItemPos = migration.indexOf('if v_item.id is null then', tombstoneInsertPos);
assert.ok(tombstoneInsertPos >= 0 && tombstoneNoItemPos > tombstoneInsertPos);
assert.match(migration, /appointment_billing_context_tombstones tombstone[\s\S]{0,220}return 'NONE'/);
assert.match(migration, /deactivation_reason='BILLING_CONTEXT_REMOVED'/);
assert.match(migration, /appointment_billing_context_remove_monthly_session_finance/);
assert.match(migration, /after delete[\s\S]{0,120}appointment_billing_contexts/);
assert.match(migration, /v_old_explicit[\s\S]{0,500}v_is_removal:=v_old_explicit and not v_new_explicit/);
assert.match(migration, /if v_new_explicit then[\s\S]{0,320}delete from public\.appointment_billing_context_tombstones/);

// A manually created appointment charge cannot compete with the automatic monthly engine.
assert.match(migration, /prevent_manual_charge_for_monthly_session_appointment_v1/);
assert.match(migration, /MONTHLY_SESSION_MANUAL_APPOINTMENT_CHARGE_FORBIDDEN/);
assert.match(migration, /payment_items_prevent_monthly_session_manual_charge/);

// Zero active items preserve the payment for audit but cancel the active receivable; reactivation reuses the group.
assert.match(migration, /v_count=0 then 'canceled'/);
assert.match(migration, /canceled_at=case when v_count=0/);
assert.match(migration, /set canceled_at=null,canceled_by=null,due_date=v_due_date/);

// Any material posted transaction locks principal mutation, not only a fully PAID status.
assert.match(migration, /exists \([\s\S]{0,180}payment_transactions tx[\s\S]{0,120}tx\.status='POSTED'/);

// Security-definer helpers are not opened to browser roles.
for (const fn of [
  'reconcile_patient_financial_plans_v2',
  'resolve_appointment_financial_engine_v1',
  'sync_monthly_session_billing_for_appointment_v1',
  'refresh_monthly_session_payment_v1',
]) {
  assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`));
  assert.match(migration, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]{0,140}service_role`));
}
assert.match(migration, /set search_path = public, pg_temp/);
assert.match(migration, /payer\.organization_id=p_organization_id/);
assert.match(migration, /Finance-only clinics do not need TISS\/Agenda billing context[\s\S]{0,1800}v_candidate_count <> 1/);
assert.match(migration, /a\.id=p_appointment_id[\s\S]{0,100}p_organization_id/);

// Patient UI is explicit and does not overload fixed MONTHLY semantics.
assert.match(coordinator, /Faturamento mensal por sessões realizadas/);
assert.match(coordinator, /billingFrequency: "MONTHLY"[\s\S]{0,100}pricingUnit: "SESSION"[\s\S]{0,120}aggregationMethod: "ELIGIBLE_COMPLETED_SESSIONS"/);
assert.match(coordinator, /isMonthlySessionPlan \? "Valor por sessão"/);
assert.match(coordinator, /\(isMonthlyPlan \|\| isMonthlySessionPlan\)/);

// Existing Finance UI already renders one payment row with its appointment composition lazily from ledger children.
assert.match(financeUi, /charge\.items\.length[\s\S]{0,120}sessão/);
assert.match(financeUi, /Composição e histórico/);
assert.match(financeUi, /charge\.items\.map/);
assert.match(financeUi, /Ajuste necessário/);
assert.match(financeUi, /formatCompetenceMonth/);
assert.match(financeUi, /!isMonthlySessionBillingPlan\(plan\)/);
assert.match(financeUi, /Faturamento mensal automático por sessões realizadas/);
assert.match(ledgerUtil, /monthlyAdjustmentRequired/);
assert.match(ledgerUtil, /monthlySessionCount/);
assert.match(server, /monthlySessionChargeIds[\s\S]{0,420}item\?\.active === true/);

// Utility behavior: fixed monthly and legacy private keep their semantics; monthly-session is opt-in.
const utilContext = { console, exports: {}, require: () => ({ clinicalSpecialtiesMatch: () => false }) };
vm.createContext(utilContext);
const transpiled = ts.transpileModule(utilSource.replace(/export\s+/g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
vm.runInContext(`${transpiled}\nglobalThis.createPlan=createPatientFinancialPlan; globalThis.isMonthlySession=isMonthlySessionBillingPlan; globalThis.monthlyProjection=getFinancialPlanMonthlyProjectionValue;`, utilContext);
const legacyPrivate = utilContext.createPlan({ billingMode: 'PRIVATE', amountCents: 18000 });
assert.equal(legacyPrivate.billingFrequency, 'AT_SESSION');
assert.equal(legacyPrivate.pricingUnit, 'SESSION');
assert.equal(utilContext.isMonthlySession(legacyPrivate), false);
const fixedMonthly = utilContext.createPlan({ billingMode: 'MONTHLY', amountCents: 70000 });
assert.equal(fixedMonthly.billingFrequency, 'MONTHLY');
assert.equal(fixedMonthly.pricingUnit, 'FIXED_PERIOD');
assert.equal(utilContext.monthlyProjection(fixedMonthly), 700);
const variablePrivate = utilContext.createPlan({
  billingMode: 'PRIVATE', billingFrequency: 'MONTHLY', pricingUnit: 'SESSION',
  aggregationMethod: 'ELIGIBLE_COMPLETED_SESSIONS', amountCents: 18000, dueDay: 5,
});
assert.equal(utilContext.isMonthlySession(variablePrivate), true);
assert.equal(utilContext.monthlyProjection(variablePrivate), 0, 'session-priced monthly billing must not masquerade as a fixed monthly projection');

console.log('monthlySessionPatientBilling.regression.test.mjs: ok');
