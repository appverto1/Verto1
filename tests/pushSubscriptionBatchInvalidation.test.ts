import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  invalidateExpiredPushSubscriptionsBatch,
  deleteInvalidPushSubscription,
} from '../services/pushNotificationService.ts';

type Recorded = { action: 'update' | 'delete'; values: Record<string, unknown>; filter: Record<string, unknown> };
function fakeDatabase(updateError: any = null, deleteError: any = null) {
  const calls: Recorded[] = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, 'push_subscriptions');
      function build(action: 'update' | 'delete', values: Record<string, unknown> = {}) {
        const filter: Record<string, unknown> = {};
        return {
          eq(column: string, value: string) { filter[column] = value; return this; },
          in(column: string, value: string[]) {
            assert.equal(column, 'endpoint');
            filter[column] = [...value];
            calls.push({ action, values, filter });
            return Promise.resolve({ error: action === 'update' ? updateError : deleteError });
          },
        };
      }
      return {
        update(values: Record<string, unknown>) { return build('update', values); },
        delete() { return build('delete'); },
      };
    },
  };
  return { supabase, calls };
}
const loggerMessages: string[] = [];
const logger = { warn: (message: string) => loggerMessages.push(message) };
const noWork = fakeDatabase();
await invalidateExpiredPushSubscriptionsBatch({ supabase: noWork.supabase, deploymentEnv: 'staging', endpoints: [], logger });
assert.equal(noWork.calls.length, 0, 'empty queue never touches Supabase');

const one = fakeDatabase();
await invalidateExpiredPushSubscriptionsBatch({
  supabase: one.supabase, deploymentEnv: 'staging',
  endpoints: ['https://push.example/a', 'https://push.example/b', 'https://push.example/a', '  '],
  logger,
});
assert.equal(one.calls.length, 1, 'two endpoints share one UPDATE instead of N requests');
assert.deepEqual(one.calls[0].filter, { deployment_env: 'staging', endpoint: ['https://push.example/a', 'https://push.example/b'] });
assert.equal(one.calls[0].values.invalidated_at, one.calls[0].values.updated_at);
assert.match(String(one.calls[0].values.invalidated_at), /^\\d{4}-/);

const many = fakeDatabase();
const endpoints = Array.from({ length: 32 }, (_, i) => 'https://push.example/' + String(i).padStart(3,'0'));
await invalidateExpiredPushSubscriptionsBatch({supabase: many.supabase, deploymentEnv: 'production', endpoints, logger});
assert.equal(many.calls.length, 3, '32 invalid endpoints require only 3 requests');
assert.deepEqual(many.calls.map(x => (x.filter.endpoint as string[]).length), [12,12,8]);
assert.ok(many.calls.every(x => x.filter.deployment_env === 'production'));
const longUrls = fakeDatabase();
await invalidateExpiredPushSubscriptionsBatch({
  supabase: longUrls.supabase, deploymentEnv: 'staging',
  endpoints: Array.from({length: 7}, (_,i) => 'https://push.example/' + String(i) + 'x'.repeat(1050)), logger,
});
assert.ok(longUrls.calls.length > 1);
assert.ok(longUrls.calls.every(x => (x.filter.endpoint as string[]).join(',').length <= 3000));

const legacy = fakeDatabase({ code:'42703', message: 'column "invalidated_at" does not exist' });
await invalidateExpiredPushSubscriptionsBatch({
  supabase: legacy.supabase, deploymentEnv: 'staging',
  endpoints: ['https://push.example/gone1','https://push.example/gone2'], logger,
});
assert.deepEqual(legacy.calls.map(x => x.action), ['update','delete'],'legacy fallback only after missing invalidated_at');
assert.deepEqual(legacy.calls[0].filter, legacy.calls[1].filter, 'fallback retains both environment and endpoints');

const denied = fakeDatabase({ code:'42501', message:'permission denied' });
await invalidateExpiredPushSubscriptionsBatch({
  supabase: denied.supabase, deploymentEnv:'staging', endpoints:['https://push.example/foreign'],logger
});
assert.deepEqual(denied.calls.map(x=>x.action),['update'],'authorization errors must not trigger DELETE fallback');
assert.ok(loggerMessages.some(x=>x.includes('invalidar lote')));
const fallbackDenied = fakeDatabase({ code:'42703', message:'column "invalidated_at" does not exist' }, { code:'42501', message:'permission denied' });
await invalidateExpiredPushSubscriptionsBatch({ supabase:fallbackDenied.supabase,deploymentEnv:'staging',endpoints:['https://push.example/a'],logger});
assert.deepEqual(fallbackDenied.calls.map(x=>x.action),['update','delete']);
assert.ok(loggerMessages.some(x=>x.includes('remover lote')));

await assert.rejects(async()=>invalidateExpiredPushSubscriptionsBatch({
  supabase: fakeDatabase().supabase,deploymentEnv:'not-env' as any,endpoints:['x'],logger
}),/environment|staging|production|deployment/i);

assert.equal(typeof deleteInvalidPushSubscription, 'function','single-endpoint export remains available');
const source=readFileSync(new URL('../services/pushNotificationService.ts',import.meta.url),'utf8');
assert.equal((source.match(/await invalidateExpiredPushSubscriptionsBatch\\(\\{/g)||[]).length,2,
  'both notification dispatchers use batch invalidation');
assert.match(source,/\.eq\\('deployment_env', deploymentEnv\\)\\s*\\.in\\('endpoint', endpoints\\)/);
assert.match(source,/export async function deleteInvalidPushSubscription/);
console.log('pushSubscriptionBatchInvalidation: PASS (dedupe, batching, environment, fallback, deny, sender wiring)');
