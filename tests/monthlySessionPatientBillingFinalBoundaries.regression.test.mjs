import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260905101500_monthly_session_patient_billing.sql', 'utf8');
const financeUi = fs.readFileSync('src/components/PatientFinanceWorkspace.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const etapa1 = fs.readFileSync('supabase/migrations/20260904173500_patient_financial_plan_history_safe_payers.sql', 'utf8');

// 1) appointment_billing_contexts is preflighted as a relation + typed contract before DDL.
const firstAlter = migration.indexOf('alter table public.patient_financial_plans');
const preflight = migration.slice(0, firstAlter);
assert.match(preflight, /'public\.appointment_billing_contexts'/);
assert.match(preflight, /appointment_billing_contexts/);
assert.match(preflight, /id','uuid/);
assert.match(preflight, /organization_id','uuid/);
assert.match(preflight, /appointment_id','uuid/);
assert.match(preflight, /patient_id','uuid/);
assert.match(preflight, /payer_type','text/);
assert.match(preflight, /payer_id','uuid/);
assert.match(preflight, /payer_name_snapshot','text/);
assert.match(preflight, /service_type','text/);
assert.match(preflight, /updated_at','timestamptz/);
assert.match(preflight, /MONTHLY_SESSION_BILLING_PREFLIGHT_APPOINTMENT_BILLING_CONTEXT_DRIFT/);

// 2) One appointment -> one canonical engine, including the no-context fallback.
const resolverStart = migration.indexOf('create or replace function public.resolve_appointment_financial_engine_v1');
const resolverEnd = migration.indexOf('create or replace function public.appointment_uses_monthly_session_billing_v1', resolverStart);
const resolver = migration.slice(resolverStart, resolverEnd);
assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);
assert.match(resolver, /return 'MONTHLY_SESSION'/);
assert.match(resolver, /return 'AT_SESSION'/);
assert.match(resolver, /return 'AMBIGUOUS'/);
assert.match(resolver, /v_context_type=''/);
assert.match(resolver, /v_monthly_count=1 then return 'MONTHLY_SESSION'/);
assert.match(resolver, /v_monthly_count>1 then return 'AMBIGUOUS'/);
assert.match(migration, /when \(public\.resolve_appointment_financial_engine_v1\([\s\S]{0,260}= 'AT_SESSION'\)/);
assert.match(migration, /if v_engine <> 'MONTHLY_SESSION' then/);

// 3) Context update/remove cannot leave one appointment active in two monthly groups.
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_organization_id::text\|\|':monthly-session:'\|\|p_appointment_id::text/);
assert.match(migration, /idx_payment_items_one_active_charge_per_appointment/);
assert.match(migration, /MATERIAL_BILLING_GROUP_CHANGED/);
assert.match(migration, /appointment_billing_context_remove_monthly_session_finance/);
assert.match(migration, /BILLING_CONTEXT_REMOVED/);
assert.match(migration, /appointment_billing_context_tombstones/);
assert.match(migration, /v_is_removal:=v_old_explicit and not v_new_explicit/);
assert.match(migration, /FINANCIAL_ENGINE_/);

// 4) Any material movement freezes principal; adjustment flag/audit is used instead.
const lockedStart = migration.indexOf('create or replace function public.monthly_session_payment_locked_v1');
const lockedEnd = migration.indexOf('create or replace function public.refresh_monthly_session_payment_v1', lockedStart);
const locked = migration.slice(lockedStart, lockedEnd);
assert.match(locked, /'paid','partial','refunded','courtesy'/);
assert.match(locked, /paid_amount/);
assert.match(locked, /payment_transactions tx/);
assert.match(locked, /tx\.status='POSTED'/);
assert.match(migration, /monthly_adjustment_required=true/);
assert.match(migration, /MONTHLY_SESSION_ADJUSTMENT_REQUIRED/);

// 5) Zero active items cancel (not delete) the aggregate; same group can be reactivated.
const refreshStart = migration.indexOf('create or replace function public.refresh_monthly_session_payment_v1');
const refreshEnd = migration.indexOf('create or replace function public.mark_monthly_session_adjustment_required_v1', refreshStart);
const refresh = migration.slice(refreshStart, refreshEnd);
assert.match(refresh, /item\.active=true/);
assert.match(refresh, /v_count=0 then 'canceled'/);
assert.match(refresh, /canceled_at=case when v_count=0/);
assert.doesNotMatch(refresh, /delete from public\.payments/i);
assert.match(migration, /set canceled_at=null,canceled_by=null,due_date=v_due_date/);

// 6) Appointment item freezes price, competence, plan version and payer/service snapshot.
for (const token of [
  'unit_amount', 'subtotal', 'competence_month', 'patient_financial_plan_id',
  'patient_financial_plan_version', 'payer_id_snapshot', 'payer_name_snapshot',
  'service_type_snapshot', 'appointment_scheduled_at',
]) assert.match(migration, new RegExp(token));
assert.match(migration, /v_unit_amount:=round\(v_plan\.amount_cents::numeric\/100,2\)/);
assert.match(migration, /v_competence:=date_trunc\('month',v_effective_at at time zone 'America\/Sao_Paulo'\)::date/);
assert.match(migration, /v_effective_at:=coalesce\(v_appointment\.scheduled_start_at,v_appointment\.scheduled_at/);

// Timezone/backdated semantics are explicit and payment_date is not used for competence.
assert.match(migration, /America\/Sao_Paulo/);
assert.doesNotMatch(migration, /v_competence[^\n]*payment_date/);

// 7) Price/payer changes split by immutable item/group dimensions, not current patient state.
assert.match(migration, /v_plan\.logical_plan_id::text/);
assert.match(migration, /coalesce\(v_plan\.payer_id::text,'PRIVATE'\)/);
assert.match(migration, /v_service_key/);
assert.match(migration, /patient_financial_plan_version/);

// 8) Manual appointment-bound charging is rejected for monthly automatic appointments,
// while generic manual competence charging remains in the UI.
assert.match(migration, /prevent_manual_charge_for_monthly_session_appointment_v1/);
assert.match(migration, /MONTHLY_SESSION_MANUAL_APPOINTMENT_CHARGE_FORBIDDEN/);
assert.match(server, /MONTHLY_SESSION_MANUAL_APPOINTMENT_CHARGE_FORBIDDEN/);
assert.match(financeUi, /!isMonthlySessionBillingPlan\(plan\)/);
assert.match(financeUi, /Faturamento mensal automático por sessões realizadas/);
assert.match(financeUi, /manualCompetence/);
assert.match(financeUi, /MONTHLY_COMPETENCE/);

// 9) Etapa 1 v1 remains in place; v2 adds monthly items as history.
assert.match(etapa1, /create or replace function public\.reconcile_patient_financial_plans_v1/);
const v2Start = migration.indexOf('create or replace function public.reconcile_patient_financial_plans_v2');
const v2End = migration.indexOf('revoke all on function public.reconcile_patient_financial_plans_v2', v2Start);
const v2 = migration.slice(v2Start, v2End);
assert.match(v2, /appointment_private_financial_snapshots/);
assert.match(v2, /payment_appointment_items/);
assert.match(v2, /patient_financial_plan_id/);
assert.match(v2, /billing_mode, billing_frequency, pricing_unit, aggregation_method, payer_id/);
assert.match(v2, /v_billing_mode, v_billing_frequency, v_pricing_unit, v_aggregation_method, v_payer_id/);

// 10) TISS is not a dependency of the financial engine.
assert.doesNotMatch(migration, /requireClinicModule\(['"]insurance_tiss/);
assert.doesNotMatch(migration, /CLINIC_MODULE_NOT_ENTITLED/);

console.log('monthlySessionPatientBillingFinalBoundaries.regression.test.mjs: ok');
