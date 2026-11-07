import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { requirePersistedBillingMessageAck } from '../src/services/billingCommunicationSaveAck';

const threadId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';
const valid = { threadId, messageId, sequence: 1, idempotent: true };

test('persisted message and idempotent replay keep the original acknowledgement', () => {
  assert.deepEqual(requirePersistedBillingMessageAck(valid), valid);
  assert.deepEqual(requirePersistedBillingMessageAck(valid, threadId), valid);
});

test('missing, ambiguous or malformed RPC replies never confirm a message', () => {
  for (const value of [
    null, undefined, false, true, [], {}, { success: true },
    { ...valid, threadId: '' }, { ...valid, threadId: ' ' },
    { ...valid, messageId: null }, { ...valid, messageId: ' ' },
    { ...valid, sequence: 0 }, { ...valid, sequence: -1 },
    { ...valid, sequence: 1.5 }, { ...valid, sequence: '1' },
    { ...valid, sequence: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(() => requirePersistedBillingMessageAck(value), /COMMUNICATION_PERSISTENCE_UNCONFIRMED/);
  }
});

test('cross-thread acknowledgement is rejected, even when message ID is present', () => {
  assert.throws(
    () => requirePersistedBillingMessageAck(valid, '33333333-3333-4333-8333-333333333333'),
    /COMMUNICATION_PERSISTENCE_UNCONFIRMED/,
  );
});

test('both write operations require the authoritative RPC response without adding calls', () => {
  const service = readFileSync(new URL('../src/services/billingCommunicationService.ts', import.meta.url), 'utf8');
  const create = service.slice(service.indexOf('  async createThread('), service.indexOf('  async sendMessage('));
  const send = service.slice(service.indexOf('  async sendMessage('), service.indexOf('  setArchived('));
  for (const block of [create, send]) {
    assert.equal((block.match(/await rpc<unknown>\(/g) || []).length, 1);
    assert.match(block, /return requirePersistedBillingMessageAck\(response/);
  }
  assert.match(create, /'create_clinic_communication_thread_v1'/);
  assert.match(send, /'send_clinic_communication_message_v1'/);
  assert.match(send, /requirePersistedBillingMessageAck\(response, input\.threadId\)/);
  assert.match(create, /p_idempotency_key: input\.idempotencyKey/);
  assert.match(send, /p_idempotency_key: input\.idempotencyKey/);
});

test('database still owns actor, clinic permission, idempotency and concurrency', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260925125703_clinic_billing_communication_v1.sql', import.meta.url), 'utf8');
  for (const name of ['create_clinic_communication_thread_v1', 'send_clinic_communication_message_v1']) {
    const block = sql.slice(sql.indexOf('create or replace function public.' + name));
    assert.match(block, /auth\.uid\(\)/);
    assert.match(block, /COMMUNICATION_ACCESS_DENIED/);
    assert.match(block, /pg_advisory_xact_lock/);
    assert.match(block, /idempotency_key/);
  }
});
