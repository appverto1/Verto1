import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  HISTORY_WRITE_LEGACY_SELECT_COLUMNS,
  HISTORY_WRITE_SELECT_COLUMNS,
  NOTE_WRITE_LEGACY_SELECT_COLUMNS,
  NOTE_WRITE_SELECT_COLUMNS,
  classifyClinicalMutationError,
  normalizeHistoryMutationPayload,
  normalizeNoteMutationPayload,
  writeClinicalRowWithSchemaFallback
} from '../src/utils/clinicalPostResilience.ts';
import {
  OFFLINE_SYNC_MAX_RETRIES,
  getOfflineSyncBackoffMs,
  isRecoverableFailedOfflineSyncRecord,
  resolveOfflineSyncFailure,
  shouldReportFailedOfflineSyncRecord,
  shouldAttemptOfflineRecord
} from '../src/utils/offlineSyncResilience.ts';

const root = process.cwd();
const dataServiceCode = fs.readFileSync(path.join(root, 'src/services/dataService.ts'), 'utf8');
const localDbCode = fs.readFileSync(path.join(root, 'src/services/localDb.ts'), 'utf8');

type FakeResult = { data?: any | null; error?: any | null };

class FakeMutation {
  table: string;
  payload: any = null;
  selectColumns = '';

  constructor(private client: FakeSupabase, table: string) {
    this.table = table;
  }

  upsert(payload: any) {
    this.payload = Array.isArray(payload) ? payload[0] : payload;
    return this;
  }

  select(columns: string) {
    this.selectColumns = columns;
    return this;
  }

  single() {
    return this.client.resolve(this);
  }
}

class FakeSupabase {
  calls: FakeMutation[] = [];
  private responsesByTable: Record<string, FakeResult[]>;

  constructor(responsesByTable: Record<string, FakeResult[]>) {
    this.responsesByTable = responsesByTable;
  }

  from(table: string) {
    return new FakeMutation(this, table);
  }

  async resolve(query: FakeMutation): Promise<FakeResult> {
    this.calls.push(query);
    const queue = this.responsesByTable[query.table] || [];
    return queue.shift() || { data: query.payload, error: null };
  }
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn });
const logger = { warn() {} };
const patientId = 'f5a5edb1-2144-4099-9789-f78f133dea3b';
const userId = '8a01607d-e9a6-4967-9446-c99c5931c178';

test('POST /api/history com payload valido retorna 200-equivalente', async () => {
  const normalized = normalizeHistoryMutationPayload({
    id: crypto.randomUUID(),
    patient_id: patientId,
    title: 'Registro de evolucao'
  }, { resolvedPatientId: patientId, userId, userEmail: 'p@example.com' });
  assert.equal(normalized.error, null);

  const supabase = new FakeSupabase({ history: [{ data: { id: normalized.payload?.id, title: 'Registro de evolucao' }, error: null }] });
  const result = await writeClinicalRowWithSchemaFallback({
    supabase,
    route: '/api/history',
    table: 'history',
    payload: normalized.payload as any,
    selectColumns: HISTORY_WRITE_SELECT_COLUMNS,
    legacySelectColumns: HISTORY_WRITE_LEGACY_SELECT_COLUMNS,
    logger
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.title, 'Registro de evolucao');
});

test('POST /api/history com payload legado normalizavel retorna 200-equivalente', async () => {
  const normalized = normalizeHistoryMutationPayload({
    id: crypto.randomUUID(),
    patientId,
    targetName: 'Contato visual',
    text: 'Boa resposta'
  }, { userId });
  assert.equal(normalized.error, null);
  assert.equal(normalized.payload?.patient_id, patientId);
  assert.equal(normalized.payload?.title, 'Contato visual');
  assert.equal(normalized.payload?.note, 'Boa resposta');
});

test('POST /api/history com payload invalido retorna 400-equivalente, nao 500', () => {
  const normalized = normalizeHistoryMutationPayload({ title: 'Sem paciente' }, { userId });
  assert.equal(normalized.payload, null);
  assert.match(String(normalized.error), /patient_id/);
});

test('POST /api/notes com payload valido retorna 200-equivalente', async () => {
  const normalized = normalizeNoteMutationPayload({
    id: crypto.randomUUID(),
    patient_id: patientId,
    text: 'Nota clinica'
  }, { resolvedPatientId: patientId, userId });
  assert.equal(normalized.error, null);

  const supabase = new FakeSupabase({ notes: [{ data: { id: normalized.payload?.id, content: 'Nota clinica' }, error: null }] });
  const result = await writeClinicalRowWithSchemaFallback({
    supabase,
    route: '/api/notes',
    table: 'notes',
    payload: normalized.payload as any,
    selectColumns: NOTE_WRITE_SELECT_COLUMNS,
    legacySelectColumns: NOTE_WRITE_LEGACY_SELECT_COLUMNS,
    logger
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.content, 'Nota clinica');
});

test('POST /api/notes com payload legado normalizavel retorna 200-equivalente', () => {
  const normalized = normalizeNoteMutationPayload({
    id: crypto.randomUUID(),
    patientId,
    note: 'Texto legado',
    title: 'Familia'
  }, { userId });
  assert.equal(normalized.error, null);
  assert.equal(normalized.payload?.patient_id, patientId);
  assert.equal(normalized.payload?.text, 'Texto legado');
  assert.equal(normalized.payload?.content, 'Texto legado');
});

test('POST /api/notes com payload invalido retorna 400-equivalente, nao 500', () => {
  const normalized = normalizeNoteMutationPayload({ patient_id: patientId }, { userId });
  assert.equal(normalized.payload, null);
  assert.match(String(normalized.error), /texto/);
});

test('erro de coluna opcional em write usa fallback sem select amplo', async () => {
  const normalized = normalizeHistoryMutationPayload({
    id: crypto.randomUUID(),
    patient_id: patientId,
    title: 'Foto',
    image_path: 'legacy/path.jpg'
  }, { resolvedPatientId: patientId, userId });
  const supabase = new FakeSupabase({
    history: [
      { data: null, error: { code: '42703', message: 'column history.image_path does not exist' } },
      { data: { id: normalized.payload?.id, title: 'Foto' }, error: null }
    ]
  });

  const result = await writeClinicalRowWithSchemaFallback({
    supabase,
    route: '/api/history',
    table: 'history',
    payload: normalized.payload as any,
    selectColumns: HISTORY_WRITE_SELECT_COLUMNS,
    legacySelectColumns: HISTORY_WRITE_LEGACY_SELECT_COLUMNS,
    logger
  });

  assert.equal(result.error, null);
  assert.equal('image_path' in result.payload, false);
  assert.doesNotMatch(supabase.calls[0].selectColumns, /\*/);
});

test('erro RLS/permissao retorna 403-equivalente', () => {
  const classified = classifyClinicalMutationError({
    code: '42501',
    message: 'permission denied for table history'
  });
  assert.equal(classified.status, 403);
});

test('offline sync: sucesso pode marcar como synced e duplicado e idempotente por upsert', async () => {
  const id = crypto.randomUUID();
  const payload = normalizeNoteMutationPayload({ id, patient_id: patientId, text: 'Uma vez' }, { userId }).payload as any;
  const supabase = new FakeSupabase({
    notes: [
      { data: { id, content: 'Uma vez' }, error: null },
      { data: { id, content: 'Uma vez' }, error: null }
    ]
  });
  const first = await writeClinicalRowWithSchemaFallback({
    supabase,
    route: '/api/notes',
    table: 'notes',
    payload,
    selectColumns: NOTE_WRITE_SELECT_COLUMNS,
    legacySelectColumns: NOTE_WRITE_LEGACY_SELECT_COLUMNS,
    logger
  });
  const second = await writeClinicalRowWithSchemaFallback({
    supabase,
    route: '/api/notes',
    table: 'notes',
    payload,
    selectColumns: NOTE_WRITE_SELECT_COLUMNS,
    legacySelectColumns: NOTE_WRITE_LEGACY_SELECT_COLUMNS,
    logger
  });
  assert.equal(first.error, null);
  assert.equal(second.error, null);
  assert.equal(first.data?.id, second.data?.id);
});

test('offline sync: 500 incrementa retryCount e aplica backoff', () => {
  const now = 1_000_000;
  const failure = resolveOfflineSyncFailure({ currentRetryCount: 0, status: 500, error: 'Server error 500', now });
  assert.equal(failure.sync_status, 'pending');
  assert.equal(failure.retry_count, 1);
  assert.equal(failure.next_retry_at, now + getOfflineSyncBackoffMs(1));
});

test('offline sync: apos 3 falhas marca FAILED', () => {
  const failure = resolveOfflineSyncFailure({ currentRetryCount: OFFLINE_SYNC_MAX_RETRIES - 1, status: 500, error: 'Server error 500' });
  assert.equal(failure.sync_status, 'failed');
  assert.equal(failure.retry_count, OFFLINE_SYNC_MAX_RETRIES);
  assert.equal(failure.next_retry_at, null);
});

test('offline sync: FAILED nao e reprocessado automaticamente', () => {
  assert.equal(shouldAttemptOfflineRecord({ sync_status: 'failed', retry_count: 3 }), false);
});

test('offline sync: falha transitoria FAILED nao alimenta aviso manual', () => {
  const record = {
    sync_status: 'failed' as const,
    retry_count: 3,
    last_error: 'Application failed to respond',
    endpoint: '/api/patients'
  };
  assert.equal(isRecoverableFailedOfflineSyncRecord(record), true);
  assert.equal(shouldReportFailedOfflineSyncRecord(record), false);
});

test('offline sync: falha permanente continua exigindo revisao', () => {
  const record = {
    sync_status: 'failed' as const,
    retry_count: 1,
    last_error: 'Este paciente ja esta vinculado a outra clinica nesta mesma especialidade.',
    endpoint: '/api/patients'
  };
  assert.equal(isRecoverableFailedOfflineSyncRecord(record), false);
  assert.equal(shouldReportFailedOfflineSyncRecord(record), true);
});

test('offline sync: pending em backoff nao tenta imediatamente', () => {
  assert.equal(shouldAttemptOfflineRecord({ sync_status: 'pending', retry_count: 1, next_retry_at: 2_000 }, 1_000), false);
  assert.equal(shouldAttemptOfflineRecord({ sync_status: 'pending', retry_count: 1, next_retry_at: 2_000 }, 2_000), true);
});

test('offline sync: nao roda em paralelo por guarda isSyncing', () => {
  const localDbCode = fs.readFileSync(path.resolve(process.cwd(), 'src/services/localDb.ts'), 'utf8');
  assert.match(localDbCode, /let isSyncing = false/);
  assert.match(localDbCode, /isSyncing \|\|/);
  assert.match(localDbCode, /isSyncing = true/);
  assert.match(localDbCode, /isSyncing = false/);
});

test('rotas de sync nao reintroduzem select amplo', () => {
  const serverCode = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  const helperCode = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/clinicalPostResilience.ts'), 'utf8');
  assert.doesNotMatch(serverCode, /select\(['"]\*['"]\)/);
  assert.doesNotMatch(helperCode, /select\(['"]\*['"]\)/);
});

test('App reativa falhas transitorias antes de exibir aviso superior', () => {
  const appCode = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.match(appCode, /resetFailedSyncRecord/);
  assert.match(appCode, /isRecoverableFailedOfflineSyncRecord/);
  assert.doesNotMatch(appCode, /failedSyncCount/);
  assert.doesNotMatch(appCode, /role="status" className="sticky top-0 z-20 border-b border-amber-200/);
  assert.doesNotMatch(appCode, /registro\(s\) local\(is\) n.o puderam sincronizar/);
});

test('agendamento offline usa fila persistente e idempotencia', () => {
  assert.match(localDbCode, /'appointment'/);
  const createStart = dataServiceCode.indexOf('async createAppointments');
  const updateStart = dataServiceCode.indexOf('async updateAppointment', createStart);
  assert.ok(createStart > 0 && updateStart > createStart, 'createAppointments deve existir antes de updateAppointment');
  const createAppointments = dataServiceCode.slice(createStart, updateStart);
  assert.match(createAppointments, /const idempotencyKey = `POST:\/api\/appointments:\$\{stableRequestId\}`/);
  assert.match(createAppointments, /X-Idempotency-Key/);
  assert.match(createAppointments, /queueOfflineAppointment/);
  assert.match(createAppointments, /type:\s*'appointment'/);
  assert.match(createAppointments, /syncStatus:\s*'pending_sync'/);
  assert.match(dataServiceCode, /async getOfflineAppointmentDrafts/);
});

for (const item of tests) {
  await item.fn();
  console.log(`[ok] ${item.name}`);
}
