/** Local-date recurrence only: PostgreSQL owns timezone, locks and atomic reservation. */
export type GroupSessionLocalSlot={date:string;time:string};
export type GroupSessionRecurrenceInput={
  date:string;time:string;recurrence:'NONE'|'WEEKLY';intervalWeeks:number;
  weekdays:number[];occurrences:number;
};
export function groupSessionWeekday(date:string):number{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return -1;
  const day=new Date(date+'T12:00:00Z');
  return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===date?day.getUTCDay():-1;
}
export function buildGroupSessionRecurrenceSlots(input:GroupSessionRecurrenceInput):GroupSessionLocalSlot[]{
  const firstWeekday=groupSessionWeekday(input.date);
  if(firstWeekday<0||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))return [];
  if(input.recurrence==='NONE')return [{date:input.date,time:input.time}];
  if(input.recurrence!=='WEEKLY'||!Number.isInteger(input.intervalWeeks)||
    input.intervalWeeks<1||input.intervalWeeks>4||
    !Number.isInteger(input.occurrences)||input.occurrences<2||input.occurrences>12||
    !Array.isArray(input.weekdays)||!input.weekdays.length||
    input.weekdays.some(day=>!Number.isInteger(day)||day<0||day>6)||
    new Set(input.weekdays).size!==input.weekdays.length||
    !input.weekdays.includes(firstWeekday))return [];
  const start=new Date(input.date+'T12:00:00Z');
  const firstMondayIndex=(firstWeekday+6)%7;
  const allowed=new Set(input.weekdays);
  const slots:GroupSessionLocalSlot[]=[];
  for(let offset=0;offset<input.intervalWeeks*7*(input.occurrences+1)&&slots.length<input.occurrences;offset++){
    const day=new Date(start.getTime()+offset*86400000);
    const weekIndex=Math.floor((firstMondayIndex+offset)/7);
    if(weekIndex%input.intervalWeeks===0&&allowed.has(day.getUTCDay())){
      slots.push({date:day.toISOString().slice(0,10),time:input.time});
    }
  }
  return slots.length===input.occurrences?slots:[];
}
