import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TASK_SELECT_COLUMNS,
  clearRouteSchemaCapabilityCache,
  fetchTasksWithSchemaFallback,
  filterTaskPayloadForSchema,
  resolveTaskSchemaCapabilities,
} from '../src/utils/routeSchemaFallbacks';

const absentColumns = new Set([
  'color',
  'completed',
  'is_daily_reminder',
  'linked_task',
  'scheduled_at',
  'pro_score',
]);

class TasksQueryMock {
  constructor(
    private readonly state: { selects: string[] },
    private readonly rows: any[] = [],
  ) {}

  select(columns: string) {
    this.state.selects.push(columns);
    for (const column of absentColumns) {
      assert.equal(columns.split(',').includes(column), false,
        `a consulta nao pode tentar selecionar a coluna ausente ${column}`);
    }
    return this;
  }

  eq() { return this; }
  ilike() { return this; }
  neq() { return this; }
  in() { return this; }
  is() { return this; }
  order() { return this; }
  limit() { return this; }

  then(resolve: (value: any) => void) {
    return resolve({ data: this.rows, error: null });
  }
}

const capabilityColumns = Object.fromEntries(
  TASK_SELECT_COLUMNS
    .filter((column) => !['id', 'patient_id'].includes(column))
    .map((column) => [column, !absentColumns.has(column)]),
);
const state = { rpcCalls: 0, selects: [] as string[] };
const catalogClient = {
  rpc(name: string) {
    assert.equal(name, 'get_verto_route_schema_capabilities');
    state.rpcCalls += 1;
    return Promise.resolve({
      data: { schemaVersion: 1, tasks: { available: true, columns: capabilityColumns } },
      error: null,
    });
  },
  from(table: string) {
    assert.equal(table, 'tasks');
    return new TasksQueryMock(state, [{ id: 'task-1', patient_id: 'patient-1', title: 'Tarefa' }]);
  },
};

const firstRead = await fetchTasksWithSchemaFallback({
  supabase: catalogClient,
  patientId: 'patient-1',
  limit: 20,
});
assert.equal(firstRead.error, null);
assert.equal(firstRead.data?.length, 1);
assert.equal(firstRead.data?.[0]?.completed, false);
assert.equal(firstRead.data?.[0]?.scheduled_at, null);
assert.equal(firstRead.data?.[0]?.pro_score, null);
assert.equal(state.rpcCalls, 1, 'a forma da tabela deve ser registrada uma vez');
assert.equal(state.selects.length, 1, 'uma leitura nao pode executar retries por coluna');

await fetchTasksWithSchemaFallback({
  supabase: catalogClient,
  patientId: 'patient-1',
  limit: 20,
});
assert.equal(state.rpcCalls, 1, 'leituras seguintes devem reutilizar a capacidade em cache');
assert.equal(state.selects.length, 2, 'cada chamada funcional deve emitir uma unica consulta de tasks');

const resolved = await resolveTaskSchemaCapabilities(catalogClient);
const filtered = filterTaskPayloadForSchema({
  title: 'Persistir',
  color: 'purple',
  completed: true,
  pro_score: 4,
}, resolved.missingColumns);
assert.deepEqual(filtered, { title: 'Persistir' },
  'writes devem usar o mesmo contrato confirmado, sem falhar e remover uma coluna por tentativa');

// Durante um rolling deploy sem a RPC, a leitura usa apenas o contrato minimo
// comprovado do legado. Ela nao descobre o schema provocando erros deliberados.
const conservativeState = { selects: [] as string[] };
const conservativeClient = {
  from(table: string) {
    assert.equal(table, 'tasks');
    return new TasksQueryMock(conservativeState, []);
  },
};
clearRouteSchemaCapabilityCache(conservativeClient);
const conservative = await fetchTasksWithSchemaFallback({
  supabase: conservativeClient,
  patientId: 'patient-1',
  limit: 20,
});
assert.equal(conservative.error, null);
assert.equal(conservativeState.selects.length, 1);
assert.deepEqual(
  conservativeState.selects[0].split(','),
  [
    'id', 'patient_id', 'patient_email', 'title', 'description', 'type', 'icon',
    'therapist_id', 'max_score', 'created_at', 'updated_at', 'is_active', 'deleted_at',
  ],
);

const server = readFileSync('server.ts', 'utf8');
const taskRoutes = server.slice(
  server.indexOf("app.get('/api/tasks/:patientId'"),
  server.indexOf("app.patch('/api/history/:historyId'"),
);
assert.match(taskRoutes, /resolveTaskSchemaCapabilities\(supabase\)/);
assert.match(taskRoutes, /filterTaskPayloadForSchema\(payload, taskSchema\.missingColumns\)/);
assert.doesNotMatch(taskRoutes, /while \(Object\.keys\(safePayload\)\.length > 0\)/,
  'persistencia de tasks nao pode remover uma coluna por erro e repetir a escrita');
assert.doesNotMatch(taskRoutes, /delete safePayload\[missingColumn\]/);

console.log('tasksSchemaEconomy.test.ts: OK');
