import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ASSIGNED_TASK_SELECT,
  CLINIC_STATE_SELECT,
  FINANCIAL_ENTRY_SELECT,
  HISTORY_SELECT,
  PATIENT_ANAMNESIS_SELECT,
  PATIENT_FILE_SELECT,
  PATIENT_RECORD_SELECT,
  PAYMENT_SELECT,
  PROFESSIONAL_PAYMENT_SELECT,
  TASK_SELECT,
  fetchAssignedTasksWithSchemaFallback,
  fetchClinicStateWithSchemaFallback,
  fetchFinancialEntriesWithSchemaFallback,
  fetchHistoryWithSchemaFallback,
  fetchPatientAnamnesisWithSchemaFallback,
  fetchPatientFilesWithSchemaFallback,
  fetchPatientRecordWithSchemaFallback,
  fetchPaymentsWithSchemaFallback,
  fetchProfessionalPaymentsWithSchemaFallback,
  fetchTasksWithSchemaFallback
} from '../src/utils/routeSchemaFallbacks.ts';

type FakeResult = { data?: any[] | null; error?: any | null };

class FakeQuery {
  table: string;
  selectColumns = '';
  filters: Array<{ op: string; column?: string; value?: any }> = [];

  constructor(private client: FakeSupabase, table: string) {
    this.table = table;
  }

  select(columns: string) {
    this.selectColumns = columns;
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push({ op: 'neq', column, value });
    return this;
  }

  is(column: string, value: any) {
    this.filters.push({ op: 'is', column, value });
    return this;
  }

  in(column: string, value: any[]) {
    this.filters.push({ op: 'in', column, value });
    return this;
  }

  ilike(column: string, value: any) {
    this.filters.push({ op: 'ilike', column, value });
    return this;
  }

  order(column: string, value: any) {
    this.filters.push({ op: 'order', column, value });
    return this;
  }

  limit(value: number) {
    this.filters.push({ op: 'limit', value });
    return this;
  }

  maybeSingle() {
    this.filters.push({ op: 'maybeSingle' });
    return this;
  }

  then(resolve: (value: FakeResult) => any, reject: (reason: any) => any) {
    return Promise.resolve(this.client.resolve(this)).then(resolve, reject);
  }
}

class FakeSupabase {
  calls: FakeQuery[] = [];
  private responsesByTable: Record<string, FakeResult[]>;

  constructor(responsesByTable: Record<string, FakeResult[]>) {
    this.responsesByTable = responsesByTable;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  resolve(query: FakeQuery): FakeResult {
    this.calls.push(query);
    const queue = this.responsesByTable[query.table] || [];
    return queue.shift() || { data: [], error: null };
  }
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn });
const silentLogger = { warn() {} };

test('/api/history retorna array com select atual e limit', async () => {
  const supabase = new FakeSupabase({
    history: [{ data: [{ id: 'history-1', patient_id: 'patient-1' }], error: null }]
  });

  const result = await fetchHistoryWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    limit: 20,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ id: 'history-1', patient_id: 'patient-1' }]);
  assert.equal(supabase.calls[0].selectColumns, HISTORY_SELECT);
  assert.equal(supabase.calls[0].filters.some((item) => item.op === 'limit' && item.value === 20), true);
});

test('/api/history remove coluna opcional ausente e remove filtro legado quebrado', async () => {
  const supabase = new FakeSupabase({
    history: [
      { data: null, error: { code: '42703', message: 'column history.is_active does not exist' } },
      { data: [{ id: 'history-legacy' }], error: null }
    ]
  });

  const result = await fetchHistoryWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    limit: 20,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.[0]?.id, 'history-legacy');
  assert.ok(!supabase.calls[1].selectColumns.includes('is_active'));
  assert.equal(supabase.calls[1].filters.some((item) => item.op === 'eq' && item.column === 'is_active'), false);
});

test('/api/history retorna vazio quando schema legado tambem diverge', async () => {
  const supabase = new FakeSupabase({
    history: [
      { data: null, error: { code: '42703', message: 'column history.title does not exist' } },
      { data: null, error: { code: '42703', message: 'column history.title does not exist' } }
    ]
  });

  const result = await fetchHistoryWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    limit: 20,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
});

test('/api/tasks nao quebra quando patient_email opcional falta em busca auxiliar', async () => {
  const supabase = new FakeSupabase({
    tasks: [
      { data: null, error: { code: '42703', message: 'column tasks.patient_email does not exist' } }
    ]
  });

  const result = await fetchTasksWithSchemaFallback({
    supabase,
    patientEmail: 'paciente@example.com',
    emailMatch: 'ilike',
    limit: 7,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
  assert.equal(supabase.calls[0].selectColumns, TASK_SELECT);
});

test('/api/assigned-tasks remove clinic_id opcional sem derrubar lista do paciente', async () => {
  const supabase = new FakeSupabase({
    assigned_tasks: [
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'clinic_id' column of 'assigned_tasks' in the schema cache" } },
      { data: [{ id: 'assigned-legacy', patient_id: 'patient-1' }], error: null }
    ]
  });

  const result = await fetchAssignedTasksWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    clinicId: 'clinic-1',
    limit: 20,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.[0]?.id, 'assigned-legacy');
  assert.equal(supabase.calls[0].selectColumns, ASSIGNED_TASK_SELECT);
  assert.ok(!supabase.calls[1].selectColumns.includes('clinic_id'));
  assert.equal(supabase.calls[1].filters.some((item) => item.column === 'clinic_id'), false);
});

test('/api/patient-files remove metadata opcional e retorna lista vazia sem erro', async () => {
  const supabase = new FakeSupabase({
    patient_files: [
      { data: null, error: { code: '42703', message: 'column patient_files.metadata does not exist' } },
      { data: [], error: null }
    ]
  });

  const result = await fetchPatientFilesWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    clinicId: 'clinic-1',
    limit: 50,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
  assert.equal(supabase.calls[0].selectColumns, PATIENT_FILE_SELECT);
  assert.ok(!supabase.calls[1].selectColumns.includes('metadata'));
});

test('hydrateWorkspaceState usa fallbacks para clinic/state, patient-records e anamnese', async () => {
  const supabase = new FakeSupabase({
    clinic_state: [
      { data: null, error: { code: '42703', message: 'column clinic_state.specialty_settings does not exist' } },
      { data: { clinic_id: 'clinic-1', rooms: [], appointments: [], protocols: [] }, error: null }
    ],
    patient_records: [
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'payload_preview' column of 'patient_records' in the schema cache" } },
      { data: { patient_id: 'patient-1', payload_encrypted: 'encrypted' }, error: null }
    ],
    patient_anamnesis_submissions: [
      { data: null, error: { code: '42703', message: 'column patient_anamnesis_submissions.patient_file_id does not exist' } },
      { data: [], error: null }
    ]
  });

  const state = await fetchClinicStateWithSchemaFallback({
    supabase,
    clinicId: 'clinic-1',
    logger: silentLogger
  });
  const record = await fetchPatientRecordWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    clinicId: 'clinic-1',
    scopeByClinic: true,
    logger: silentLogger
  });
  const anamnesis = await fetchPatientAnamnesisWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    clinicId: 'clinic-1',
    limit: 20,
    logger: silentLogger
  });

  assert.equal(state.error, null);
  assert.equal(record.error, null);
  assert.equal(anamnesis.error, null);
  assert.equal(supabase.calls[0].selectColumns, CLINIC_STATE_SELECT);
  assert.ok(!supabase.calls[1].selectColumns.includes('specialty_settings'));
  assert.equal(supabase.calls[2].selectColumns, PATIENT_RECORD_SELECT);
  assert.ok(!supabase.calls[3].selectColumns.includes('payload_preview'));
  assert.equal(supabase.calls[4].selectColumns, PATIENT_ANAMNESIS_SELECT);
  assert.ok(!supabase.calls[5].selectColumns.includes('patient_file_id'));
});

test('/api/payments e financeiro mantem selects explicitos com fallback de colunas recentes', async () => {
  const supabase = new FakeSupabase({
    payments: [
      { data: null, error: { code: '42703', message: 'column payments.recurrence_total does not exist' } },
      { data: [{ id: 'payment-legacy' }], error: null }
    ],
    professional_payments: [{ data: [], error: null }],
    clinic_financial_entries: [{ data: [], error: null }]
  });

  const payments = await fetchPaymentsWithSchemaFallback({
    supabase,
    clinicId: 'clinic-1',
    limit: 100,
    logger: silentLogger
  });
  const professionalPayments = await fetchProfessionalPaymentsWithSchemaFallback({
    supabase,
    clinicId: 'clinic-1',
    limit: 100,
    logger: silentLogger
  });
  const entries = await fetchFinancialEntriesWithSchemaFallback({
    supabase,
    clinicId: 'clinic-1',
    limit: 100,
    logger: silentLogger
  });

  assert.equal(payments.error, null);
  assert.equal(payments.data?.[0]?.id, 'payment-legacy');
  assert.equal(professionalPayments.error, null);
  assert.equal(entries.error, null);
  assert.equal(supabase.calls[0].selectColumns, PAYMENT_SELECT);
  assert.ok(!supabase.calls[1].selectColumns.includes('recurrence_total'));
  assert.equal(supabase.calls[2].selectColumns, PROFESSIONAL_PAYMENT_SELECT);
  assert.equal(supabase.calls[3].selectColumns, FINANCIAL_ENTRY_SELECT);
});

test('rotas criticas nao reintroduzem select amplo operacional', () => {
  const serverCode = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  const fallbackCode = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/routeSchemaFallbacks.ts'), 'utf8');
  assert.doesNotMatch(serverCode, /select\(['"]\*['"]\)/);
  assert.doesNotMatch(serverCode, /\.select\(\)/);
  assert.doesNotMatch(fallbackCode, /select\(['"]\*['"]\)/);
  assert.doesNotMatch(fallbackCode, /\.select\(\)/);
});

for (const item of tests) {
  await item.fn();
  console.log(`[ok] ${item.name}`);
}
