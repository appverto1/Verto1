import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClinicalNotificationMarkReadHandler } from '../services/clinicalNotificationMarkReadHandler';

const server = readFileSync('server.ts', 'utf8');
assert.match(server, /app\.patch\('\/api\/clinical-notifications\/:notificationId\/read', checkAuth, createClinicalNotificationMarkReadHandler\(/);
assert.equal((server.match(/app\.patch\('\/api\/clinical-notifications\/:notificationId\/read'/g) || []).length, 1);
assert.doesNotMatch(server, /app\.patch\('\/api\/clinical-notifications\/:notificationId\/read', checkAuth, async/);

const ACTOR = '11111111-1111-4111-8111-111111111111';
const NOTIFICATION = '22222222-2222-4222-8222-222222222222';
const CLINIC = '33333333-3333-4333-8333-333333333333';
const OTHER_CLINIC = '44444444-4444-4444-8444-444444444444';
const uuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''));

function responder() {
  return {
    code: 200,
    payload: null as any,
    status(code: number) { this.code = code; return this; },
    json(payload: any) { this.payload = payload; return this; },
  };
}

function harness(result: { data: any; error: any } = { data: { id: NOTIFICATION, read_at: '2026-11-18T21:00:00.000Z' }, error: null }) {
  const calls: { tables: string[]; updates: any[]; filters: Array<[string, any]>; selects: string[]; dbError: any[] } = {
    tables: [], updates: [], filters: [], selects: [], dbError: [],
  };
  const query = {
    update(value: any) { calls.updates.push(value); return this; },
    eq(column: string, value: any) { calls.filters.push([column, value]); return this; },
    select(columns: string) { calls.selects.push(columns); return this; },
    async maybeSingle() { return result; },
  };
  const deps = {
    sanitizeString: (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength),
    currentClinicId: (user: any) => user?.clinicId,
    isUuid: uuid,
    supabase: { from(table: string) { calls.tables.push(table); return query; } },
    sendRouteDbError: (res: any, route: string, error: any, context: any) => {
      calls.dbError.push({ route, error, context });
      return res.status(500).json({ success: false, error: 'DATABASE_ERROR' });
    },
    requestIdForLogs: () => 'test-request',
  };
  return { calls, handler: createClinicalNotificationMarkReadHandler(() => deps) };
}

function request({ actorId = ACTOR, notificationId = NOTIFICATION, clinicId = CLINIC, source, querySource }: {
  actorId?: string; notificationId?: string; clinicId?: string; source?: string; querySource?: string;
} = {}) {
  return {
    session: { user: { id: actorId, clinicId } },
    params: { notificationId },
    body: source === undefined ? undefined : { source },
    query: querySource === undefined ? undefined : { source: querySource },
  };
}

// Reject untrusted IDs before any write.
for (const req of [request({ actorId: 'other-user' }), request({ notificationId: 'bad-id' })]) {
  const { handler, calls } = harness();
  const res = responder();
  await handler(req, res);
  assert.equal(res.code, 400);
  assert.equal(res.payload.error, 'Notificação inválida.');
  assert.equal(calls.tables.length, 0);
}

// A mention is always scoped to the session user, never the supplied body actor.
{
  const { handler, calls } = harness();
  const res = responder();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.payload, { success: true, data: { id: NOTIFICATION, readAt: '2026-11-18T21:00:00.000Z' } });
  assert.deepEqual(calls.tables, ['clinical_note_mentions']);
  assert.deepEqual(calls.filters, [['id', NOTIFICATION], ['recipient_user_id', ACTOR]]);
  assert.deepEqual(calls.selects, ['id,read_at']);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].read_at, calls.updates[0].updated_at);
  assert.ok(!Number.isNaN(Date.parse(calls.updates[0].read_at)));
}

// Inbox notifications are additionally scoped to the selected clinic.
for (const req of [request({ source: 'clinical_inbox' }), request({ querySource: 'clinical_inbox' })]) {
  const { handler, calls } = harness();
  const res = responder();
  await handler(req, res);
  assert.equal(res.code, 200);
  assert.deepEqual(calls.tables, ['clinical_inbox_notifications']);
  assert.deepEqual(calls.filters, [['id', NOTIFICATION], ['recipient_user_id', ACTOR], ['clinic_id', CLINIC]]);
}

// Request fields cannot replace the allowlisted database table.
{
  const { handler, calls } = harness();
  const res = responder();
  await handler(request({ source: 'clinical_inbox; DROP TABLE users' }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(calls.tables, ['clinical_note_mentions']);
}

// Foreign recipient and cross-clinic misses are indistinguishable (404).
for (const req of [request(), request({ source: 'clinical_inbox', clinicId: OTHER_CLINIC })]) {
  const { handler, calls } = harness({ data: null, error: null });
  const res = responder();
  await handler(req, res);
  assert.equal(res.code, 404);
  assert.deepEqual(res.payload, { success: false, error: 'Notificação não encontrada.' });
  assert.deepEqual(calls.filters[0], ['id', NOTIFICATION]);
  assert.deepEqual(calls.filters[1], ['recipient_user_id', ACTOR]);
}

// Existing central DB error handler and request correlation remain authoritative.
{
  const failure = { message: 'database private detail' };
  const { handler, calls } = harness({ data: null, error: failure });
  const res = responder();
  await handler(request(), res);
  assert.equal(res.code, 500);
  assert.equal(res.payload.error, 'DATABASE_ERROR');
  assert.equal(JSON.stringify(res.payload).includes(failure.message), false);
  assert.equal(calls.dbError[0].route, '/api/clinical-notifications/:notificationId/read [PATCH]');
  assert.deepEqual(calls.dbError[0].context, { actorId: ACTOR, notificationId: NOTIFICATION, requestId: 'test-request' });
}
console.log('[ok] clinical notification read receipt extraction regressions');
