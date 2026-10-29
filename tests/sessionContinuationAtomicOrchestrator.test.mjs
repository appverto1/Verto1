import assert from 'node:assert/strict';
import {runSessionContinuationAtomic as run} from '../services/sessionContinuationAtomicOrchestrator.mjs';

const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const actor={id:id(3),clinicId:id(2),serverAuthenticated:true};
const next={appointmentId:id(9),patientId:id(8),clinicId:id(2),
  mustNeverAutoCancel:false,cancellationNoChargeVerified:true,hasCapturedPayment:false};
const quote={choice:'full',additionalMinutes:50,baselineEndAt:'2026-10-27T17:50:00Z',
  nextEndAt:'2026-10-27T18:40:00Z',unitPriceCents:18000,existingBillableUnits:1,
  projectedBillableUnits:2,projectedTotalCents:36000,additionalChargeCents:18000,
  additionalBillableUnits:1};
const trusted={
  serverVerified:true,organizationId:id(1),clinicId:id(2),appointmentClinicId:id(2),
  sessionClinicId:id(2),patientId:id(4),appointmentPatientId:id(4),
  sessionPatientId:id(4),appointmentId:id(5),sessionId:'session-A',
  isSessionActive:true,hasIncompleteClinicalWrites:false,hasOpenSessionTimers:false,
  baseDurationMinutes:50,financialSnapshotId:id(11),
  financialEngine:'AT_SESSION',quote,conflicts:{safe:true,conflicting:[next]},
  permissions:['session.finish','calendar.appointment.create','finance.entries.manage','calendar.appointment.cancel']
};
const baseRequest={appointmentId:id(5),sessionId:'session-A',choice:'full',
  idempotencyKey:'session:unique-12345',acceptedCancellationIds:[id(9)],
  acceptedFinancialCharge:true,confirmedAdditionalCents:18000};
const deepCopy=x=>JSON.parse(JSON.stringify(x));
function createMock({override={},failAt}={}){
  const db={state:{cancelled:[],appointments:[],sessionEnd:null,audit:[],outbox:[],keys:{},writes:0}};
  db.withTransaction=async action=>{
    const work=deepCopy(db.state);
    const ops=[];
    const fail=name=>{if(name===failAt)throw Error('TEST_INJECTED_'+name)};
    const tx={
      async findIdempotency(input){
        const previous=work.keys[input.key];
        if(!previous)return null;
        return {committed:true,requestMatches:JSON.stringify(input)===previous.inputHash,
          result:previous.result};
      },
      async lockAndLoad(input){
        fail('lock');
        return {...trusted,...override,serverVerified:true,clinicId:input.clinicId,
          appointmentId:input.appointmentId,sessionId:input.sessionId};
      },
      async verifyFinancialAndCalendar(){
        fail('price');
        return {...trusted,...override};
      },
      async cancelAppointment(input){
        fail('cancel');
        work.cancelled.push(input.id);ops.push('cancel');
        return {cancelled:true};
      },
      async createContinuationAppointment(input){
        fail('reserve');work.appointments.push({...input,id:id(15)});
        ops.push('reserve');
        return {appointmentId:id(15),financialPolicyVerified:true};
      },
      async extendSession(input){
        fail('extend');work.sessionEnd=input.nextEndAt;ops.push('extend');
        return {updated:true};
      },
      async appendAudit(input){
        fail('audit');work.audit.push(input);ops.push('audit');return {durable:true};
      },
      async enqueueOutbox(input){
        fail('outbox');work.outbox.push(input);ops.push('outbox');return {durable:true};
      },
      async recordIdempotency(input){
        fail('idempotency');
        const hash={clinicId:input.clinicId,actorId:input.actorId,key:input.key,
          appointmentId:input.appointmentId,sessionId:input.sessionId,choice:input.choice,
          acceptedCancellationIds:input.acceptedCancellationIds,
          confirmedAdditionalCents:input.confirmedAdditionalCents,
          acceptedFinancialCharge:input.acceptedFinancialCharge};
        work.keys[input.key]={inputHash:JSON.stringify(hash),result:input.result};
        ops.push('idempotency');return {stored:true};
      }
    };
    const result=await action(tx);
    db.state=work;
    db.lastOps=ops;
    return result;
  };
  return db;
}
function code(error){return String(error?.code||error?.message||error)}
const runWith=(db,request=baseRequest,user=actor)=>run({db,actor:user,request});

const db=createMock();
const first=await runWith(db);
assert.equal(first.success,true);
assert.equal(first.additionalChargeCents,18000);
assert.equal(db.state.appointments.length,1);
assert.equal(db.state.cancelled.length,1);
assert.equal(db.state.outbox.length,1);
assert.equal(db.state.audit.length,1);
assert.deepEqual(db.lastOps,['cancel','reserve','extend','audit','outbox','idempotency']);
const replay=await runWith(db);
assert.equal(replay.replayed,true);
assert.equal(db.state.appointments.length,1,'replay cannot duplicate payment-bearing appointment');
await assert.rejects(()=>runWith(db,{...baseRequest,confirmedAdditionalCents:54000}),e=>
  code(e)==='IDEMPOTENCY_CONFLICT');
assert.equal(db.state.appointments.length,1);

for(const [patch,expected] of [
  [{acceptedCancellationIds:[]},'CONFLICT_CONFIRMATION_CHANGED'],
  [{acceptedCancellationIds:[id(9),id(9)]},'CONFLICT_CONFIRMATION_CHANGED'],
  [{acceptedFinancialCharge:false},'FINANCIAL_CONFIRMATION_REQUIRED'],
  [{confirmedAdditionalCents:0},'FINANCIAL_QUOTE_CHANGED'],
]){
  const fresh=createMock();
  await assert.rejects(()=>runWith(fresh,{...baseRequest,...patch}),e=>code(e)===expected);
  assert.equal(fresh.state.cancelled.length,0);
  assert.equal(fresh.state.appointments.length,0);
}

for(const point of ['cancel','reserve','extend','audit','outbox','idempotency']){
  const broken=createMock({failAt:point});
  await assert.rejects(()=>runWith(broken),e=>code(e)==='TEST_INJECTED_'+point);
  assert.equal(broken.state.cancelled.length,0,'rollback before and after cancellation');
  assert.equal(broken.state.appointments.length,0,'rollback before and after reservation');
  assert.equal(broken.state.outbox.length,0,'never notify without commit');
  assert.equal(broken.state.sessionEnd,null,'never extend session on failed transaction');
}

const small={...quote,choice:'10',additionalMinutes:10,additionalChargeCents:0,
  additionalBillableUnits:0,nextEndAt:'2026-10-27T18:00:00Z',
  projectedBillableUnits:1,projectedTotalCents:18000};
const dbSmall=createMock({override:{quote:small,conflicts:{safe:true,conflicting:[]}}});
const smaller=await runWith(dbSmall,{...baseRequest,choice:'10',
  acceptedCancellationIds:[],acceptedFinancialCharge:false,confirmedAdditionalCents:0});
assert.equal(smaller.additionalChargeCents,0);
assert.equal(dbSmall.state.appointments.length,0);
assert.equal(dbSmall.state.outbox.length,0);

const dbThird=createMock({override:{quote:{...quote,existingBillableUnits:2,
  projectedBillableUnits:3,projectedTotalCents:54000}}});
const third=await runWith(dbThird,{...baseRequest,idempotencyKey:'session:unique-67890'});
assert.equal(third.additionalChargeCents,18000);
assert.equal(dbThird.state.appointments.length,1);

await assert.rejects(()=>runWith(createMock(),baseRequest,{...actor,serverAuthenticated:false}),
  e=>code(e)==='AUTHENTICATED_ACTOR_REQUIRED');
console.log('sessionContinuationAtomicOrchestrator.test.mjs: ok (consistency, rollback, replay and three units)');

const concurrent=createMock();
// A real PostgreSQL adapter must lock the idempotency key and appointment.
// This mock serializes transactions to prove the coordinator does not duplicate
// financial reservations when two identical requests arrive simultaneously.
const transaction=concurrent.withTransaction.bind(concurrent);
let queue=Promise.resolve();
concurrent.withTransaction=work=>{
  const result=queue.then(()=>transaction(work));
  queue=result.catch(()=>undefined);
  return result;
};
const [sim1,sim2]=await Promise.all([runWith(concurrent),runWith(concurrent)]);
assert.equal([sim1.replayed,sim2.replayed].filter(Boolean).length,1,
  'simultaneous replay must return exactly one existing result');
assert.equal(concurrent.state.appointments.length,1,'simultaneous replay cannot duplicate billing');
assert.equal(concurrent.state.cancelled.length,1,'third-party appointment cancelled once');
const differentClinic=createMock({override:{clinicId:id(6)}});
await assert.rejects(()=>runWith(differentClinic),e=>code(e)==='SCOPE_MISMATCH');
assert.equal(differentClinic.state.appointments.length,0);
console.log('sessionContinuationAtomicOrchestrator.concurrent.test: ok');
