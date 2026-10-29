// P0-504. Server-only transaction coordinator.
// NOT an HTTP endpoint. This cannot be used until an adapter backed by a single
// verified PostgreSQL transaction (FOR UPDATE / advisory locks) is implemented.
// No side effects, notifications, payments or calendar writes outside that transaction.
import {planSessionContinuationTransaction} from '../src/utils/sessionContinuationTransactionPlan.mjs';

const text=value=>String(value??'').trim();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const choices=new Set(['5','10','15','full']);
export class SessionContinuationRejected extends Error{
  constructor(code){
    super(code);
    this.name='SessionContinuationRejected';
    this.code=code;
  }
}
const fail=code=>{throw new SessionContinuationRejected(code)};
const safeResult=result=>Object.freeze({...result});
const sameIds=(a,b)=>a.length===b.length&&
  new Set(a).size===a.length&&new Set(b).size===b.length&&
  a.every(id=>b.includes(id));

export async function runSessionContinuationAtomic({actor,request,db}){
  // Actor data MUST come from the authenticated server session, not req.body.
  if(!actor?.serverAuthenticated||!UUID.test(text(actor.id))||!UUID.test(text(actor.clinicId)))
    fail('AUTHENTICATED_ACTOR_REQUIRED');
  if(!request||!UUID.test(text(request.appointmentId))||!text(request.sessionId)||
     !choices.has(text(request.choice))||
     !/^[A-Za-z0-9:._-]{12,120}$/.test(text(request.idempotencyKey)))
    fail('INVALID_REQUEST');
  if(!db||typeof db.withTransaction!=='function')fail('ATOMIC_TRANSACTION_REQUIRED');

  return db.withTransaction(async(tx)=>{
    const required=['findIdempotency','lockAndLoad','verifyFinancialAndCalendar',
      'extendSession','createContinuationAppointment','cancelAppointment',
      'appendAudit','enqueueOutbox','recordIdempotency'];
    if(required.some(name=>typeof tx?.[name]!=='function'))fail('UNSAFE_TRANSACTION_ADAPTER');

    // The adapter must serialize on clinic, appointment, session AND idempotency
    // before returning. A replay with changed body is rejected.
    const prior=await tx.findIdempotency({
      clinicId:actor.clinicId,actorId:actor.id,key:text(request.idempotencyKey),
      appointmentId:text(request.appointmentId),sessionId:text(request.sessionId),
      choice:text(request.choice),
      acceptedCancellationIds:Array.isArray(request.acceptedCancellationIds)?request.acceptedCancellationIds:[],
      confirmedAdditionalCents:request.confirmedAdditionalCents,
      acceptedFinancialCharge:request.acceptedFinancialCharge
    });
    if(prior){
      if(prior.requestMatches!==true||prior.committed!==true)fail('IDEMPOTENCY_CONFLICT');
      return safeResult({...prior.result,replayed:true});
    }

    const locked=await tx.lockAndLoad({
      actorId:actor.id,clinicId:actor.clinicId,
      appointmentId:text(request.appointmentId),sessionId:text(request.sessionId)
    });
    if(!locked||locked.serverVerified!==true)fail('SERVER_SCOPE_UNVERIFIED');
    if(text(locked.clinicId)!==text(actor.clinicId) ||
      text(locked.appointmentId)!==text(request.appointmentId) ||
      text(locked.sessionId)!==text(request.sessionId))fail('SCOPE_MISMATCH');

    // Derive price, capabilities, patient and conflicts from rows read UNDER
    // the same locks. Never accept them from the client's request.
    const trusted=await tx.verifyFinancialAndCalendar(locked,{choice:request.choice});
    if(!trusted||trusted.serverVerified!==true)fail('PRICING_OR_CALENDAR_UNVERIFIED');
    if(text(trusted.clinicId)!==text(actor.clinicId)||
       text(trusted.appointmentId)!==text(request.appointmentId)||
       text(trusted.sessionId)!==text(request.sessionId))fail('SCOPE_MISMATCH');
    const plan=planSessionContinuationTransaction({
      ...trusted,actorId:actor.id,clinicId:actor.clinicId,
      appointmentId:request.appointmentId,sessionId:request.sessionId,
      idempotencyKey:request.idempotencyKey,choice:request.choice
    });
    if(!plan.approved)fail(plan.reason||'CONTINUATION_DENIED');

    // Displayed conflict IDs and financial quote must still match the locked
    // server decision. No silent cancellation of an added/changed appointment.
    const accepted=Array.isArray(request.acceptedCancellationIds)?
      request.acceptedCancellationIds.map(text):[];
    if(!sameIds(accepted,plan.cancelAppointmentIds))fail('CONFLICT_CONFIRMATION_CHANGED');
    if(plan.bookFullUnit!==true&&accepted.length)fail('SMALL_EXTENSION_CONFLICT');
    if(request.acceptedFinancialCharge!==Boolean(plan.bookFullUnit))
      fail('FINANCIAL_CONFIRMATION_REQUIRED');
    if(plan.bookFullUnit&&
       (!Number.isSafeInteger(request.confirmedAdditionalCents)||
        request.confirmedAdditionalCents!==plan.additionalChargeCents))
      fail('FINANCIAL_QUOTE_CHANGED');

    // All writes below are in the SAME database transaction.
    // The canonical appointment financial triggers own any new billing item.
    // Do not write directly to payments, invoice entries or clinical trials.
    for(const cancellationId of plan.cancelAppointmentIds){
      const result=await tx.cancelAppointment({
        id:cancellationId,actorId:actor.id,clinicId:actor.clinicId,
        sourceSessionId:plan.sessionId,reason:'CONFLITO_CONTINUIDADE_SESSAO',
      });
      if(result?.cancelled!==true)fail('CANCELLATION_NOT_COMMITTED');
    }
    let continuationAppointmentId=null;
    if(plan.bookFullUnit){
      const reserved=await tx.createContinuationAppointment({
        actorId:actor.id,clinicId:actor.clinicId,originalAppointmentId:request.appointmentId,
        sessionId:plan.sessionId,startsAt:trusted.quote.baselineEndAt,
        endsAt:plan.endAt,quantity:1,financialEngine:plan.financialEngine,
        financialSnapshotId:trusted.financialSnapshotId,
        // Must use existing canonical triggers for PRIVATE / MONTHLY_SESSION.
        useCanonicalFinance:true,
      });
      if(!UUID.test(text(reserved?.appointmentId))||reserved?.financialPolicyVerified!==true)
        fail('FINANCIAL_RESERVATION_FAILED');
      continuationAppointmentId=reserved.appointmentId;
    }
    const extended=await tx.extendSession({
      actorId:actor.id,clinicId:actor.clinicId,sessionId:plan.sessionId,
      expectedEndAt:trusted.quote.baselineEndAt,nextEndAt:plan.endAt,
      continuationAppointmentId
    });
    if(extended?.updated!==true)fail('SESSION_EXTENSION_FAILED');

    const audited=await tx.appendAudit({
      actorId:actor.id,clinicId:actor.clinicId,sessionId:plan.sessionId,
      action:plan.bookFullUnit?'BILLABLE_SESSION_CONTINUATION':'TIME_EXTENSION',
      continuationAppointmentId,cancelledAppointmentIds:plan.cancelAppointmentIds,
      idempotencyKey:request.idempotencyKey,
    });
    if(audited?.durable!==true)fail('AUDIT_NOT_DURABLE');
    // Outbox persisted before commit, external delivery AFTER commit.
    if(plan.cancelAppointmentIds.length||plan.bookFullUnit){
      const outbox=await tx.enqueueOutbox({
        actorId:actor.id,clinicId:actor.clinicId,
        cancelledAppointmentIds:plan.cancelAppointmentIds,
        continuationAppointmentId,reason:'CONFLITO_CONTINUIDADE_SESSAO',
        idempotencyKey:request.idempotencyKey
      });
      if(outbox?.durable!==true)fail('OUTBOX_NOT_DURABLE');
    }
    const result={
      success:true,sessionId:plan.sessionId,endAt:plan.endAt,
      additionalMinutes:plan.additionalMinutes,
      continuationAppointmentId,cancelledAppointmentIds:plan.cancelAppointmentIds,
      additionalChargeCents:plan.additionalChargeCents,
      financeByCanonicalAppointmentTriggers:plan.bookFullUnit,
      replayed:false
    };
    const recorded=await tx.recordIdempotency({
      actorId:actor.id,clinicId:actor.clinicId,key:request.idempotencyKey,
      appointmentId:request.appointmentId,sessionId:request.sessionId,
      choice:request.choice,acceptedCancellationIds:accepted,
      confirmedAdditionalCents:request.confirmedAdditionalCents,
      acceptedFinancialCharge:request.acceptedFinancialCharge,result
    });
    if(recorded?.stored!==true)fail('IDEMPOTENCY_WRITE_FAILED');
    return safeResult(result);
  });
}
