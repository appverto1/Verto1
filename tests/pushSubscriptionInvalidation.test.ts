import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deleteInvalidPushSubscription } from '../services/pushNotificationService';

const endpoint='https://push.example.test/expired-subscription';
const writes: any[]=[];
const supabase={
  from(table:string){
    assert.equal(table,'push_subscriptions');
    const q={
      update(payload:any){writes.push({payload,filters:[] as any[]});return q;},
      eq(column:string,value:unknown){writes.at(-1).filters.push([column,value]);return q;},
      then(resolve:(x:any)=>void){return resolve({error:null});},
    };
    return q;
  }
};
await deleteInvalidPushSubscription({supabase,deploymentEnv:'staging',endpoint});
assert.equal(writes.length,1,'mark endpoint exactly once');
assert.ok(!('subscription' in writes[0].payload),'subscription JSON is NOT NULL');
assert.ok(!('p256dh' in writes[0].payload),'retained for renewal');
assert.ok(!('auth' in writes[0].payload),'retained for renewal');
assert.ok(Number.isFinite(Date.parse(writes[0].payload.invalidated_at)));
assert.deepEqual(writes[0].filters,[['endpoint',endpoint],['deployment_env','staging']]);
const src=readFileSync('services/pushNotificationService.ts','utf8');
const st=src.indexOf('export async function findPushSubscriptionsForPatient');
const en=src.indexOf('export async function sendPatientPortalNotification',st);
assert.ok(en>st);
assert.equal((src.slice(st,en).match(/\.is\('invalidated_at', null\)/g)||[]).length,4,'all push lookup paths must exclude tombstoned endpoints');
console.log('pushSubscriptionInvalidation: expired endpoints marked without violating NOT NULL and excluded from all lookups');
