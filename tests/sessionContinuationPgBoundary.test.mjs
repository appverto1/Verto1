import assert from 'node:assert/strict';
import {createSessionContinuationPgBoundary} from '../services/sessionContinuationPgBoundary.mjs';

const createPool=(failStep=null)=>{
  const log=[];
  const client={
    async query(sql){
      log.push(sql);
      if(failStep===sql)throw new Error('INJECTED_'+sql);
      return {rows:[]};
    },
    release(discard){log.push(discard?'RELEASE_DISCARD':'RELEASE');}
  };
  return {pool:{async connect(){log.push('CONNECT');return client;}},log};
};

let fixture=createPool();
const db=createSessionContinuationPgBoundary({
  pool:fixture.pool,buildAdapter:async client=>({client,write:()=>fixture.log.push('WRITE')})
});
const outcome=await db.withTransaction(async tx=>{tx.write();return 'ok';});
assert.equal(outcome,'ok');
assert.deepEqual(fixture.log,[
 'CONNECT','BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE',
 'SET LOCAL statement_timeout = 15000','SET LOCAL lock_timeout = 5000',
 'WRITE','COMMIT','RELEASE'
]);
fixture=createPool();
const failing=createSessionContinuationPgBoundary({pool:fixture.pool,buildAdapter:()=>({})});
await assert.rejects(()=>failing.withTransaction(async()=>{throw new Error('BUSINESS_FAILURE');}),/BUSINESS_FAILURE/);
assert.equal(fixture.log.includes('COMMIT'),false);
assert.equal(fixture.log.includes('ROLLBACK'),true);
assert.equal(fixture.log.at(-1),'RELEASE');
fixture=createPool('ROLLBACK');
const rollbackError=createSessionContinuationPgBoundary({pool:fixture.pool,buildAdapter:()=>({})});
await assert.rejects(()=>rollbackError.withTransaction(async()=>{throw new Error('WRITE_FAILURE');}),AggregateError);
assert.equal(fixture.log.at(-1),'RELEASE_DISCARD');
assert.equal(fixture.log.filter(x=>x.startsWith('RELEASE')).length,1,'release exactly once');
await assert.rejects(()=>createSessionContinuationPgBoundary({
  pool:{connect:async()=>({query:async()=>{throw new Error('CANNOT_BEGIN')},release:()=>{}})},
  buildAdapter:()=>({})
}).withTransaction(async()=>true),/CANNOT_BEGIN/);
console.log('sessionContinuationPgBoundary.test.mjs: ok (commit, rollback and invalid connections)');
