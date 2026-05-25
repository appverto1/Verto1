import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  NOTE_SELECT,
  TASK_SELECT,
  fetchNotesWithSchemaFallback,
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
const warnings: any[] = [];
const logger = { warn(_message: string, payload: any) { warnings.push(payload); } };

test('/api/tasks retorna 200-equivalente com schema atual e respeita limit', async () => {
  const supabase = new FakeSupabase({
    tasks: [{ data: [{ id: 'task-1', patient_id: 'patient-1' }], error: null }]
  });

  const result = await fetchTasksWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    limit: 7,
    logger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ id: 'task-1', patient_id: 'patient-1' }]);
  assert.equal(supabase.calls[0].selectColumns, TASK_SELECT);
  assert.equal(supabase.calls[0].filters.some((item) => item.op === 'limit' && item.value === 7), true);
});

test('/api/tasks retorna [] quando tabela opcional nao existe', async () => {
  const supabase = new FakeSupabase({
    tasks: [
      { data: null, error: { code: '42P01', message: 'relation "tasks" does not exist' } },
      { data: null, error: { code: '42P01', message: 'relation "tasks" does not exist' } }
    ]
  });

  const result = await fetchTasksWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    limit: 20,
    logger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
  assert.equal(warnings.some((item) => item.route === '/api/tasks/:patientId' && item.stage === 'fallback_empty'), true);
});

test('/api/tasks nao quebra quando filtro auxiliar patient_email nao existe', async () => {
  const supabase = new FakeSupabase({
    tasks: [
      { data: null, error: { code: '42703', message: 'column tasks.patient_email does not exist' } }
    ]
  });

  const result = await fetchTasksWithSchemaFallback({
    supabase,
    patientEmail: 'paciente@example.com',
    emailMatch: 'ilike',
    limit: 5,
    logger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
});

test('/api/tasks remove order opcional quando created_at nao existe', async () => {
  const supabase = new FakeSupabase({
    tasks: [
      { data: null, error: { code: '42703', message: 'column tasks.created_at does not exist' } },
      { data: [{ id: 'task-no-date', patient_id: 'patient-1' }], error: null }
    ]
  });

  const result = await fetchTasksWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    limit: 20,
    logger
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.[0]?.id, 'task-no-date');
  assert.equal(supabase.calls[1].filters.some((item) => item.op === 'order' && item.column === 'created_at'), false);
});

test('/api/notes retorna 200-equivalente com schema atual e respeita limit', async () => {
  const supabase = new FakeSupabase({
    notes: [{ data: [{ id: 'note-1', patient_id: 'patient-1' }], error: null }]
  });

  const result = await fetchNotesWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    role: 'therapist',
    limit: 9,
    logger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ id: 'note-1', patient_id: 'patient-1' }]);
  assert.equal(supabase.calls[0].selectColumns, NOTE_SELECT);
  assert.equal(supabase.calls[0].filters.some((item) => item.op === 'limit' && item.value === 9), true);
});

test('/api/notes retorna [] quando tabela opcional nao existe', async () => {
  const supabase = new FakeSupabase({
    notes: [
      { data: null, error: { code: '42P01', message: 'relation "notes" does not exist' } },
      { data: null, error: { code: '42P01', message: 'relation "notes" does not exist' } }
    ]
  });

  const result = await fetchNotesWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    role: 'therapist',
    limit: 20,
    logger
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, []);
  assert.equal(warnings.some((item) => item.route === '/api/notes/:patientId' && item.stage === 'fallback_empty'), true);
});

test('/api/notes nao quebra quando filtro opcional is_active nao existe', async () => {
  const supabase = new FakeSupabase({
    notes: [
      { data: null, error: { code: '42703', message: 'column notes.is_active does not exist' } },
      { data: [{ id: 'note-legacy', patient_id: 'patient-1' }], error: null }
    ]
  });

  const result = await fetchNotesWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    role: 'therapist',
    limit: 20,
    logger
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.[0]?.id, 'note-legacy');
  assert.equal(supabase.calls[1].filters.some((item) => item.op === 'eq' && item.column === 'is_active'), false);
});

test('/api/notes remove order opcional quando created_at nao existe', async () => {
  const supabase = new FakeSupabase({
    notes: [
      { data: null, error: { code: '42703', message: 'column notes.created_at does not exist' } },
      { data: [{ id: 'note-no-date', patient_id: 'patient-1' }], error: null }
    ]
  });

  const result = await fetchNotesWithSchemaFallback({
    supabase,
    patientId: 'patient-1',
    role: 'therapist',
    limit: 20,
    logger
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.[0]?.id, 'note-no-date');
  assert.equal(supabase.calls[1].filters.some((item) => item.op === 'order' && item.column === 'created_at'), false);
});

test('notes/tasks nao usam select amplo operacional', () => {
  const serverCode = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  const fallbackCode = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/routeSchemaFallbacks.ts'), 'utf8');

  assert.doesNotMatch(serverCode, /select\(['"]\*['"]\)/);
  assert.doesNotMatch(fallbackCode, /select\(['"]\*['"]\)/);
  assert.doesNotMatch(TASK_SELECT, /\*/);
  assert.doesNotMatch(NOTE_SELECT, /\*/);
});

for (const item of tests) {
  await item.fn();
  console.log(`[ok] ${item.name}`);
}
