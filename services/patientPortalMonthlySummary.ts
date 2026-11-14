/**
 * Read-only monthly view for a patient portal. No prices are derived from
 * session durations: only authoritative financial charges may yield money.
 */
const monthKey = (value:unknown) => {
  const text=String(value||'').slice(0,10);
  return /^\d{4}-(0[1-9]|1[0-2])/.test(text)?text.slice(0,7):'';
};
const safePositiveMinutes=(value:unknown) => {
  const amount=Number(value);
  return Number.isFinite(amount)&&amount>0&&amount<=1440?Math.round(amount):null;
};
const toCents=(value:unknown) => {
  if(value===null||value===undefined||value==='')return null;
  const amount=Number(value);
  return Number.isFinite(amount)&&amount>=0&&amount<=1_000_000_000
    ?Math.round(amount*100):null;
};

export function summarizePortalMonthSessions(
  appointments:any[],patientId:string,clinicId:string,month:string,now=new Date()
){
  let completedSessions=0,completedMinutes=0,withoutActualMinutes=0,upcomingSessions=0,upcomingMinutes=0;
  const seen=new Set<string>();
  for(const appointment of appointments||[]){
    const id=String(appointment?.id||'');
    if(!id||seen.has(id))continue;
    seen.add(id);
    if(String(appointment?.patientId||'')!==patientId
      ||String(appointment?.clinicId||'')!==clinicId)continue;
    const date=monthKey(appointment?.date)||monthKey(appointment?.scheduledAt);
    if(date!==month)continue;
    const status=String(appointment?.status||'').trim().toLowerCase();
    if(['completed','finished','finalized','concluded'].includes(status)){
      completedSessions++;
      const actual=safePositiveMinutes(appointment?.actualDurationMinutes);
      if(actual===null)withoutActualMinutes++;
      else completedMinutes+=actual;
    }else if(['scheduled','confirmed'].includes(status)){
      const startsAt=new Date(appointment?.scheduledAt||'');
      if(Number.isFinite(startsAt.getTime())&&startsAt.getTime()>=now.getTime()){
        upcomingSessions++;
        upcomingMinutes+=safePositiveMinutes(appointment?.scheduledDurationMinutes)||0;
      }
    }
  }
  return {completedSessions,completedMinutes,withoutActualMinutes,upcomingSessions,upcomingMinutes};
}

export function summarizePortalMonthCharges(charges:any[],rowLimit=200){
  const unique=new Set<string>();
  let chargeCount=0,totalCents=0,paidCents=0,openCents=0;
  let needsReview=false;
  for(const charge of charges||[]){
    const id=String(charge?.id||'');
    if(!id||unique.has(id))continue;
    unique.add(id);
    // A convenios' receivable is not an amount payable by the family.
    if(!['particular','private'].includes(String(charge?.type||'').toLowerCase()))continue;
    const status=String(charge?.financial_status||charge?.status||'').toLowerCase();
    if(['canceled','cancelled','courtesy','refunded'].includes(status)||charge?.is_courtesy===true)continue;
    if(!['forecast','pending','partial','overdue','delinquent','paid'].includes(status))continue;
    const amount=toCents(charge?.amount);
    if(amount===null){needsReview=true;continue;}
    chargeCount++;
    totalCents+=amount;
    const reportedPaid=toCents(charge?.paid_amount);
    const refunded=toCents(charge?.refunded_amount)||0;
    const received=status==='paid'&&(!reportedPaid || reportedPaid===0)?amount:reportedPaid||0;
    paidCents+=Math.max(0,received-refunded);
    const balance=toCents(charge?.balance_amount);
    openCents+=status==='paid'?0:(balance!==null?balance:Math.max(0,amount-received));
    if(charge?.monthly_adjustment_required===true)needsReview=true;
  }
  // The backend uses an explicit bounded read. Never label a truncated
  // financial result as a complete (or zero) invoice forecast.
  if((charges||[]).length>=rowLimit)needsReview=true;
  return {hasCharges:chargeCount>0,chargeCount,needsReview,
    totalCents:needsReview?null:totalCents,
    paidCents:needsReview?null:paidCents,
    openCents:needsReview?null:openCents};
}
