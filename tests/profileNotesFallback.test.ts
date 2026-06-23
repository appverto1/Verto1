import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  NOTE_LEGACY_SELECT,
  NOTE_SELECT,
  PROFILE_LEGACY_SELECT,
  PROFILE_SELECT,
  PROFESSIONAL_PROFILE_SELECT,
  fetchNotesWithSchemaFallback,
  fetchPatientEmailForNotesWithSchemaFallback,
  fetchProfessionalProfileWithSchemaFallback,
  fetchProfileWithSchemaFallback
} from '../src/utils/routeSchemaFallbacks.ts';

type FakeResult = { data?: any[] | Record<string, any> | null; error?: any | null };

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

  single() {
    this.filters.push({ op: 'single' });
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

test('/api/profile retorna 200-equivalente com select atual', async () => {
  const supabase = new FakeSupabase({
    users: [{ data: { id: 'user-1', email: 'a@example.com', name: 'Ana', role: 'coordinator' }, error: null }]
  });

  const result = await fetchProfileWithSchemaFallback({ supabase, userId: 'user-1', logger: silentLogger });

  assert.equal(result.error, null);
  assert.equal((result.data as any).id, 'user-1');
  assert.equal(supabase.calls[0].table, 'users');
  assert.equal(supabase.calls[0].selectColumns, PROFILE_SELECT);
});

test('/api/profile retorna 200-equivalente com fallback legacy quando coluna opcional falta', async () => {
  const supabase = new FakeSupabase({
    users: [
      {
        data: null,
        error: {
          code: 'PGRST204',
          message: "Could not find the 'phone_verified_at' column of 'users' in the schema cache"
        }
      },
      { data: { id: 'user-1', email: 'a@example.com', name: 'Ana', role: 'coordinator' }, error: null }
    ]
  });

  const result = await fetchProfileWithSchemaFallback({ supabase, userId: 'user-1', logger: silentLogger });

  assert.equal(result.error, null);
  assert.equal((result.data as any).id, 'user-1');
  assert.ok(PROFILE_LEGACY_SELECT.includes('id,email,name,role'));
  assert.ok(!supabase.calls[1].selectColumns.includes('phone_verified_at'));
});

test('/api/profile nao quebra quando professional_profiles tem coluna opcional ausente', async () => {
  const supabase = new FakeSupabase({
    professional_profiles: [
      {
        data: null,
        error: { code: '42703', message: 'column professional_profiles.clinic_logo_url does not exist' }
      },
      { data: { user_id: 'user-1', full_name: 'Ana' }, error: null }
    ]
  });

  const result = await fetchProfessionalProfileWithSchemaFallback({ supabase, userId: 'user-1', logger: silentLogger });

  assert.equal(result.error, null);
  assert.equal((result.data as any).user_id, 'user-1');
  assert.equal(supabase.calls[0].selectColumns, PROFESSIONAL_PROFILE_SELECT);
  assert.ok(!supabase.calls[1].selectColumns.includes('clinic_logo_url'));
});

test('/api/profile usa perfil minimo quando professional_profiles nao existe', async () => {
  const supabase = new FakeSupabase({
    professional_profiles: [
      { data: null, error: { code: '42P01', message: 'relation "professional_profiles" does not exist' } }
    ]
  });

  const result = await fetchProfessionalProfileWithSchemaFallback({ supabase, userId: 'user-1', logger: silentLogger });

  assert.equal(result.error, null);
  assert.equal(result.data, null);
});

test('/api/notes retorna 200-equivalente com select atual', async () => {
  const supabase = new FakeSupabase({
    notes: [{ data: [{ id: 'note-1', patient_id: 'patient-1', created_at: '2026-05-25T10:00:00Z' }], error: null }]
  });

  const result = await fetchNotesWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    role: 'therapist',
    limit: 20,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.[0]?.id, 'note-1');
  assert.equal(result.data?.[0]?.patient_id, 'patient-1');
  assert.equal(result.data?.[0]?.created_at, '2026-05-25T10:00:00Z');
  assert.equal(result.data?.[0]?.updated_at, '2026-05-25T10:00:00Z');
  assert.equal(result.data?.[0]?.visibility, 'private');
  assert.equal(supabase.calls[0].selectColumns, NOTE_SELECT);
});

test('/api/notes retorna 200-equivalente com fallback legacy quando coluna opcional falta', async () => {
  const supabase = new FakeSupabase({
    notes: [
      { data: null, error: { code: '42703', message: 'column notes.assigned_task_id does not exist' } },
      { data: [{ id: 'note-legacy', patient_id: 'patient-1', created_at: '2026-05-25T10:00:00Z' }], error: null }
    ]
  });

  const result = await fetchNotesWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    role: 'therapist',
    limit: 20,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.equal((result.data || [])[0].id, 'note-legacy');
  assert.ok(NOTE_LEGACY_SELECT.includes('id,patient_id,patient_email,type'));
  assert.ok(!supabase.calls[1].selectColumns.includes('assigned_task_id'));
});

test('/api/notes retorna [] quando nao ha notas', async () => {
  const supabase = new FakeSupabase({
    notes: [{ data: [], error: null }]
  });

  const result = await fetchNotesWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    role: 'therapist',
    limit: 20,
    logger: silentLogger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
});

test('/api/notes respeita limit e email do paciente tem fallback de filtro legado', async () => {
  const supabase = new FakeSupabase({
    patients: [
      { data: null, error: { code: '42703', message: 'column patients.deleted_at does not exist' } },
      { data: { email: 'paciente@example.com' }, error: null }
    ],
    notes: [{ data: [], error: null }]
  });

  const patientEmailResult = await fetchPatientEmailForNotesWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    logger: silentLogger
  });
  const notesResult = await fetchNotesWithSchemaFallback({
    supabase,
    patientEmail: (patientEmailResult.data as any)?.email,
    excludePatientId: 'patient-1',
    role: 'patient',
    limit: 7,
    logger: silentLogger
  });

  assert.equal(patientEmailResult.error, null);
  assert.equal((patientEmailResult.data as any).email, 'paciente@example.com');
  assert.equal(notesResult.error, null);
  const notesCall = supabase.calls.find((call) => call.table === 'notes');
  assert.equal(notesCall?.filters.some((item) => item.op === 'limit' && item.value === 7), true);
});

test('rotas legadas nao reintroduzem select amplo operacional', () => {
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
