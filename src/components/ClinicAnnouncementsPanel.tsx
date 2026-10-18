import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CalendarClock, CalendarDays, Check, Clock3, Loader2, Megaphone, Search, Send, Users } from 'lucide-react';
import { dataService } from '../services/dataService';
import { formatBrazilScheduleInput, parseBrazilScheduleInput, isBrazilQuietHour, formatBrazilHistoryTimestamp } from '../utils/clinicAnnouncementBrazilTime';

type Category = 'NOTICE' | 'HOLIDAY' | 'EVENT';
type Audience = 'ALL' | 'SELECTED';
type DeliveryMode = 'NOW' | 'SCHEDULED';

const labels: Record<Category,string> = { NOTICE:'Aviso', HOLIDAY:'Feriado', EVENT:'Evento' };
const statusLabels: Record<string,string> = {
  SCHEDULED: 'Agendado',
  SENDING: 'Enviando',
  SENT: 'Enviado',
  PARTIAL: 'Enviado com alerta',
  FAILED: 'Falhou',
  CANCELED: 'Cancelado',
};
const newKey = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `notice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const active = (p:any) => p?.is_active !== false && p?.isActive !== false && !p?.deleted_at && String(p?.status || '').toLowerCase() !== 'archived';
const defaultScheduledAt = () => {
  const date = new Date(Date.now() + 30 * 60 * 1000);
  date.setSeconds(0,0);
  return formatBrazilScheduleInput(date);
};

export function ClinicAnnouncementsPanel({ patients, onToast }: { patients:any[]; onToast?:(message:string,type?:'success'|'error')=>void }) {
  const [category,setCategory]=useState<Category>('NOTICE');
  const [title,setTitle]=useState('');
  const [message,setMessage]=useState('');
  const [eventDate,setEventDate]=useState('');
  const [deliveryMode,setDeliveryMode]=useState<DeliveryMode>('NOW');
  const [scheduledAt,setScheduledAt]=useState(defaultScheduledAt);
  const [audience,setAudience]=useState<Audience>('ALL');
  const [selected,setSelected]=useState<string[]>([]);
  const [search,setSearch]=useState('');
  const [sending,setSending]=useState(false);
  const [loading,setLoading]=useState(true);
  const [history,setHistory]=useState<any[]>([]);
  const keyRef=useRef(newKey());
  const activePatients=useMemo(()=>(patients||[]).filter(active).filter((p)=>String(p?.id||'').trim()),[patients]);
  const visible=useMemo(()=>{ const q=search.trim().toLowerCase(); return activePatients.filter((p)=>!q || `${p?.name||''} ${p?.email||''}`.toLowerCase().includes(q)).slice(0,80); },[activePatients,search]);
  const minSchedule=useMemo(()=>formatBrazilScheduleInput(new Date(Date.now()+60_000)),[]);
  const load=async()=>{ setLoading(true); try { const r=await dataService.getClinicAnnouncements(30); if(r?.success&&Array.isArray(r.data)) setHistory(r.data); } finally { setLoading(false); } };
  useEffect(()=>{ void load(); },[]);
  const toggle=(id:string)=>setSelected((cur)=>cur.includes(id)?cur.filter((x)=>x!==id):[...cur,id]);

  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(sending)return;
    if(!title.trim()||!message.trim()){onToast?.('Informe título e mensagem.','error');return;}
    if(audience==='SELECTED'&&!selected.length){onToast?.('Selecione ao menos um paciente.','error');return;}
    let scheduledFor:string|null=null;
    if(deliveryMode==='SCHEDULED'){
      const parsed=parseBrazilScheduleInput(scheduledAt);
      if(!parsed || parsed.getTime()<=Date.now()+15_000){onToast?.('Escolha um horário futuro para o envio.','error');return;}
      if(isBrazilQuietHour(parsed)){onToast?.('O horário de não perturbe é das 22h às 06h. Escolha um horário entre 06h e 21h59.','error');return;}
      scheduledFor=parsed.toISOString();
    } else if(isBrazilQuietHour(new Date())){
      onToast?.('O horário de não perturbe é das 22h às 06h. Agende o aviso para depois das 06h.','error');
      return;
    }
    setSending(true);
    try {
      const r=await dataService.createClinicAnnouncement({
        category,
        title:title.trim(),
        message:message.trim(),
        eventDate:eventDate||null,
        scheduledFor,
        audienceMode:audience,
        patientIds:audience==='SELECTED'?selected:[],
        idempotencyKey:keyRef.current
      });
      if(!r?.success){onToast?.(r?.error||'Não foi possível enviar o aviso.','error');return;}
      const count=Number(r?.data?.recipient_count||0);
      onToast?.(scheduledFor ? `Aviso agendado para ${count} paciente(s).` : `Aviso enviado para ${count} paciente(s).`,'success');
      setTitle('');setMessage('');setEventDate('');setSelected([]);setAudience('ALL');setDeliveryMode('NOW');setScheduledAt(defaultScheduledAt());keyRef.current=newKey();await load();
    } finally {setSending(false);}
  };

  const formatDateTime=(value:any)=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?'':formatBrazilHistoryTimestamp(date);};
  const statusClass=(status:any)=>{
    const normalized=String(status||'').toUpperCase();
    if(normalized==='SCHEDULED')return 'bg-amber-50 text-amber-700';
    if(normalized==='FAILED')return 'bg-rose-50 text-rose-700';
    if(normalized==='PARTIAL')return 'bg-orange-50 text-orange-700';
    if(normalized==='SENDING')return 'bg-blue-50 text-blue-700';
    return 'bg-emerald-50 text-emerald-700';
  };

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,.95fr)]">
    <form onSubmit={submit} className="rounded-[32px] border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start gap-3"><div className="rounded-2xl bg-violet-50 p-3 text-[#7a32fc]"><Megaphone size={20}/></div><div><h3 className="text-lg font-bold text-slate-900">Novo aviso</h3><p className="mt-1 text-xs font-medium text-slate-400">Feriados, eventos ou informações importantes para um ou mais pacientes.</p></div></div>
      <div className="grid gap-2 sm:grid-cols-3">{(['NOTICE','HOLIDAY','EVENT'] as Category[]).map((item)=><button key={item} type="button" onClick={()=>setCategory(item)} className={`rounded-2xl border px-4 py-3 text-xs font-bold ${category===item?'border-violet-200 bg-violet-50 text-[#7a32fc]':'border-slate-100 bg-slate-50 text-slate-500'}`}>{labels[item]}</button>)}</div>
      <div className="mt-4 space-y-3"><input value={title} onChange={(e)=>setTitle(e.target.value.slice(0,160))} placeholder="Título do aviso" required className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none"/><textarea value={message} onChange={(e)=>setMessage(e.target.value.slice(0,1000))} placeholder="Mensagem para o paciente" rows={4} required className="w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium outline-none"/>{(category==='HOLIDAY'||category==='EVENT')&&<input type="date" value={eventDate} onChange={(e)=>setEventDate(e.target.value)} className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none"/>}</div>

      <div className="mt-4 rounded-3xl border border-slate-100 p-4">
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Momento do envio</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={()=>setDeliveryMode('NOW')} className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-xs font-bold ${deliveryMode==='NOW'?'border-violet-200 bg-violet-50 text-[#7a32fc]':'border-slate-100 bg-slate-50 text-slate-500'}`}><Send size={14}/>Enviar agora</button>
          <button type="button" onClick={()=>{setDeliveryMode('SCHEDULED'); if(!scheduledAt)setScheduledAt(defaultScheduledAt());}} className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-xs font-bold ${deliveryMode==='SCHEDULED'?'border-violet-200 bg-violet-50 text-[#7a32fc]':'border-slate-100 bg-slate-50 text-slate-500'}`}><CalendarClock size={14}/>Agendar envio</button>
        </div>
        {deliveryMode==='SCHEDULED'&&<div className="mt-3"><input type="datetime-local" step={60} min={minSchedule} value={scheduledAt} onChange={(e)=>setScheduledAt(e.target.value)} className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none"/><p className="mt-2 text-[10px] font-semibold text-slate-400">Horário de Brasília. Envios processados por minuto; não perturbe: 22h às 06h.</p></div>}
      </div>

      <div className="mt-5 rounded-3xl border border-slate-100 p-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={()=>setAudience('ALL')} className={`rounded-full px-4 py-2 text-xs font-bold ${audience==='ALL'?'bg-[#7a32fc] text-white':'bg-slate-100 text-slate-500'}`}><Users size={13} className="mr-1 inline"/>Todos os pacientes ativos</button><button type="button" onClick={()=>setAudience('SELECTED')} className={`rounded-full px-4 py-2 text-xs font-bold ${audience==='SELECTED'?'bg-[#7a32fc] text-white':'bg-slate-100 text-slate-500'}`}>Selecionar pacientes</button></div>
      {audience==='SELECTED'&&<div className="mt-4"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar paciente" className="w-full rounded-2xl bg-slate-50 py-2.5 pl-9 pr-3 text-xs font-semibold outline-none"/></div><div className="mt-3 max-h-52 space-y-1 overflow-y-auto">{visible.map((p)=>{const id=String(p.id),checked=selected.includes(id);return <button key={id} type="button" onClick={()=>toggle(id)} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-slate-50"><span className="min-w-0"><span className="block truncate text-xs font-bold text-slate-700">{p.name||'Paciente'}</span><span className="block truncate text-[10px] text-slate-400">{p.email||''}</span></span><span className={`ml-3 flex h-5 w-5 items-center justify-center rounded-md border ${checked?'border-[#7a32fc] bg-[#7a32fc] text-white':'border-slate-200'}`}>{checked&&<Check size={12}/>}</span></button>})}</div><p className="mt-2 text-[10px] font-semibold text-slate-400">{selected.length} selecionado(s)</p></div>}</div>
      <button type="submit" disabled={sending} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3.5 text-sm font-bold text-white disabled:opacity-60">{sending?<Loader2 size={16} className="animate-spin"/>:<Bell size={16}/>} {sending?(deliveryMode==='SCHEDULED'?'Agendando...':'Enviando...'):(deliveryMode==='SCHEDULED'?'Agendar aviso':'Enviar aviso')}</button>
    </form>
    <section className="rounded-[32px] border border-slate-100 bg-white p-5 shadow-sm sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h3 className="text-lg font-bold text-slate-900">Avisos enviados</h3><p className="mt-1 text-xs font-medium text-slate-400">Histórico recente da clínica.</p></div>{loading&&<Loader2 size={17} className="animate-spin text-slate-400"/>}</div><div className="space-y-3">{!loading&&!history.length&&<div className="rounded-2xl bg-slate-50 p-5 text-center text-xs font-semibold text-slate-400">Nenhum aviso enviado ainda.</div>}{history.map((item)=>{const status=String(item.status||'SENT').toUpperCase();return <article key={item.id} className="rounded-2xl border border-slate-100 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-[#7a32fc]">{labels[item.category as Category]||'Aviso'}</p><h4 className="mt-1 truncate text-sm font-bold text-slate-800">{item.title}</h4></div><div className="flex shrink-0 flex-col items-end gap-1"><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${statusClass(status)}`}>{statusLabels[status]||status}</span><span className="text-[9px] font-semibold text-slate-400">{item.recipient_count||0} paciente(s)</span></div></div><p className="mt-2 line-clamp-3 text-xs font-medium text-slate-500">{item.message}</p><div className="mt-3 flex flex-wrap gap-3 text-[10px] font-semibold text-slate-400">{status==='SCHEDULED'&&item.scheduled_for?<span><Clock3 size={11} className="mr-1 inline"/>Agendado: {formatDateTime(item.scheduled_for)}</span>:<span><CalendarDays size={11} className="mr-1 inline"/>{formatDateTime(item.sent_at||item.created_at)}</span>}<span>Push: {item.push_sent_count||0}</span></div></article>})}</div></section>
  </div>;
}
