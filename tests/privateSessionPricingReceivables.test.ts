import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPatientFinancialAppointmentRows,
  buildPatientFinancialChargeRows,
  resolvePatientFinancialStatus
} from '../src/utils/patientFinancialLedger';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260727010000_private_session_pricing_receivables.sql');
const canonicalFinanceMigration = read('supabase/migrations/20260716120000_patient_appointment_finance.sql');
const verification = read('supabase/verification/20260727010000_private_session_pricing_receivables_checks.sql');
const databaseTest = read('supabase/tests/20260727010000_private_session_pricing_receivables_test.sql');
const server = read('server.ts');
const dataService = read('src/services/dataService.ts');
const pricingManagement = read('src/components/PrivatePricingManagement.tsx');
const coordinator = read('src/components/CoordinatorDashboard.tsx');
const workspace = read('src/components/PatientFinanceWorkspace.tsx');
const calendar = read('src/components/Calendar.tsx');

const tests: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => tests.push({ name, run });

test('migration is additive and preserves old migrations and data', () => {
  for (const forbidden of [/\btruncate\b/i, /\bdelete\s+from\b/i, /\bdrop\s+table\b/i]) {
    assert.doesNotMatch(migration, forbidden);
  }
  for (const marker of [
    'create table if not exists public.private_session_price_rules',
    'create table if not exists public.patient_private_pricing_agreements',
    'create table if not exists public.appointment_private_financial_snapshots',
    'create table if not exists public.private_financial_idempotency_requests',
    'create or replace view public.private_session_finance_diagnostics_v1'
  ]) assert.ok(migration.includes(marker), marker);
});

test('migration is atomic and resolves pgcrypto only from extensions', () => {
  const executableMigration = migration.replace(/^\s*--.*$/gm, '').trim();
  assert.match(executableMigration, /^begin;/i);
  assert.match(executableMigration, /commit;\s*$/i);
  assert.match(migration, /create extension if not exists pgcrypto with schema extensions;/i);

  const digestCalls = migration.match(/\b(?:extensions\.)?digest\(/g) || [];
  assert.equal(digestCalls.length, 3);
  assert.ok(digestCalls.every((call) => call === 'extensions.digest('));

  for (const [name, nextName] of [
    ['save_private_session_price_rule_v1', 'save_patient_private_pricing_agreement_v1'],
    ['save_patient_private_pricing_agreement_v1', 'apply_private_patient_financial_operation_v2'],
    ['apply_private_patient_financial_operation_v2', 'sync_private_appointment_finance']
  ]) {
    const start = migration.indexOf(`create or replace function public.${name}`);
    const end = migration.indexOf(`create or replace function public.${nextName}`, start + 1);
    const body = migration.slice(start, end > start ? end : undefined);
    assert.match(body, /set search_path = public, extensions/i, name);
    assert.match(body, /extensions\.digest\(/, name);
    assert.doesNotMatch(body, /(^|[^.\w])digest\(/m, name);
  }
});

test('price hierarchy and server-side recurrence resolution are explicit', () => {
  const resolver = migration.slice(
    migration.indexOf('create or replace function public.resolve_private_session_price_v1'),
    migration.indexOf('create or replace function public.resolve_private_session_prices_v1')
  );
  assert.match(resolver, /if v_agreement\.id is not null[\s\S]*?'PATIENT_AGREEMENT'[\s\S]*?elsif v_legacy_plan\.id is not null[\s\S]*?elsif v_rule\.id is not null/);
  assert.match(resolver, /when 'SERVICE' then 'SERVICE_RULE'[\s\S]*?when 'SPECIALTY' then 'SPECIALTY_RULE'[\s\S]*?else 'CLINIC_DEFAULT'/);
  assert.match(resolver, /order by[\s\S]*?scope_type = 'SERVICE'[\s\S]*?then 1[\s\S]*?scope_type = 'SPECIALTY'[\s\S]*?then 2[\s\S]*?else 3/);
  assert.match(migration, /PRIVATE_SESSION_ZERO_JUSTIFICATION_REQUIRED/);
  assert.match(migration, /PRIVATE_SESSION_DISCOUNT_REASON_REQUIRED/);
  assert.match(migration, /v_series_resolutions[\s\S]*?recurrence_group/i);
  assert.match(server, /validatePrivateAppointmentPricingBatch[\s\S]*?resolve_private_session_prices_v1/);
});

test('snapshot, charge and financial operation stay transactional and idempotent', () => {
  assert.match(migration, /after insert or update[\s\S]*?sync_private_appointment_finance/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(canonicalFinanceMigration, /idx_payment_items_one_active_charge_per_appointment/i);
  assert.match(migration, /PRIVATE_FINANCIAL_OPERATION_IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /return v_existing\.response_payload/);
  assert.match(migration, /prevent_private_financial_snapshot_update/);
  assert.match(migration, /PRIVATE_FINANCIAL_SNAPSHOT_IMMUTABLE/);
  assert.match(migration, /PRIVATE_SESSION_MANUAL_CANCELLATION_DECISION_REQUIRED/);
  assert.match(migration, /PRIVATE_SESSION_MANUAL_NO_SHOW_DECISION_REQUIRED/);
  assert.match(migration, /PRIVATE_SESSION_MANUAL_POLICY_AMOUNT_INVALID/);
});

test('late-cancellation reschedule exposes all five explicit audited decisions', () => {
  for (const decision of [
    'KEEP_PREVIOUS_CHARGE',
    'CONVERT_TO_CREDIT',
    'EXEMPT_PREVIOUS_CHARGE',
    'CREATE_NEW_CHARGE',
    'TRANSFER_TO_RESCHEDULED_SESSION'
  ]) {
    assert.ok(migration.includes(decision), `migration: ${decision}`);
    assert.ok(coordinator.includes(decision), `coordinator: ${decision}`);
  }
  assert.match(migration, /PRIVATE_LATE_CANCELLATION_RESCHEDULE_DECISION/);
  assert.match(server, /validatePrivateLateCancellationRescheduleBatch/);
  assert.match(server, /PRIVATE_LATE_CANCELLATION_RESCHEDULE_DECISIONS/);
});

test('all private tables, view and RPCs are service-role only', () => {
  for (const object of [
    'private_session_price_rules',
    'patient_private_pricing_agreements',
    'appointment_private_financial_snapshots',
    'private_financial_idempotency_requests',
    'private_session_finance_diagnostics_v1'
  ]) {
    assert.match(migration, new RegExp(`revoke all on public\\.${object} from public, anon, authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant [^;]+ on public\\.${object} to service_role`, 'i'));
  }
  for (const fn of [
    'resolve_private_session_price_v1',
    'resolve_private_session_prices_v1',
    'save_private_session_price_rule_v1',
    'save_patient_private_pricing_agreement_v1',
    'apply_private_patient_financial_operation_v2'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`, 'i'));
  }
});

test('backend derives tenant and exposes only role-protected routes', () => {
  const privateFinanceModule = server.slice(
    server.indexOf("app.get('/api/private-pricing/catalog'"),
    server.indexOf('// Legacy payments API kept for old rows and backward compatibility.')
  );
  const catalog = privateFinanceModule.slice(
    0,
    privateFinanceModule.indexOf("app.post('/api/private-pricing/resolve'")
  );
  assert.match(catalog, /currentClinicId\(req\.session\.user\)/);
  assert.match(catalog, /Promise\.all/);
  assert.doesNotMatch(catalog, /req\.body.*organization/i);
  assert.doesNotMatch(privateFinanceModule, /req\.session\.user\?\.(?:organizationId|organization_id)/);
  assert.doesNotMatch(privateFinanceModule, /school_organization_id/);
  assert.equal(
    (privateFinanceModule.match(/const organizationId = clinicId;/g) || []).length,
    11,
    'all private-pricing and patient-finance routes must use the active clinic'
  );
  assert.match(server, /app\.post\('\/api\/private-pricing\/rules'[\s\S]*?requireRoles\('admin', 'owner'\)/);
  assert.match(server, /app\.post\('\/api\/private-pricing\/patients\/:patientId\/agreements'[\s\S]*?requireRoles\('admin', 'owner'\)/);
  assert.match(server, /apply_private_patient_financial_operation_v2/);
  assert.match(server, /appointmentRequestHash[\s\S]*?previousRequestHash[\s\S]*?409/);
});

test('frontend uses backend routes, shows composition and reuses batched ledger data', () => {
  for (const method of [
    'getPrivatePricingCatalog',
    'resolvePrivateSessionPrice',
    'savePrivateSessionPriceRule',
    'savePatientPrivatePricingAgreement',
    'getPrivateAppointmentFinancialSnapshot'
  ]) assert.ok(dataService.includes(`async ${method}`), method);
  assert.doesNotMatch(dataService.slice(dataService.indexOf('async getPrivatePricingCatalog')), /\.from\(['"]private_session/);
  for (const label of [
    'Preços de sessões particulares',
    'Criar nova versão',
    'Histórico preservado',
    'Acordo particular do paciente'
  ]) assert.ok(pricingManagement.includes(label), label);
  for (const marker of ['price_source_label', 'payer_name', 'cancellation_free_until']) {
    assert.ok(coordinator.includes(marker), marker);
  }
  assert.match(calendar, /Particular/);
  assert.match(calendar, /patientFinance/);
  assert.match(workspace, /privateSnapshots/);
  assert.match(workspace, /payerFilter/);
});

test('ledger maps latest immutable snapshot without per-card fetches', () => {
  const rows = buildPatientFinancialAppointmentRows({
    appointments: [{
      id: 'appointment-1',
      patient_id: 'patient-1',
      therapist_id: 'professional-1',
      scheduled_at: '2026-07-27T12:00:00Z',
      financialContextType: 'PRIVATE'
    }],
    charges: [{
      id: 'payment-1',
      amount: 180,
      original_amount: 150,
      additional_amount: 30,
      paid_amount: 100,
      balance_amount: 80,
      financial_status: 'partial'
    }],
    items: [{
      appointment_id: 'appointment-1',
      payment_id: 'payment-1',
      active: true
    }],
    privateSnapshots: [
      { appointment_id: 'appointment-1', payment_id: 'payment-1', snapshot_version: 1, payer_name: 'Responsável', price_source_label: 'Regra antiga' },
      { appointment_id: 'appointment-1', payment_id: 'payment-1', snapshot_version: 2, payer_name: 'Responsável', price_source_label: 'Acordo do paciente', specialty_name: 'ABA' }
    ]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'partial');
  assert.equal(rows[0].priceSourceLabel, 'Acordo do paciente');
  assert.equal(rows[0].specialty, 'ABA');

  const charges = buildPatientFinancialChargeRows({
    charges: [{ id: 'payment-1', patient_id: 'patient-1', amount: 180, balance_amount: 80 }],
    items: [],
    transactions: [],
    events: [],
    privateSnapshots: [{ payment_id: 'payment-1', snapshot_version: 1, payer_name: 'Responsável' }]
  });
  assert.equal(charges[0].payerName, 'Responsável');
  assert.equal(resolvePatientFinancialStatus({ financial_status: 'late_cancellation_charge' }), 'late_cancellation');
});

test('read-only checks cover all diagnostics and real SQL test always rolls back', () => {
  const executableVerification = verification
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .join(' ');
  assert.doesNotMatch(executableVerification, /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
  for (const issue of [
    'PRIVATE_APPOINTMENT_WITHOUT_SNAPSHOT',
    'PRIVATE_APPOINTMENT_ZERO_OR_UNJUSTIFIED',
    'PRIVATE_APPOINTMENT_WITHOUT_CHARGE',
    'PRIVATE_APPOINTMENT_DUPLICATE_ACTIVE_CHARGE',
    'PRIVATE_CHARGE_WITHOUT_DUE_DATE',
    'PRIVATE_CHARGE_WITHOUT_PAYER',
    'PRIVATE_CHARGE_OVERPAID',
    'PRIVATE_PAID_CHARGE_WITH_BALANCE',
    'PRIVATE_CHARGE_WITHOUT_APPOINTMENT',
    'PRIVATE_CANCELLED_APPOINTMENT_INCONSISTENT_CHARGE'
  ]) assert.ok(migration.includes(issue), issue);
  assert.match(databaseTest, /^begin;/im);
  assert.match(databaseTest, /\brollback;\s*(?:--[\s\S]*)?$/i);
  assert.match(databaseTest, /has_table_privilege/);
  assert.match(databaseTest, /has_function_privilege/);
  assert.match(databaseTest, /extension\.extname = 'pgcrypto'/);
  assert.match(databaseTest, /v_pgcrypto_schema <> 'extensions'/);
  assert.match(databaseTest, /perform extensions\.digest/);
  assert.match(databaseTest, /routine\.proconfig/);
  assert.match(databaseTest, /search_path=public,extensions/);
  assert.match(databaseTest, /public\.clinics clinic[\s\S]*?clinic\.id = v_organization_id/);
  assert.match(databaseTest, /SQLSTATE 42883/);
  assert.match(databaseTest, /full rollback left the idempotent financial operation persisted/);
  assert.match(databaseTest, /PRIVATE_FINANCIAL_OPERATION_IDEMPOTENCY_CONFLICT/);
  assert.match(databaseTest, /PRIVATE_LATE_CANCELLATION_RESCHEDULE_DECISION/);
  assert.match(databaseTest, /manual cancellation accepted without amount\/event/);
  assert.match(databaseTest, /authorized manual no-show was not charged\/audited/);
});

let passed = 0;
for (const { name, run } of tests) {
  try {
    run();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
console.log(`${passed}/${tests.length} testes passaram`);
