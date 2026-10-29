// Deterministic, advisory call cadence in Brasília time. No ML/probability claims.
// Recommendations never block a real attempt, create an appointment or send a notification.
export type CadenceAttempt = {
  occurred_at: string;
  channel?: 'phone' | 'whatsapp_call' | 'whatsapp_message';
  outcome?: 'no_decisor' | 'decisor_spoken';
};
const zone='America/Sao_Paulo';
// Mid-morning and mid-afternoon are heuristics, not empirically predicted answer rates.
const slots=[[10,30],[15,15],[11,30],[14,45],[9,45],[16,15],[10,0],[15,45],[11,0],[14,0]] as const;
const localParts=(instant:Date)=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);
  const get=(name:string)=>Number(parts.find(part=>part.type===name)?.value||0);
  return {y:get('year'),m:get('month'),d:get('day'),hour:get('hour'),minute:get('minute')};
};
const key=({y,m,d}:{y:number;m:number;d:number})=>
  [y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
const addDays=(day:string,count:number)=>
  new Date(Date.parse(day+'T12:00:00Z')+count*86400000).toISOString().slice(0,10);
const isWeekday=(day:string)=>{
  const dayOfWeek=new Date(day+'T12:00:00Z').getUTCDay();
  return dayOfWeek!==0&&dayOfWeek!==6;
};
const callDates=(attempts:CadenceAttempt[])=>
  attempts.filter(a=>a.channel!=='whatsapp_message')
    .map(a=>new Date(a.occurred_at)).filter(a=>Number.isFinite(a.getTime()))
    .sort((a,b)=>a.getTime()-b.getTime());
const bestSlot=(day:string,sequence:number,history:Date[],minimum?:Date)=>{
  const last=history.at(-1);
  const lastTime=last?localParts(last):null;
  const lastMinutes=lastTime?lastTime.hour*60+lastTime.minute:null;
  const candidates=slots.map(([hour,minute],i)=>{
    const at=new Date(day+'T'+String(hour).padStart(2,'0')+':'+
      String(minute).padStart(2,'0')+':00-03:00');
    const minutes=hour*60+minute;
    let score=((i-sequence%slots.length+slots.length)%slots.length)*2;
    if(lastMinutes!==null){
      if(Math.abs(minutes-lastMinutes)<120)score+=100; // change the call window
      if((minutes<12*60)===(lastMinutes<12*60))score+=12; // alternate AM/PM
    }
    for(const previous of history){
      const clock=localParts(previous);
      if(Math.abs(minutes-(clock.hour*60+clock.minute))<90)score+=16;
    }
    return {at,score,index:i};
  }).filter(x=>!minimum||x.at.getTime()>minimum.getTime());
  candidates.sort((a,b)=>a.score-b.score||a.index-b.index);
  return candidates[0]?.at||null;
};

/** First due date stays anchored to the last real phone/WhatsApp call.
 * Missed suggestions remain overdue; they must never silently move into the future.
 * Remaining previews use distinct 2+-calendar-day gaps and no weekends.
 */
export const nextSalesCadenceSlots=(attempts:CadenceAttempt[],current=new Date()):Date[]=>{
  const history=callDates(attempts);
  const total=history.length;
  const latest=history.at(-1);
  const today=key(localParts(current));
  let day=latest?addDays(key(localParts(latest)),2):today;
  const suggestions:Date[]=[];
  const previewCount=Math.max(1,10-total);
  for(let i=0;i<previewCount;i++){
    if(i>0){
      day=addDays(day,2);
      if(day<today)day=today;
    }
    while(!isWeekday(day))day=addDays(day,1);
    // For the first post-call suggestion, preserve the original due date even if overdue.
    // For new leads or later previews, do not suggest a time that has already passed.
    let minimum=(!latest||i>0)&&day===today?new Date(current.getTime()+15*60000):undefined;
    let time=bestSlot(day,total+i,[...history,...suggestions],minimum);
    while(!time){
      day=addDays(day,1);
      while(!isWeekday(day))day=addDays(day,1);
      minimum=undefined;
      time=bestSlot(day,total+i,[...history,...suggestions]);
    }
    suggestions.push(time);
  }
  return suggestions;
};

// Historical helper only: never use this to disable the call buttons.
// The backend remains authoritative for real contact registration.
export const canRecordSalesAttemptNow=(attempts:CadenceAttempt[],current=new Date()):boolean=>{
  const here=localParts(current),today=key(here);
  const weekday=new Date(today+'T12:00:00Z').getUTCDay();
  const hhmm=String(here.hour).padStart(2,'0')+':'+String(here.minute).padStart(2,'0');
  if(weekday===0||weekday===6||hhmm<'09:00'||hhmm>'17:30')return false;
  return !callDates(attempts).some(at=>key(localParts(at))===today);
};
