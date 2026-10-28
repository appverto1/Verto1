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
