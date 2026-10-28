// Pure UI helpers. Dates are based on São Paulo calendar days, never browser timezone.
export const followupFilters=[
  {value:'all',label:'Todos os cards'},
  {value:'today',label:'Retornar hoje'},
  {value:'overdue',label:'Retornos atrasados'},
  {value:'next7',label:'Próximos 7 dias'},
  {value:'future',label:'Retornos futuros'},
  {value:'none',label:'Sem retorno agendado'},
];

export const brazilDateKey=(instant)=>{
  const value=instant instanceof Date?instant:new Date(instant);
  if(!Number.isFinite(value.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(value);
  const get=k=>parts.find(p=>p.type===k)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
};

export const callbackDay=(followup)=>{
  if(followup?.status!=='scheduled')return '';
  return brazilDateKey(followup.contact_due_at);
};

export const followupBucket=(followup,today)=>{
  const day=callbackDay(followup);
  if(!day)return 'none';
  if(day===today)return 'today';
  return day<today?'overdue':'future';
};

export const isActionable=(status)=>!['converted','lost','archived'].includes(status);

// Ended opportunities do not appear as pending callbacks, even if an old
// scheduled row was left behind. The "all" view never hides those cards.
export const matchesFollowup=(followup,filter,today,leadStatus)=>{
  if(filter==='all')return true;
  if(!isActionable(leadStatus))return false;
  const bucket=followupBucket(followup,today);
  if(filter==='next7'){
    if(bucket!=='future')return false;
    const due=callbackDay(followup);
    const days=Math.round((Date.parse(due+'T12:00:00Z')-
      Date.parse(today+'T12:00:00Z'))/86400000);
    return days>=1&&days<=7;
  }
  return bucket===filter;
};

// Both operator and WhatsApp calls are included, text messages excluded upstream.
export const progressColor=(attemptCount)=>{
  const value=Math.min(10,Math.max(0,Number(attemptCount)||0));
  const hue=Math.round(138*(1-value/10));
  return 'hsl('+hue+' 78% 42%)';
};
export const progressWidth=(attemptCount)=>
  (Math.min(10,Math.max(0,Number(attemptCount)||0))*10)+'%';


// Optional priority agenda combines the stored appointment with the cadenced
// next call suggestion. A real appointment takes precedence over a suggestion.
export const resolveAgendaMoment=(followup,suggestedDate,eligible=true)=>{
  if(!eligible)return null;
  const saved=followup?.status==='scheduled'?new Date(followup.contact_due_at):null;
  if(saved&&Number.isFinite(saved.getTime()))
    return {at:saved.toISOString(),source:'scheduled'};
  const suggested=suggestedDate?new Date(suggestedDate):null;
  if(suggested&&Number.isFinite(suggested.getTime()))
    return {at:suggested.toISOString(),source:'suggested'};
  return null;
};

export const agendaMatches=(moment,options)=>{
  const {mode='all',source='all',date='',from='',to='',now=Date.now()}=options;
  if(mode==='all'&&source==='all'&&!from&&!to)return true;
  if(!moment||!Number.isFinite(Date.parse(moment.at)))return false;
  if(source!=='all'&&moment.source!==source)return false;
  const at=Date.parse(moment.at),current=Number(now);
  if(!Number.isFinite(current))return false;
  const today=brazilDateKey(new Date(current)),day=brazilDateKey(moment.at);
  if(mode==='today'&&day!==today)return false;
  if(mode==='overdue'&&at>=current)return false;
  if(mode==='next2h'&&(at<current||at>current+2*3600000))return false;
  if(mode==='date'&&(!date||day!==date))return false;
  const time=new Intl.DateTimeFormat('en-GB',{
    timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).format(new Date(at));
  if(from&&time<from)return false;
  if(to&&time>to)return false;
  return true;
};

// In priority views, missed appointments surface before future appointments.
// Stable ties prioritize confirmed dates ahead of cadence suggestions.
export const compareAgendaPriority=(a,b,now=Date.now())=>{
  const aa=a?.at?Date.parse(a.at):Number.POSITIVE_INFINITY;
  const bb=b?.at?Date.parse(b.at):Number.POSITIVE_INFINITY;
  const overdueA=aa<now?0:1,overdueB=bb<now?0:1;
  if(overdueA!==overdueB)return overdueA-overdueB;
  if(aa!==bb)return aa-bb;
  if(a?.source!==b?.source)return a?.source==='scheduled'?-1:1;
  return 0;
};
