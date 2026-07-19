import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPatientFinancialAppointmentRows,
  buildPatientFinancialChargeRows,
  currentLocalDateKey,
  getPatientFinanceAmounts,
  patientFinancialTransactionLabel,
  privateAppointmentFinancialReadinessLabel,
  resolvePatientFinancialStatus
} from '../src/utils/patientFinancialLedger';

const root = process.cwd();
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260716120000_patient_appointment_finance.sql'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const workspaceCode = readFileSync(join(root, 'src/components/PatientFinanceWorkspace.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('status financeiro nao depende do status clinico e reconhece vencimento local', () => {
  const now = new Date(2026, 6, 16, 9, 0, 0);
  assert.equal(currentLocalDateKey(now), '2026-07-16');
  assert.equal(resolvePatientFinancialStatus(null, now), 'no_charge');
  assert.equal(resolvePatientFinancialStatus({ amount: 100, due_date: '2026-07-15', status: 'pending' }, now), 'overdue');
  assert.equal(resolvePatientFinancialStatus({ amount: 100, due_date: '2026-07-16', status: 'pending' }, now), 'pending');
  assert.equal(resolvePatientFinancialStatus({ amount: 100, paid_amount: 40, balance_amount: 60 }, now), 'partial');
  assert.equal(resolvePatientFinancialStatus({ amount: 100, paid_amount: 100, balance_amount: 0 }, now), 'paid');
  assert.equal(resolvePatientFinancialStatus({ amount: 100, is_courtesy: true }, now), 'courtesy');
  assert.equal(resolvePatientFinancialStatus({ amount: 100, canceled_at: '2026-07-10T10:00:00Z' }, now), 'canceled');
  assert.equal(resolvePatientFinancialStatus({ amount: 100, paid_amount: 100, refunded_amount: 100 }, now), 'refunded');
  assert.equal(resolvePatientFinancialStatus({ amount: 100, due_date: '2026-07-10', financial_status: 'forecast' }, now), 'forecast');
});

test('valores reconciliam original, desconto, pago, estorno e saldo', () => {
  assert.deepEqual(getPatientFinanceAmounts({
    original_amount: 200,
    additional_amount: 20,
    discount_amount: 10,
    amount: 210,
    paid_amount: 100,
    refunded_amount: 20,
    balance_amount: 130
  }), {
    original: 200,
    additional: 20,
    discount: 10,
    total: 210,
    paidGross: 100,
    refunded: 20,
    paid: 80,
    balance: 130
  });
});

test('listagem por consulta usa mapas em lote e exclui contexto de convenio', () => {
  const rows = buildPatientFinancialAppointmentRows({
    now: new Date(2026, 6, 16, 9),
    patients: [{ id: 'patient-1', name: 'Pedro' }, { id: 'patient-2', name: 'Gabriel' }],
    professionals: [{ id: 'professional-1', name: 'Mateus', label: 'Psicologo Mateus' }],
    appointments: [
      { id: 'appointment-private', patient_id: 'patient-1', therapist_id: 'professional-1', scheduled_at: '2026-07-16T12:00:00Z', status: 'completed', service_type: 'ABA' },
      { id: 'appointment-insurance', patient_id: 'patient-2', therapist_id: 'professional-1', scheduled_at: '2026-07-16T13:00:00Z', status: 'completed', service_type: 'ABA' }
    ],
    billingContexts: [
      { appointment_id: 'appointment-private', payer_type: 'PRIVATE' },
      { appointment_id: 'appointment-insurance', payer_type: 'INSURANCE' }
    ],
    charges: [{ id: 'charge-1', amount: 150, paid_amount: 50, balance_amount: 100, due_date: '2026-07-15' }],
    items: [{ id: 'item-1', payment_id: 'charge-1', appointment_id: 'appointment-private', patient_id: 'patient-1', professional_id: 'professional-1', active: true }]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].appointmentId, 'appointment-private');
  assert.equal(rows[0].patientName, 'Pedro');
  assert.equal(rows[0].professionalName, 'Psicologo Mateus');
  assert.equal(rows[0].status, 'partial');
  assert.equal(rows[0].clinicalStatus, 'completed');
});

test('cobranca agrupada preserva composicao, transacoes e auditoria sem fetch por item', () => {
  const rows = buildPatientFinancialChargeRows({
    charges: [{ id: 'charge-1', patient_id: 'patient-1', original_amount: 300, amount: 280, discount_amount: 20, paid_amount: 100, balance_amount: 180 }],
    items: [
      { id: 'item-1', payment_id: 'charge-1', appointment_id: 'appointment-1' },
      { id: 'item-2', payment_id: 'charge-1', appointment_id: 'appointment-2' }
    ],
    transactions: [{ id: 'transaction-1', payment_id: 'charge-1', transaction_type: 'PAYMENT', amount: 100 }],
    events: [{ id: 'event-1', payment_id: 'charge-1', event_type: 'PAYMENT_RECORDED' }]
  }, [{ id: 'patient-1', name: 'Pedro' }]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].patientName, 'Pedro');
  assert.equal(rows[0].items.length, 2);
  assert.equal(rows[0].transactions.length, 1);
  assert.equal(rows[0].events.length, 1);
  assert.equal(rows[0].status, 'partial');
});

test('labels particulares substituem linguagem de faturamento de convenio', () => {
  assert.equal(privateAppointmentFinancialReadinessLabel(null), 'Pronta para cobrança');
  assert.equal(privateAppointmentFinancialReadinessLabel({ amount: 100, balance_amount: 100 }), 'Cobrança pendente');
  assert.equal(privateAppointmentFinancialReadinessLabel({ amount: 100, paid_amount: 50, balance_amount: 50 }), 'Pagamento parcial');
  assert.equal(privateAppointmentFinancialReadinessLabel({ amount: 100, paid_amount: 100, balance_amount: 0 }), 'Pagamento recebido');
  assert.equal(patientFinancialTransactionLabel({ transaction_type: 'REFUND' }), 'Estorno');
  const privateFinanceBlock = calendarCode.slice(
    calendarCode.indexOf('data-appointment-patient-finance'),
    calendarCode.indexOf('data-appointment-patient-finance') + 5000
  );
  assert.doesNotMatch(privateFinanceBlock, /Pronta para faturamento/);
});

test('migration e aditiva, idempotente e vincula consulta sem duplicidade', () => {
  for (const marker of [
    'add column if not exists appointment_id',
    'create table if not exists public.payment_appointment_items',
    'create table if not exists public.payment_transactions',
    'create table if not exists public.payment_audit_events',
    'create table if not exists public.clinic_patient_finance_policies',
    'idx_payment_items_one_active_charge_per_appointment',
    'idx_payment_transactions_idempotency',
    'idx_payment_audit_idempotency',
    'create_patient_financial_charge',
    'apply_patient_financial_operation',
    'create_and_settle_patient_financial_charge',
    'pg_advisory_xact_lock',
    'PATIENT_FINANCE_PAYMENT_EXCEEDS_BALANCE',
    'PATIENT_FINANCE_REFUND_EXCEEDS_PAID',
    'PATIENT_FINANCE_CANCEL_REQUIRES_REFUND'
  ]) assert.ok(migrationCode.includes(marker), marker);
  assert.match(migrationCode, /on conflict \(organization_id, idempotency_key\) do nothing/i);
  assert.match(migrationCode, /payment_appointment_items[\s\S]*?appointment_id uuid references public\.appointments/i);
  assert.match(migrationCode, /payment_id text not null/i);
  assert.match(migrationCode, /alter column payment_id type text using payment_id::text/i);
  assert.match(migrationCode, /drop constraint if exists %I/i);
  assert.match(migrationCode, /p\.id::text = new\.payment_id::text[\s\S]*?p\.organization_id = new\.organization_id/i);
  assert.match(migrationCode, /update of payment_id, organization_id/i);
  assert.match(migrationCode, /PATIENT_FINANCE_PAYMENT_HAS_DEPENDENCIES/i);
  assert.match(migrationCode, /apply_patient_financial_operation\([\s\S]*?p_payment_id text/i);
});

test('trigger financeiro tolera appointments sem source_payload legado', () => {
  const triggerSlice = migrationCode.slice(
    migrationCode.indexOf('create or replace function public.sync_private_appointment_finance'),
    migrationCode.indexOf('create or replace view public.patient_financial_appointment_summaries')
  );
  assert.match(triggerSlice, /to_jsonb\(new\)->'source_payload'/i);
  assert.doesNotMatch(triggerSlice, /\bnew\.source_payload\b/i);
  assert.match(triggerSlice, /information_schema\.columns[\s\S]*?column_name = 'source_payload'/i);
  assert.match(triggerSlice, /after insert or update of status, scheduled_at, scheduled_start_at, scheduled_end_at, service_type, approach\s+on public\.appointments/i);
});

test('regra automatica usa somente plano particular por sessao e nunca cria pagamento', () => {
  const triggerSlice = migrationCode.slice(
    migrationCode.indexOf('create or replace function public.sync_private_appointment_finance'),
    migrationCode.indexOf('create or replace view public.patient_financial_appointment_summaries')
  );
  assert.match(triggerSlice, /billing_mode = 'PRIVATE'/);
  assert.match(triggerSlice, /coalesce\(p\.quantity_period, 'SESSION'\) = 'SESSION'/);
  assert.match(triggerSlice, /amount_cents > 0/);
  assert.doesNotMatch(triggerSlice, /billing_mode = 'MONTHLY'/);
  assert.doesNotMatch(triggerSlice, /transaction_type[^\n]*'PAYMENT'/);
  assert.match(triggerSlice, /v_policy\.charge_no_show/);
  assert.match(triggerSlice, /v_policy\.reschedule_keeps_charge = false/);
  assert.match(triggerSlice, /APPOINTMENT_FORECAST/);
});

test('RLS e endpoints preservam tenant e papeis operacionais', () => {
  assert.match(migrationCode, /alter table public\.payment_appointment_items enable row level security/i);
  assert.match(migrationCode, /u\.role in \('owner', 'admin', 'coordinator', 'receptionist'\)/i);
  assert.match(migrationCode, /organization_id::text/);
  assert.match(serverCode, /app\.get\('\/api\/patient-finance\/ledger'[\s\S]*?requireRoles\('coordinator', 'admin', 'owner', 'receptionist'\)/);
  const chargeEndpoint = serverCode.slice(
    serverCode.indexOf("app.post('/api/patient-finance/charges'"),
    serverCode.indexOf("app.post('/api/patient-finance/charges/:paymentId/operations'")
  );
  assert.match(chargeEndpoint, /requireRoles\('coordinator', 'admin', 'owner', 'receptionist'\)/);
  assert.match(chargeEndpoint, /\.from\('appointments'\)[\s\S]*?\.eq\('patient_id', patientId\)[\s\S]*?organization_id\.eq\.\$\{organizationId\},clinic_id\.eq\.\$\{organizationId\}/);
  assert.match(serverCode, /PATIENT_FINANCE_APPOINTMENT_SCOPE_INVALID/);
  assert.match(serverCode, /app\.put\('\/api\/patient-finance\/policy'[\s\S]*?requireRoles\('coordinator', 'admin', 'owner'\)/);
  const ledgerEndpoint = serverCode.slice(
    serverCode.indexOf("app.get('/api/patient-finance/ledger'"),
    serverCode.indexOf("app.post('/api/patient-finance/charges'")
  );
  assert.match(ledgerEndpoint, /readLedgerAppointments\(PATIENT_FINANCE_APPOINTMENT_SELECT\)/);
  assert.match(ledgerEndpoint, /extractMissingColumnName\(appointmentsResult\.error\) === 'source_payload'/);
  assert.match(ledgerEndpoint, /readLedgerAppointments\(PATIENT_FINANCE_APPOINTMENT_LEGACY_SELECT\)/);
  assert.match(ledgerEndpoint, /queryCount: 5 \+ appointmentQueryCount \+ \(appointmentIds\.length > 0 \? 1 : 0\)/);
});

test('ledger financeiro tolera appointments legados sem source_payload sem abrir o escopo do tenant', () => {
  const ledgerEndpoint = serverCode.slice(
    serverCode.indexOf("app.get('/api/patient-finance/ledger'"),
    serverCode.indexOf("app.post('/api/patient-finance/charges'")
  );
  assert.match(serverCode, /PATIENT_FINANCE_APPOINTMENT_LEGACY_SELECT[\s\S]*?filter\(\(column\) => column !== 'source_payload'\)/);
  assert.match(ledgerEndpoint, /\.or\(`organization_id\.eq\.\$\{organizationId\},clinic_id\.eq\.\$\{organizationId\}`\)/);
  assert.match(ledgerEndpoint, /\.is\('deleted_at', null\)/);
  assert.doesNotMatch(ledgerEndpoint, /source_payload[^\n]*?return res\.status\(503\)/);
});

test('workspace oferece fluxo separado, filtros, composicao, documentos e competencia', () => {
  for (const marker of [
    'Financeiro por consulta',
    'Criar cobrança',
    'Registrar pagamento',
    'Registrar pagamento parcial',
    'Aplicar desconto',
    'Marcar como cortesia',
    'Estornar pagamento',
    'Composição e histórico',
    'Lançamento por competência',
    'Enviar lembrete',
    'Comprovante anexado',
    'Recibo emitido',
    'Política de recebíveis e cancelamento',
    'Remarcação mantém a cobrança'
  ]) assert.ok(workspaceCode.includes(marker), marker);
  assert.match(coordinatorCode, /\["Por consulta", "Por consulta"\]/);
  assert.match(coordinatorCode, /activeFinancialSection === "Financeiro de pacientes"[\s\S]*?\? "Por consulta"/);
  assert.match(workspaceCode, /monthKeyFor\(row\.scheduledAt\)/);
  assert.match(workspaceCode, /transactionMatchesFilters/);
  assert.match(workspaceCode, /row\.paid <= 0[\s\S]*?Cancelar cobrança/);
});

test('escritas criticas usam endpoints diretos e nao fila offline', () => {
  for (const method of [
    'getPatientFinanceLedger',
    'createPatientFinancialCharge',
    'applyPatientFinancialOperation',
    'sendPatientFinancialReminder',
    'updatePatientFinancePolicy'
  ]) assert.ok(dataServiceCode.includes(`async ${method}`), method);
  const serviceSlice = dataServiceCode.slice(
    dataServiceCode.indexOf('async getPatientFinanceLedger'),
    dataServiceCode.indexOf('async savePayment')
  );
  assert.match(serviceSlice, /fetchWithAuthRetry/);
  assert.doesNotMatch(serviceSlice, /offlineFirstRequest/);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
console.log(`${passed}/${tests.length} testes passaram`);
