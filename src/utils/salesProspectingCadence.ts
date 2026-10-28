// UI guidance uses Brazilian local dates. Backend remains authoritative for counting.
export type CadenceAttempt = { occurred_at:string };

const zone='America/Sao_Paulo';
const slots=[[9,30],[14,0],[11,0],[16,0],[10,15],[15,0],[9,45],[14,45],[11,30],[16,30]] as const;

const localDate = (value:Date) => {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const get=(key:string)=>Number(parts.find(p=>p.type===key)?.value||0);
  return {y:get('year'),m:get('month'),d:get('day')};
};
const key=({y,m,d}:{y:number;m:number;d:number})=>[y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
const addDay=(ymd:string)=>new Date(Date.parse(ymd+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const isWeekday=(ymd:string)=>{
  const weekday=new Date(ymd+'T12:00:00Z').getUTCDay();
  return weekday!==0&&weekday!==6;
};
export const nextSalesCadenceSlots = (attempts:CadenceAttempt[],current=new Date()):Date[] => {
  const total=Math.min(10,attempts.length);
  const today=key(localDate(current));
  const last=attempts.reduce<string>((best,item)=>{
    const at=new Date(item.occurred_at);
    const day=Number.isFinite(at.getTime())?key(localDate(at)):'';
    return day>best?day:best;
  },'');
  let day=last>today?last:today;
  if(last===day)day=addDay(day);
  const planned:Date[]=[];
  for(let index=total;index<10;index++){
    const [hour,minute]=slots[index];
    while(true){
      if(!isWeekday(day)){day=addDay(day);continue;}
      const at=new Date(day+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00-03:00');
      if(at<=current){day=addDay(day);continue;}
      planned.push(at);
      day=addDay(day);
      break;
    }
  }
  return planned;
};

export const canRecordSalesAttemptNow = (attempts:CadenceAttempt[],current=new Date()):boolean => {
  const here=localDate(current),today=key(here);
  const weekday=new Date(today+'T12:00:00Z').getUTCDay();
  const hhmm=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(current);
  if(weekday===0||weekday===6||hhmm<'09:00'||hhmm>'17:30')return false;
  return !attempts.some(a=>{
    const at=new Date(a.occurred_at);
    return Number.isFinite(at.getTime())&&key(localDate(at))===today;
  });
};
