import React, {useCallback,useEffect,useState} from 'react';
import {ArrowLeft, CheckCircle2, Loader2, Search, Star, X} from 'lucide-react';

type Service={
  partner_id:string;service_name:string;category:string;description:string;logo_url:string|null;photo_url:string|null;
  partner:{display_name:string};
};
type Lead={id:string;partner_id:string;status:string;agreed_monthly_cents:number|null;clinic_confirmed_at:string|null;partner_confirmed_at:string|null};
type Review={rating:number;comment:string;created_at:string;clinic?:{name:string}|null};
async function api(path:string,init?:RequestInit){
  const r=await fetch(path,{credentials:'include',cache:'no-store',...init});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d.success!==true)throw new Error(d.error||'Não foi possível carregar os parceiros.');
  return d;
}
const json=(payload:unknown):RequestInit=>({
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
});
const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const status:Record<string,string>={
  interested:'Interesse enviado',awaiting_clinic:'Aguardando confirmação da clínica',
  active:'Contratação confirmada',declined:'Parceria encerrada'
};

/** Isolated B2B surface. Backend checks canonical clinic membership on every request. */
export function PartnerMarketplace({open,clinicId,onClose}:{
  open:boolean;clinicId:string;onClose:()=>void;
}){
  const [services,setServices]=useState<Service[]>([]);
  const [mine,setMine]=useState<Lead[]>([]);
  const [canManage,setCanManage]=useState(false);
  const [contact,setContact]=useState<{name:string;email:string;phone?:string|null}|null>(null);
  const [tab,setTab]=useState<'discover'|'mine'>('discover');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [interest,setInterest]=useState<Service|null>(null);
  const [consent,setConsent]=useState(false);
  const [selectedReviews,setSelectedReviews]=useState<string|null>(null);
  const [reviews,setReviews]=useState<Review[]>([]);
  const [reviewLead,setReviewLead]=useState<Lead|null>(null);
  const [rating,setRating]=useState(5);
  const [comment,setComment]=useState('');

  const reload=useCallback(async()=>{
    if(!clinicId)return;
    setLoading(true);setError('');
    try{
      const d=await api('/api/partnerships/marketplace?clinicId='+encodeURIComponent(clinicId));
      setServices(Array.isArray(d.services)?d.services:[]);
      setMine(Array.isArray(d.mine)?d.mine:[]);
      setCanManage(d.canManage===true);
      setContact(d.contact??null);
    }catch(e:any){setError(e.message||'Serviço indisponível.');}
    finally{setLoading(false);}
  },[clinicId]);
  useEffect(()=>{if(open){void reload();setTab('discover');setInterest(null);setSelectedReviews(null);}},[open,reload]);
  if(!open)return null;

  const mutate=async(fn:()=>Promise<void>)=>{
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{await fn();await reload();}
    catch(e:any){setError(e.message||'Não foi possível salvar.');}
    finally{setBusy(false);}
  };
  const sendInterest=()=>void mutate(async()=>{
    if(!interest||!consent)return;
    await api('/api/partnerships/marketplace/interest',json({
      clinicId,partnerId:interest.partner_id,consent:true
    }));
    setInterest(null);setConsent(false);setTab('mine');
    setNotice('Interesse registrado e disponibilizado ao parceiro.');
  });
  const confirmContract=(lead:Lead)=>void mutate(async()=>{
    await api('/api/partnerships/marketplace/clinic-confirm/'+encodeURIComponent(lead.id),
      json({clinicId}));
    setNotice('Contratação confirmada pela clínica.');
  });
  const endContract=(lead:Lead)=>void mutate(async()=>{
    await api('/api/partnerships/marketplace/clinic-end/'+encodeURIComponent(lead.id),
      json({clinicId}));
    setNotice('Parceria encerrada neste catálogo. O histórico e as avaliações foram preservados.');
  });
  const saveReview=()=>void mutate(async()=>{
    if(!reviewLead)return;
    await api('/api/partnerships/marketplace/review/'+encodeURIComponent(reviewLead.id),
      json({clinicId,rating,comment}));
    setReviewLead(null);setComment('');setRating(5);setSelectedReviews(null);setReviews([]);
    setNotice('Nova avaliação registrada de forma definitiva.');
  });
  const showReviews=async(partnerId:string)=>{
    if(selectedReviews===partnerId){setSelectedReviews(null);return;}
    setSelectedReviews(partnerId);setReviews([]);
    try{
      const d=await api('/api/partnerships/marketplace/reviews/'+encodeURIComponent(partnerId)
        +'?clinicId='+encodeURIComponent(clinicId));
      setReviews(Array.isArray(d.reviews)?d.reviews:[]);
    }catch(e:any){setError(e.message);}
  };
  const renderReviews=(partnerId:string)=>selectedReviews===partnerId&&
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
      <h4 className="text-xs font-semibold text-slate-700">Avaliações de clínicas que contrataram este parceiro</h4>
      {reviews.length===0?<p className="text-xs text-slate-500">Ainda não há avaliações.</p>
        :reviews.map((r,i)=><div key={i} className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-semibold text-amber-600" aria-label={r.rating+' de 5 estrelas'}>
            {'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{r.clinic?.name||'Clínica contratante'}
            {' · '}{new Date(r.created_at).toLocaleDateString('pt-BR')}</p>
          {r.comment&&<p className="mt-1 break-words text-sm text-slate-700">{r.comment}</p>}
        </div>)}
    </div>;
  const wasContracted=(lead:Lead)=>!!(lead.partner_confirmed_at&&lead.clinic_confirmed_at)
    &&(lead.status==='active'||lead.status==='declined');
  const filtered=services.filter(s=>(s.service_name+' '+s.category+' '+s.partner?.display_name)
    .toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const linked=(partnerId:string)=>mine.find(l=>l.partner_id===partnerId);
  return <div className="fixed inset-0 z-[220] flex items-start justify-center overflow-y-auto bg-slate-950/65 p-3 sm:p-6"
    role="dialog" aria-modal="true" aria-label="Encontrar parceiros"
    onKeyDown={e=>{if(e.key==='Escape')onClose();}}>
    <section className="w-full max-w-5xl rounded-3xl bg-slate-50 p-4 shadow-2xl sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">Rede Verto</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">Encontrar parceiros</h2>
          <p className="mt-1 text-sm text-slate-600">Serviços oferecidos por empresas parceiras. Negociação e pagamento fora da Verto.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar parceiros" className="rounded-xl p-2 hover:bg-slate-200"><X size={21}/></button>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button type="button" onClick={()=>setTab('discover')}
          className={'rounded-xl px-4 py-2 text-sm font-semibold '+(tab==='discover'?'bg-violet-700 text-white':'bg-white text-slate-600')}>
          Explorar serviços
        </button>
        <button type="button" onClick={()=>setTab('mine')}
          className={'rounded-xl px-4 py-2 text-sm font-semibold '+(tab==='mine'?'bg-violet-700 text-white':'bg-white text-slate-600')}>
          Meus parceiros ({mine.filter(wasContracted).length})
        </button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {loading && <p className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={17}/> Carregando...</p>}
      {!clinicId && <p className="mt-4 text-sm text-slate-600">Selecione uma clínica ativa para encontrar parceiros.</p>}
      {tab==='discover' && !!clinicId && <>
        <label className="mt-5 flex max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
          <Search size={17} className="text-slate-400"/>
          <input type="search" aria-label="Buscar parceiro ou serviço" placeholder="Buscar por empresa, serviço ou categoria"
            value={search} onChange={e=>setSearch(e.target.value)}
            className="w-full bg-transparent py-3 text-sm outline-none"/>
        </label>
        {!loading&&filtered.length===0 && <p className="mt-6 text-sm text-slate-500">Nenhum serviço publicado para sua busca.</p>}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {filtered.map(s=>{
            const lead=linked(s.partner_id);
            return <article key={s.partner_id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-3">
                {s.logo_url ? <img src={s.logo_url} alt={'Logo '+s.partner?.display_name}
                  referrerPolicy="no-referrer" loading="lazy" className="h-14 w-14 rounded-xl border border-slate-100 object-contain"/>
                  : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-violet-50 text-xl font-bold text-violet-700">{s.partner?.display_name?.slice(0,1)||'V'}</div>}
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900">{s.partner?.display_name}</h3>
                  <p className="text-xs text-violet-700">{s.category}</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{s.service_name}</p>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{s.description}</p>
              {s.photo_url && <img src={s.photo_url} alt={'Apresentação de '+s.partner?.display_name} referrerPolicy="no-referrer" loading="lazy" className="mt-3 max-h-40 w-full rounded-xl object-cover"/>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {lead?<span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">{status[lead.status]||lead.status}</span>
                  : <button type="button" disabled={!canManage||busy} onClick={()=>{setInterest(s);setConsent(false);}}
                    className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                    Tenho interesse
                  </button>}
                <button type="button" onClick={()=>void showReviews(s.partner_id)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700">
                  <Star size={14} className="mr-1 inline"/> Ver avaliações
                </button>
              </div>
              {!canManage && !lead && <p className="mt-2 text-xs text-slate-500">Somente diretor ou coordenador pode autorizar o compartilhamento de contatos da clínica.</p>}
              {renderReviews(s.partner_id)}
            </article>;
          })}
        </div>
      </>}
      {tab==='mine' && !!clinicId && <div className="mt-5 space-y-3">
        {!loading&&mine.length===0 && <p className="text-sm text-slate-500">Nenhum interesse registrado. Encontre serviços em Explorar serviços.</p>}
        {mine.map(lead=>{
          const service=services.find(s=>s.partner_id===lead.partner_id);
          return <article key={lead.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-900">{service?.partner?.display_name||'Parceiro'}</h3>
                <p className="mt-1 text-xs text-slate-500">{status[lead.status]||lead.status}</p>
              </div>
              {lead.status==='awaiting_clinic'&&canManage&&
                <button disabled={busy} onClick={()=>confirmContract(lead)}
                  className="rounded-xl bg-violet-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  Confirmar contratação {lead.agreed_monthly_cents!=null?'('+money(Number(lead.agreed_monthly_cents))+'/mês)':''}
                </button>}
              {wasContracted(lead)&&canManage&&
                <button disabled={busy} onClick={()=>{setReviewLead(lead);setRating(5);setComment('');}}
                  className="rounded-xl border border-violet-300 px-3 py-2 text-sm font-semibold text-violet-700">
                  Avaliar parceiro
                </button>}
            </div>
            {lead.status==='awaiting_clinic' && <p className="mt-2 text-xs text-slate-500">Confirme somente se a clínica realmente contratou o serviço e o valor está correto.</p>}
            {lead.status==='active' && <p className="mt-2 text-xs text-slate-500">Serviço contratado. Comissões externas ainda dependem de comprovação financeira e acordo comercial.</p>}
            {wasContracted(lead)&&<div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={()=>void showReviews(lead.partner_id)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700">
                <Star size={14} className="mr-1 inline"/> Ver avaliações
              </button>
              {lead.status==='active'&&canManage&&<button type="button" disabled={busy}
                onClick={()=>{if(window.confirm('Marcar esta parceria como encerrada? O histórico será mantido.'))endContract(lead);}}
                className="rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-600 disabled:opacity-50">
                Encerrar parceria
              </button>}
            </div>}
            {renderReviews(lead.partner_id)}
          </article>;
        })}
      </div>}
      {interest && <div className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="Autorizar compartilhamento">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="text-lg font-semibold text-slate-900">Autorizar contato com {interest.partner?.display_name}</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">Ao confirmar, a Verto compartilhará com este parceiro os dados abaixo exclusivamente para responder ao seu interesse comercial:</p>
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-800">
            <p><strong>Nome:</strong> {contact?.name||'Não disponível'}</p>
            <p className="mt-1 break-all"><strong>E-mail:</strong> {contact?.email||'Não disponível'}</p>
            {contact?.phone && <p className="mt-1"><strong>Telefone comercial:</strong> {contact.phone}</p>}
          </div>
          <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1"/>
            Autorizo o compartilhamento desses dados com o parceiro indicado para contato sobre este serviço.
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={()=>setInterest(null)} className="rounded-xl px-4 py-2 text-sm text-slate-700">Cancelar</button>
            <button type="button" onClick={sendInterest} disabled={!consent||!contact?.name||!contact?.email||busy}
              className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirmar e enviar</button>
          </div>
        </div>
      </div>}
      {reviewLead && <div className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="Avaliar parceiro">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="text-lg font-semibold text-slate-900">Avalie seu parceiro</h3>
          <p className="mt-2 text-sm text-slate-500">Somente clínicas com contratação confirmada (ativa ou encerrada) podem avaliar. Sua avaliação ficará pública no catálogo, sem opção de edição ou exclusão. A clínica pode registrar até duas avaliações por parceiro.</p>
          <div className="mt-4 flex gap-2" role="group" aria-label="Nota de 1 a 5 estrelas">
            {[1,2,3,4,5].map(n=><button key={n} type="button" onClick={()=>setRating(n)}
              aria-label={n+' estrelas'} aria-pressed={rating===n} className="rounded-lg p-1 text-amber-500">
              <Star size={26} fill={n<=rating?'currentColor':'none'}/></button>)}
          </div>
          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="partner-review-text">Comentário (opcional)</label>
          <textarea id="partner-review-text" rows={4} maxLength={1000} value={comment}
            onChange={e=>setComment(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm"/>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={()=>setReviewLead(null)} className="rounded-xl px-4 py-2 text-sm">Cancelar</button>
            <button disabled={busy} onClick={saveReview} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar avaliação</button>
          </div>
        </div>
      </div>}
      <div className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <CheckCircle2 size={14} className="mr-1 inline"/> A Verto não acessa prontuários nem compartilha dados de pacientes com parceiros.
      </div>
    </section>
  </div>;
}
