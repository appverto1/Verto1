import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createStripeWebhookEventState} from '../services/stripeWebhookEventState';

type Row = { id:string; event_type:string; status:string; processed_at:string; updated_at:string; attempt_count:number; last_error_code?:string|null };
const event = (id = 'evt_fixture', type = 'checkout.session.completed') => ({id,type} as any);
const fake = () => {
 const rows=new Map<string,Row>();
 let writes=0;
 let failInsert:any=null;
 const from=(table:string)=>{
   assert.equal(table,'stripe_webhook_events');
   return {
     insert:async(entries:Row[])=>{
       writes++;
       if(failInsert)return {error:failInsert};
       const entry=entries[0];
       if(rows.has(entry.id))return {error:{code:'23505',message:'duplicate key'}};
       rows.set(entry.id,{...entry});
       return {error:null};
     },
     select:(_columns:string)=>{
       const eqs:Array<[string,unknown]>=[];
       return {
         eq(field:string,v:unknown){eqs.push([field,v]);return this;},
         async maybeSingle(){
           const matches=[...rows.values()].filter(row=>eqs.every(([key,v])=>(row as any)[key]===v));
           return {data:matches[0]||null,error:null};
         },
       };
     },
     update(delta:Partial<Row>){
       const eqs:Array<[string,unknown]>=[];
       const lts:Array<[string,string]>=[];
       const run=()=>{
         let updated:Row[]=[];
         for(const row of rows.values()){
           if(!eqs.every(([key,v])=>(row as any)[key]===v))continue;
           if(!lts.every(([key,v])=>String((row as any)[key])<v))continue;
           Object.assign(row,delta);updated.push(row);writes++;
         }
         return {data:updated.map(row=>({id:row.id})),error:null};
       };
       return {
         eq(field:string,v:unknown){eqs.push([field,v]);return this;},
         lt(field:string,v:string){lts.push([field,v]);return this;},
         async select(_columns:string){return run();},
         then(resolve:any,reject:any){return Promise.resolve(run()).then(resolve,reject);},
       };
     },
   };
 };
 const handlers=createStripeWebhookEventState({supabase:{from},sanitizeString:(v:unknown,max=1000)=>String(v??'').slice(0,max)} as any);
 return {rows,handlers,get writes(){return writes;},setInsertError(err:any){failInsert=err;}};
};
test('first valid Stripe event inserts processing claim exactly once',async()=>{
 const s=fake();
 assert.equal(await s.handlers.reserveStripeWebhookEvent(event()),true);
 assert.equal(s.writes,1);
 assert.equal(s.rows.get('evt_fixture')?.attempt_count,1);
 assert.equal(s.rows.get('evt_fixture')?.status,'processing');
});
test('concurrent duplicate deliveries cannot claim a second processing lease',async()=>{
 const s=fake();
 const outcomes=await Promise.all([
   s.handlers.reserveStripeWebhookEvent(event()),s.handlers.reserveStripeWebhookEvent(event())
 ]);
 assert.deepEqual(outcomes.sort(),[false,true]);
 assert.equal(s.rows.size,1);
 assert.equal(s.rows.get('evt_fixture')?.attempt_count,1);
});
test('processed event is permanently deduplicated',async()=>{
 const s=fake();
 await s.handlers.reserveStripeWebhookEvent(event());
 await s.handlers.markStripeWebhookEventStatus(event(),'processed');
 assert.equal(s.rows.get('evt_fixture')?.status,'processed');
 assert.equal(await s.handlers.reserveStripeWebhookEvent(event()),false);
});
test('failed event retries with atomically incremented attempt and cleared error',async()=>{
 const s=fake();
 await s.handlers.reserveStripeWebhookEvent(event());
 await s.handlers.markStripeWebhookEventStatus(event(),'failed','SCHEDULE_MISMATCH');
 assert.equal(await s.handlers.reserveStripeWebhookEvent(event()),true);
 assert.equal(s.rows.get('evt_fixture')?.status,'processing');
 assert.equal(s.rows.get('evt_fixture')?.attempt_count,2);
 assert.equal(s.rows.get('evt_fixture')?.last_error_code,null);
});
test('stale processing can be claimed by one retry only; fresh processing cannot',async()=>{
 const s=fake();await s.handlers.reserveStripeWebhookEvent(event());
 assert.equal(await s.handlers.reserveStripeWebhookEvent(event()),false);
 const row=s.rows.get('evt_fixture')!;
 row.processed_at='2020-01-01T00:00:00.000Z';
 const [first,second]=await Promise.all([
   s.handlers.reserveStripeWebhookEvent(event()),s.handlers.reserveStripeWebhookEvent(event())
 ]);
 assert.deepEqual([first,second].sort(),[false,true]);
 assert.equal(row.attempt_count,2);
});
test('missing IDs and non-duplicate database errors fail closed',async()=>{
 const s=fake();
 await assert.rejects(()=>s.handlers.reserveStripeWebhookEvent(event('','')),/STRIPE_WEBHOOK_EVENT_ID_INVALID/);
 s.setInsertError({code:'DATABASE_UNAVAILABLE',message:'unavailable'});
 await assert.rejects(()=>s.handlers.reserveStripeWebhookEvent(event('evt_database')),/unavailable|DATABASE_UNAVAILABLE/);
 assert.equal(s.rows.size,0);
});
test('status marking never creates a new webhook event and preserves failure code',async()=>{
 const s=fake();
 await s.handlers.markStripeWebhookEventStatus(event('missing'),'failed','FAILURE');
 assert.equal(s.rows.size,0);
 await s.handlers.reserveStripeWebhookEvent(event());
 await s.handlers.markStripeWebhookEventStatus(event(),'failed','RETRY_REQUIRED');
 assert.equal(s.rows.get('evt_fixture')?.last_error_code,'RETRY_REQUIRED');
 await s.handlers.markStripeWebhookEventStatus(event(),'processed');
 assert.equal(s.rows.get('evt_fixture')?.last_error_code,null);
});
