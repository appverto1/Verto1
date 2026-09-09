import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260905101500_monthly_session_patient_billing.sql', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

const resolverStart = migration.indexOf('create or replace function public.resolve_appointment_financial_engine_v1');
const resolverEnd = migration.indexOf('create or replace function public.appointment_uses_monthly_session_billing_v1', resolverStart);
const resolver = migration.slice(resolverStart, resolverEnd);
const syncStart = migration.indexOf('create or replace function public.sync_monthly_session_billing_for_appointment_v1');
const syncEnd = migration.indexOf('create or replace function public.sync_monthly_session_appointment_trigger_v1', syncStart);
const sync = migration.slice(syncStart, syncEnd);
const contextStart = migration.indexOf('create or replace function public.sync_monthly_session_context_trigger_v1');
const contextEnd = migration.indexOf('create or replace function public.prevent_manual_charge_for_monthly_session_appointment_v1', contextStart);
const context = migration.slice(contextStart, contextEnd);

// A) The real write API is PATCH/update-upsert; there is no HTTP DELETE route.
assert.match(server, /app\.patch\('\/api\/appointments\/:appointmentId\/billing-context'/);
assert.match(server, /upsertAppointmentBillingContextRow\(payload/);
assert.doesNotMatch(server, /app\.delete\('\/api\/appointments\/:appointmentId\/billing-context'/);

// Durable tombstone is independent from payment items, so remove-before-completed is represented.
assert.match(migration, /create table if not exists public\.appointment_billing_context_tombstones/);
assert.match(migration, /primary key \(organization_id, appointment_id\)/);
assert.match(context, /v_is_removal:=v_old_explicit and not v_new_explicit/);
const tombstoneInsert = context.indexOf('insert into public.appointment_billing_context_tombstones');
const noItemReturn = context.indexOf('if v_item.id is null then');
assert.ok(tombstoneInsert >= 0 && noItemReturn > tombstoneInsert, 'tombstone must be persisted before checking for an existing monthly item');
assert.match(resolver, /appointment_billing_context_tombstones tombstone[\s\S]{0,500}return 'NONE'/);

// Explicit new context supersedes the tombstone; physical DELETE is also covered defensively.
assert.match(context, /if v_new_explicit then[\s\S]{0,260}delete from public\.appointment_billing_context_tombstones/);
assert.match(migration, /after delete[\s\S]{0,120}on public\.appointment_billing_contexts/);
assert.match(context, /deactivation_reason='BILLING_CONTEXT_REMOVED'/);

// With a tombstone, both engines consume the same resolver: NONE means monthly no-op and AT_SESSION trigger does not fire.
assert.match(resolver, /return 'NONE'/);
assert.match(migration, /when \(public\.resolve_appointment_financial_engine_v1\([\s\S]{0,260}= 'AT_SESSION'\)/);
assert.match(sync, /if v_engine <> 'MONTHLY_SESSION' then/);

// B) NOOP requires same group AND material snapshot equality, never billing_item_key alone.
assert.match(sync, /billing_item_key=v_item_key[\s\S]{0,260}v_snapshot_material_equal :=/);
for (const token of [
  'patient_financial_plan_id', 'patient_financial_plan_logical_id', 'patient_financial_plan_version',
  'unit_amount', 'subtotal', 'appointment_scheduled_at', 'professional_id',
  'service_type_snapshot', 'specialty_snapshot', 'payer_id_snapshot', 'payer_name_snapshot',
  'competence_month', 'completion_at',
]) assert.match(sync, new RegExp(token));
assert.match(sync, /if v_snapshot_material_equal then[\s\S]{0,180}'NOOP'/);

// Same group + changed snapshot reconciles the single item while payment is open.
assert.match(sync, /v_snapshot_changed_same_group := true/);
assert.match(sync, /billing_item_key is distinct from v_item_key/);
assert.match(sync, /on conflict \(organization_id,billing_item_key\)[\s\S]{0,1200}patient_financial_plan_version=excluded\.patient_financial_plan_version/);
assert.match(sync, /MONTHLY_SESSION_RECONCILED/);
assert.match(sync, /'action',case when v_snapshot_changed_same_group then 'RECONCILED' else 'INCLUDED' end/);

// Same group + changed snapshot on a financially moved payment never rewrites the item/principal.
const snapshotLockPos = sync.indexOf("'Snapshot financeiro da sessão mudou após movimentação financeira; item e recebível originais preservados.'");
const upsertPos = sync.indexOf('insert into public.payment_appointment_items');
assert.ok(snapshotLockPos >= 0 && upsertPos > snapshotLockPos, 'lock branch must run before item upsert');
assert.match(sync, /v_snapshot_material_equal[\s\S]{0,1800}monthly_session_payment_locked_v1[\s\S]{0,500}ADJUSTMENT_REQUIRED/);

console.log('monthlySessionPatientBillingLastBoundaries.regression.test.mjs: ok');
