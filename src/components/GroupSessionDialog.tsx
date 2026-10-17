import React, {useEffect, useMemo, useRef, useState} from 'react';
import {dataService} from '../services/dataService';
import {clinicalSpecialtiesMatch} from '../utils/clinicalSpecialties';
import {buildAppointmentDateTime} from '../utils/scheduling';
import {groupSessionErrorMessage} from '../utils/groupSessionApiErrors';
import {APPOINTMENT_CANCELLATION_REASONS, buildAppointmentCancellationNote} from '../utils/appointmentCancellationReasons';

type Props = {
  patients: any[]; professionals: any[]; specialties: string[]; rooms: any[];
  onRooms: (rooms: any[]) => void; timeZone: string; initialDate: string; initialTime?: string;
  bookingId?: string; showList?: boolean; initialAction?: string;
  canCreate: boolean; canEdit: boolean; canCancel: boolean;
  onClose: () => void; onIndividual: (date: string, time: string) => void;
  onPersisted: (result: any) => void; onFinance: (appointment: any) => void;
};
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
const active = (a: any) => !a.deleted_at && a.is_active !== false && !['canceled','cancelled','no_show','deleted'].includes(String(a.status).toLowerCase());
const inputClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-sm';
const buttonClass = 'rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40';
const localParts = (value: string, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  return {date:parts.slice(0,10),time:parts.slice(11,16)};
};

export function GroupSessionDialog(props: Props) {
  const [mode,setMode] = useState(props.bookingId ? 'detail' : props.showList ? 'list' : 'create');
  const [bookingId,setBookingId] = useState(props.bookingId || '');
  const [detail,setDetail] = useState<any>(null);
  const [list,setList] = useState<any[]>([]);
  const [rangeEnd,setRangeEnd] = useState(props.initialDate);
  const [date,setDate] = useState(props.initialDate);
  const [time,setTime] = useState(props.initialTime || '09:00');
  const [duration,setDuration] = useState(50);
  const [specialty,setSpecialty] = useState(props.specialties[0] || '');
  const [roomId,setRoomId] = useState('');
  const [patientIds,setPatientIds] = useState<string[]>([]);
  const [professionalIds,setProfessionalIds] = useState<string[]>([]);
  const [search,setSearch] = useState('');
  const [occurrences,setOccurrences] = useState(1);
  const [rates,setRates] = useState<any[]>([]);
  const [previewError,setPreviewError] = useState('');
  const [previewLoading,setPreviewLoading] = useState(false);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState(false);
  const busyRef = useRef(false);
  const operation = useRef({payload:'',key:''});
  const [reason,setReason] = useState('');
  const [reasonDetails,setReasonDetails] = useState('');
  const [cancelPatient,setCancelPatient] = useState('');
  const [future,setFuture] = useState(false);
  const [policyAmounts,setPolicyAmounts] = useState<Record<string,string>>({});
  const [notice,setNotice] = useState('');
  const header = detail?.bookings?.[0];
  const appointments: any[] = detail?.appointments || [];
  const patientName = (id: string) => props.patients.find(p=>String(p.id)===id)?.name || appointments.find(a=>String(a.patientId||a.patient_id)===id)?.patientName || 'Paciente';
  const professionals = props.professionals.filter(p=>clinicalSpecialtiesMatch(p.clinicSpecialty,specialty));
  const existingPatients = new Set((detail?.participants || []).map((p:any)=>p.patient_id));
  const patientOptions = props.patients.filter(p=>p.is_active !== false && p.isActive !== false && !existingPatients.has(String(p.id)) && String(p.name||'').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const eligibleRooms = props.rooms.filter(r=>r.is_active !== false && r.isActive !== false && Number(r.capacity)>=2);
  const selectedCancellations = appointments.filter(a=>active(a) && (!cancelPatient || String(a.patientId||a.patient_id)===cancelPatient));
  const manualSnapshots = (detail?.financialSnapshots || []).filter((snapshot:any)=>selectedCancellations.some(a=>a.id===snapshot.appointment_id) && snapshot.late_cancellation_rule?.type==='MANUAL' && Date.now()>Date.parse(snapshot.cancellation_free_until));
  const sortedPatients = useMemo(()=>[...patientIds].sort(),[patientIds]);
  const sortedTeam = useMemo(()=>[...professionalIds].sort(),[professionalIds]);

  useEffect(()=>{let live=true; void dataService.getClinicRooms().then(result=>{if(live){if(result?.success)props.onRooms(result.data);else setError(result?.error || 'Não foi possível carregar as salas.');}});return()=>{live=false;};},[]);
  useEffect(()=>{
    if(!bookingId)return;
    let live=true;setLoading(true);setError('');
    void dataService.getGroupSession(bookingId).then(result=>{
      if(!live)return;
      if(!result?.success){setError(result?.error || 'Não foi possível carregar o grupo.');return;}
      setDetail(result);const b=result.bookings[0];const parts=localParts(b.scheduled_start_at,props.timeZone);
      setDate(parts.date);setTime(parts.time);setDuration(Math.round((Date.parse(b.scheduled_end_at)-Date.parse(b.scheduled_start_at))/60000));setRoomId(b.room_id);setSpecialty(b.specialty);setProfessionalIds(b.professional_ids);
      if(props.initialAction==='cancel')setMode('cancel');
    }).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[bookingId]);
  useEffect(()=>{
    if(mode!=='list')return;
    let live=true;setLoading(true);setError('');
    void dataService.getGroupSessions(date,rangeEnd).then(result=>{if(live){if(result?.success){setList(result.data||[]);setNotice(result.hasMore ? 'Há mais grupos neste período. Selecione um intervalo menor.' : '');}else setError(result?.error || 'Não foi possível consultar os grupos.');}}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[mode,date,rangeEnd]);
  useEffect(()=>{
    setRates([]);setPreviewError('');
    if(!['create','add'].includes(mode)||patientIds.length<(mode==='create'?2:1)||!specialty)return;
    if(mode==='create'&&(!roomId||!professionalIds.length||!date||!time))return;
    let live=true;setPreviewLoading(true);
    const timer=setTimeout(()=>{
      const start=buildAppointmentDateTime(date,time,props.timeZone);
      const payload={patientIds:sortedPatients,professionalIds:sortedTeam,specialty,roomId,date,startTime:time,durationMinutes:duration,
        scheduledStartAt:start?.toISOString(),idempotencyKey:'group-preview:readonly'};
      void (mode==='create'?dataService.previewGroupSession(payload):dataService.previewGroupSessionRates(payload)).then(result=>{
        if(!live)return;
        if(result?.success)setRates(result.patientRates||result.rates||[]);
        else {
          const code = String(result?.code || '');
          const raw = String(result?.error || '').trim();
          const description = raw && !/^HTTP\\s+\\d+$/i.test(raw)
            ? raw : groupSessionErrorMessage(code || 'GROUP_OPERATION_FAILED');
          const patientId = String(result?.patientId || '');
          const patientLabel = patientId && patientIds.includes(patientId) &&
            /GROUP_PRICING_(PLAN|RATE)_MISSING/.test(code) ? patientName(patientId) : '';
          setPreviewError(patientLabel ? `Paciente: ${patientLabel}. ${description}` : description);
        }
      }).finally(()=>{if(live)setPreviewLoading(false);});
    },300);
    return()=>{live=false;clearTimeout(timer);setPreviewLoading(false);};
  },[mode,sortedPatients,sortedTeam,specialty,roomId,date,time,duration,props.timeZone]);

  const toggle = (id:string, values:string[], update:(ids:string[])=>void, limit:number) => update(values.includes(id)?values.filter(x=>x!==id):values.length<limit?[...values,id]:values);
  const chooseMode = (next:string) => {setMode(next);setPatientIds([]);setError('');setNotice('');setReason('');setReasonDetails('');setPolicyAmounts({});};
  const submit = async () => {
    if(busyRef.current)return;
    setError('');
    let payload:any;
    if(mode==='create'){
      if(patientIds.length<2||!professionalIds.length||!roomId||rates.length!==patientIds.length||previewLoading||previewError||!Number.isInteger(occurrences)||occurrences<1||occurrences>12||occurrences*patientIds.length>120){setError('Confirme pacientes, profissionais, sala, valores e número de sessões.');return;}
      const slots=Array.from({length:occurrences},(_,index)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+index*7);return{date:d.toISOString().slice(0,10),time};});
      payload={patientIds:sortedPatients,professionalIds:sortedTeam,specialty,roomId,slots,durationMinutes:duration};
    }else if(mode==='add'){
      if(!patientIds.length||rates.length!==patientIds.length||previewLoading||previewError){setError('Selecione os pacientes e confirme seus valores coletivos.');return;}
      payload={patientIds:sortedPatients};
    }else if(mode==='edit'){
      if(!reason.trim()||!professionalIds.length||!roomId){setError('Informe o motivo e os dados da remarcação.');return;}
      payload={date,time,durationMinutes:duration,roomId,professionalIds:sortedTeam,reason:reason.trim()};
    }else if(mode==='cancel'){
      const note=buildAppointmentCancellationNote(reason,reasonDetails);
      if(!note||!selectedCancellations.length){setError('Selecione os participantes e informe o motivo do cancelamento.');return;}
      const amounts:Record<string,number>={};
      for(const snapshot of manualSnapshots){
        const raw=(policyAmounts[snapshot.appointment_id]||'').trim();
        if(!/^\d+(?:[.,]\d{1,2})?$/.test(raw)){setError('Informe a cobrança manual de cada paciente, incluindo zero quando aplicável.');return;}
        const amount=Number(raw.replace(',','.'));
        if(!Number.isFinite(amount)||amount<0||amount>Number(snapshot.final_amount)){setError('A cobrança manual deve ficar entre zero e o valor da sessão.');return;}
        const appointment=appointments.find(a=>a.id===snapshot.appointment_id);
        amounts[String(appointment.patientId||appointment.patient_id)]=amount;
      }
      if(future && manualSnapshots.length){setError('Para definir cobranças manuais, cancele cada ocorrência separadamente.');return;}
      payload={patientIds:cancelPatient?[cancelPatient]:null,reason:note,policyAmounts:amounts,scope:future&&!cancelPatient?'future':'single'};
    }else return;
    const fingerprint=JSON.stringify({mode,bookingId,payload});
    if(operation.current.payload!==fingerprint)operation.current={payload:fingerprint,key:`group-${mode}:${crypto.randomUUID()}`};
    payload.idempotencyKey=operation.current.key;
    busyRef.current=true;setBusy(true);
    try{
      const result=await(mode==='create'?dataService.createGroupSessions(payload):mode==='add'?dataService.addGroupSessionParticipants(bookingId,payload):mode==='edit'?dataService.rescheduleGroupSession(bookingId,payload):dataService.cancelGroupSession(bookingId,payload));
      if(!result?.success){setError(result?.error || 'Não foi possível concluir. Tente novamente mantendo os mesmos dados.');return;}
      props.onPersisted(result);operation.current={payload:'',key:''};setDetail(result);setBookingId(result.bookings[0].id);setMode('detail');setPatientIds([]);setNotice('Alterações salvas.');
    }finally{busyRef.current=false;setBusy(false);}
  };
  const schedulingFields = <div className="grid grid-cols-2 gap-3">
    <label>Especialidade<select className={inputClass} disabled={mode==='edit'} value={specialty} onChange={e=>{setSpecialty(e.target.value);setProfessionalIds([]);}}><option value="">Selecione</option>{Array.from(new Set([...props.specialties,specialty].filter(Boolean))).map(s=><option key={s}>{s}</option>)}</select></label>
    <label>Sala<select className={inputClass} required value={roomId} onChange={e=>setRoomId(e.target.value)}><option value="">Selecione</option>{eligibleRooms.map(r=><option key={r.id} value={r.id}>{r.name} · {r.capacity} participantes</option>)}</select></label>
    <label>Data<input className={inputClass} type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>Horário ({props.timeZone})<input className={inputClass} type="time" required value={time} onChange={e=>setTime(e.target.value)}/></label>
    <label>Duração em minutos<input className={inputClass} type="number" min={15} max={360} required value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label>
    {mode==='create'&&<label>Sessões semanais<input className={inputClass} type="number" min={1} max={12} required value={occurrences} onChange={e=>setOccurrences(Number(e.target.value))}/></label>}
    <fieldset className="col-span-2"><legend>Profissionais da especialidade (até 8)</legend><div className="mt-2 flex flex-wrap gap-3">{professionals.map(p=><label key={p.id} className="flex items-center gap-2"><input type="checkbox" checked={professionalIds.includes(String(p.id))} onChange={()=>toggle(String(p.id),professionalIds,setProfessionalIds,8)}/>{p.label||p.name}</label>)}</div>{!professionals.length&&<p>Nenhum profissional autorizado nesta especialidade.</p>}</fieldset>
  </div>;

  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="group-dialog-title">
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 text-sm text-slate-800 shadow-xl">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 id="group-dialog-title" className="text-xl font-semibold">Sessões em grupo</h2><button type="button" className={buttonClass} disabled={busy} onClick={props.onClose}>Fechar</button></div>
      {error&&<p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
      {notice&&<p role="status" className="mb-3 rounded-xl bg-green-50 p-3 text-green-800">{notice}</p>}
      {loading?<p>Carregando…</p>:<>
        <div className="mb-4 flex flex-wrap gap-2">
          {mode!=='list'&&<button type="button" className={buttonClass} disabled={busy} onClick={()=>chooseMode('list')}>Consultar grupos</button>}
          {props.canCreate&&mode!=='create'&&<button type="button" className={buttonClass} disabled={busy} onClick={()=>{setBookingId('');setDetail(null);chooseMode('create');}}>Novo grupo</button>}
          {header&&!['list','detail','create'].includes(mode)&&<button type="button" className={buttonClass} disabled={busy} onClick={()=>chooseMode('detail')}>Voltar ao grupo</button>}
        </div>
        {mode==='list'&&<><div className="mb-4 grid grid-cols-2 gap-3"><label>De<input className={inputClass} type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Até<input className={inputClass} type="date" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)}/></label></div><p className="mb-3 text-slate-500">Consulte até 93 dias por vez.</p><div className="space-y-2">{list.map(b=><button key={b.id} type="button" className={`${buttonClass} w-full text-left`} onClick={()=>{setBookingId(b.id);setMode('detail');}}>{new Date(b.scheduled_start_at).toLocaleString('pt-BR',{timeZone:props.timeZone})} · {b.specialty} · {b.participantCount} participantes · {b.status}</button>)}{!list.length&&<p>Nenhum grupo neste período.</p>}</div></>}
        {mode==='detail'&&header&&<><p className="mb-3">{new Date(header.scheduled_start_at).toLocaleString('pt-BR',{timeZone:props.timeZone})} · {header.specialty} · {Math.round((Date.parse(header.scheduled_end_at)-Date.parse(header.scheduled_start_at))/60000)} minutos · {props.rooms.find(r=>r.id===header.room_id)?.name||'Sala'}</p><p className="mb-3 text-slate-500">{props.professionals.filter(p=>header.professional_ids.includes(p.id)).map(p=>p.label||p.name).join(', ')}</p><div className="divide-y">{(detail.participants||[]).map((p:any)=>{const a=appointments.find(a=>a.id===p.appointment_id);return <div key={p.id||p.patient_id} className="flex items-center justify-between gap-3 py-3"><span>{patientName(p.patient_id)} · {money(p.unit_amount_cents)} · {a?.status}</span>{a&&<button className={buttonClass} type="button" onClick={()=>props.onFinance(a)}>Financeiro</button>}</div>;})}</div>{header.status==='RESERVED'&&<div className="mt-4 flex flex-wrap gap-2">{props.canCreate&&<button className={buttonClass} onClick={()=>chooseMode('add')}>Adicionar pacientes</button>}{props.canEdit&&<button className={buttonClass} onClick={()=>chooseMode('edit')}>Remarcar sessão</button>}{props.canCancel&&<button className={buttonClass} onClick={()=>chooseMode('cancel')}>Cancelar</button>}</div>}</>}
        {['create','add','edit','cancel'].includes(mode)&&<form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy} className="space-y-4">
          {mode==='create'&&<label className="block">Modalidade<select className={inputClass} value="GROUP" onChange={e=>{if(e.target.value==='INDIVIDUAL')props.onIndividual(date,time);}}><option value="INDIVIDUAL">Individual</option><option value="GROUP">Grupo</option></select></label>}
          {['create','edit'].includes(mode)&&schedulingFields}
          {['create','add'].includes(mode)&&<><label className="block">Pacientes ({patientIds.length})<input className={inputClass} placeholder="Buscar paciente" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="max-h-48 overflow-y-auto rounded-xl border p-3">{patientOptions.map(p=><label className="flex items-center justify-between gap-2 py-2" key={p.id}><span><input type="checkbox" checked={patientIds.includes(String(p.id))} onChange={()=>toggle(String(p.id),patientIds,setPatientIds,30)}/> {p.name}</span><span>{rates.find(r=>r.patientId===String(p.id))?money(rates.find(r=>r.patientId===String(p.id)).amountCents):''}</span></label>)}</div><p className="text-slate-500">{mode==='create'?'Selecione de 2 a 30 pacientes. ':''}Os valores coletivos são confirmados por paciente e especialidade no plano financeiro.</p>{previewLoading&&<p role="status">Consultando valores…</p>}{previewError&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950"><strong className="block">Atenção: revise os dados antes de agendar</strong><p className="mt-1">{previewError}</p></div>}{rates.length>0&&<ul>{rates.map(r=><li key={r.patientId}>{patientName(r.patientId)}: {money(r.amountCents)} por sessão em grupo</li>)}</ul>}</>}
          {mode==='edit'&&<label className="block">Motivo da remarcação<textarea className={inputClass} required maxLength={1200} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
          {mode==='cancel'&&<><label className="block">Cancelar<select className={inputClass} value={cancelPatient} onChange={e=>{setCancelPatient(e.target.value);setFuture(false);}}><option value="">Todos os participantes ativos</option>{appointments.filter(active).map(a=><option key={a.id} value={a.patientId||a.patient_id}>{patientName(a.patientId||a.patient_id)}</option>)}</select></label><label className="block">Motivo<select className={inputClass} required value={reason} onChange={e=>setReason(e.target.value)}><option value="">Selecione</option>{APPOINTMENT_CANCELLATION_REASONS.map(r=><option key={r}>{r}</option>)}</select></label><label className="block">Detalhes<textarea className={inputClass} required={reason==='Outro motivo'} maxLength={900} value={reasonDetails} onChange={e=>setReasonDetails(e.target.value)}/></label>{header?.series_id&&!cancelPatient&&<label className="flex items-center gap-2"><input type="checkbox" checked={future} onChange={e=>setFuture(e.target.checked)}/>Incluir as próximas sessões desta série</label>}{manualSnapshots.map((s:any)=>{const a=appointments.find(a=>a.id===s.appointment_id);return <label className="block" key={s.appointment_id}>Cobrança manual de {patientName(a.patientId||a.patient_id)} (máximo {money(Math.round(Number(s.final_amount)*100))})<input className={inputClass} inputMode="decimal" required value={policyAmounts[s.appointment_id]||''} onChange={e=>setPolicyAmounts({...policyAmounts,[s.appointment_id]:e.target.value})}/></label>;})}<p className="text-slate-500">As regras financeiras e os recebimentos existentes serão verificados antes da confirmação.</p></>}
          <button className="w-full rounded-xl bg-[#7a32fc] px-4 py-3 font-semibold text-white disabled:opacity-40" type="submit" disabled={busy||previewLoading||(['create','add'].includes(mode)&&rates.length!==patientIds.length)}>{busy?'Salvando…':mode==='create'?'Criar sessão em grupo':mode==='add'?'Adicionar participantes':mode==='edit'?'Salvar remarcação':'Confirmar cancelamento'}</button>
        </fieldset></form>}
      </>}
    </div>
  </div>;
}
