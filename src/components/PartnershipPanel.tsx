import React, {useCallback, useEffect, useState} from 'react';
import { PartnerMarketplacePublisher } from './PartnerMarketplacePublisher';
import { LogoVerto } from './Common';
import {ArrowLeft, Check, Copy, Gift, Loader2, Medal, MessageSquare, RefreshCw, Store, UsersRound} from 'lucide-react';

type Account = {
  id:string; display_name:string; referral_code:string; referral_alias?:string|null; status:'pending'|'approved'|'suspended';
  compliance_approved:boolean;
};
type Referral = {referral_id:string; clinic_name:string; lead_status:string; has_paid:boolean; referred_at:string;
  term_months?:6|9|12|null; first_paid_at?:string|null; term_ends_at?:string|null; subscription_active?:boolean;};

async function callApi(path:string,init?:RequestInit) {
  const response=await fetch(path,{credentials:'include',...init});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.success) throw new Error(data?.error||'Não foi possível carregar o programa.');
  return data;
}
const statusLabel:Record<string,string>={
  pending:'Inscrição em análise',approved:'Parceiro aprovado',suspended:'Parceria suspensa'
};
const partnerTabs = [
  {key:'program' as const,label:'Programa de parceiros',icon:Gift},
  {key:'referrals' as const,label:'Suas indicações',icon:UsersRound},
  {key:'store' as const,label:'Sua vitrine na Verto',icon:Store},
  {key:'interests' as const,label:'Interesses recebidos',icon:MessageSquare},
];
type PartnerTab = (typeof partnerTabs)[number]['key'];

export function PartnershipPanel({onBack,mode='professional'}:{onBack:()=>void;mode?:'professional'|'external'}) {
  const [account,setAccount]=useState<Account|null>(null);
  const [activeTab,setActiveTab]=useState<PartnerTab>('program');
  const [pendingInterests,setPendingInterests]=useState<number|null>(null);
  const [referrals,setReferrals]=useState<Referral[]>([]);
  const [currentTermMonths,setCurrentTermMonths]=useState<6|9|12>(6);
  const [qualifiedActive,setQualifiedActive]=useState(0);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [couponDraft,setCouponDraft]=useState('');
  const [couponSaving,setCouponSaving]=useState(false);
  const [couponCopied,setCouponCopied]=useState(false);
  const [couponFeedback,setCouponFeedback]=useState('');
  const [couponAttempted,setCouponAttempted]=useState(false);
  const reload=useCallback(async()=>{
    setError('');
    try {
      const data=await callApi(mode==='external'?'/api/partnerships/portal':'/api/partnerships/me');
      setAccount(data.account||null);
      setCouponDraft(data.account?.referral_alias||'');
      setReferrals(Array.isArray(data.referrals)?data.referrals:[]);
      setCurrentTermMonths([6,9,12].includes(data.currentTermMonths)?data.currentTermMonths:6);
      setQualifiedActive(Number.isSafeInteger(data.qualifiedActive)?data.qualifiedActive:0);
    }catch(e:any){setError(e?.message||'Serviço temporariamente indisponível.');}
    finally{setLoading(false);}
  },[mode]);
  useEffect(()=>{void reload();},[reload]);
  const enroll=async()=>{
    if(saving)return;
    setSaving(true);setError('');
    try{
      const result=await callApi('/api/partnerships/me',{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
      });
      // The persisted backend response is authoritative.
      setAccount(result.account);
    }catch(e:any){setError(e?.message||'Não foi possível enviar a solicitação.');}
    finally{setSaving(false);}
  };
  const approved=account?.status==='approved'&&account?.compliance_approved===true;
  const couponFormatError=(couponDraft || couponAttempted) && !/^[A-Z0-9]{4,24}$/.test(couponDraft.toUpperCase())
    ? 'Use de 4 a 24 letras ou números juntos, sem espaços, hífens ou símbolos. Ex.: FRATELLI10.' : '';
  const saveCoupon=async()=>{
    if(couponSaving || !approved || account?.referral_alias)return;
    const couponCode=couponDraft.toUpperCase();
    setCouponAttempted(true);
    if(!/^[A-Z0-9]{4,24}$/.test(couponCode))return;
    setCouponSaving(true);setError('');setCouponFeedback('');
    try {
      const result=await callApi(mode==='external'
        ? '/api/partnerships/portal/referral-alias'
        : '/api/partnerships/me/referral-alias',{
          method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({couponCode})
        });
      setAccount(prev=>prev?{...prev,referral_alias:result.couponCode}:prev);
      setCouponDraft(result.couponCode);
      setCouponFeedback('Cupom salvo.');
    }catch(e:any){
      const code=String(e?.message||'');
      setError(code==='REFERRAL_COUPON_TAKEN'?'Este cupom já está em uso. Escolha outro.'
        :code==='REFERRAL_COUPON_LOCKED'?'Este parceiro já tem um cupom definitivo.'
        :'Não foi possível salvar o cupom. Tente novamente.');
    }finally{setCouponSaving(false);}
  };
  const paid=referrals.filter(r=>r.has_paid).length;
  const partnerLevel=currentTermMonths===12?'Ouro':currentTermMonths===9?'Prata':'Bronze';
  const nextMilestone=currentTermMonths===12?null:currentTermMonths===9?6:3;
  const missingToNext=nextMilestone===null?0:Math.max(0,nextMilestone-qualifiedActive);
  const progressPercent=nextMilestone===null?100:Math.max(0,Math.min(100,(qualifiedActive/nextMilestone)*100));
  const levelColors=currentTermMonths===12?'bg-amber-100 text-amber-700':currentTermMonths===9?'bg-slate-100 text-slate-600':'bg-orange-100 text-orange-700';
  const progressColor=currentTermMonths===12?'bg-amber-500':currentTermMonths===9?'bg-slate-500':'bg-orange-500';
  const navigateTabs=(event:React.KeyboardEvent<HTMLButtonElement>,current:PartnerTab)=>{
    const index=partnerTabs.findIndex(tab=>tab.key===current);
    const next=event.key==='ArrowRight'?(index+1)%partnerTabs.length
      :event.key==='ArrowLeft'?(index+partnerTabs.length-1)%partnerTabs.length
      :event.key==='Home'?0:event.key==='End'?partnerTabs.length-1:-1;
    if(next===-1)return;
    event.preventDefault();
    const key=partnerTabs[next].key;
    setActiveTab(key);
    document.getElementById('partner-tab-'+key)?.focus();
  };

  return <section className="mx-auto max-w-4xl space-y-6 py-3" aria-labelledby="partner-page-title">
    <div className="flex items-center gap-3">
      <LogoVerto size={29} showText={true} />
      <button type="button" onClick={onBack} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50" aria-label="Voltar"><ArrowLeft size={18}/></button>
      <div>
        <h1 id="partner-page-title" className="text-xl font-semibold text-slate-900">{mode==='external'?'Programa de Parcerias':'Indique e Ganhe'}</h1>
        <p className="text-sm text-slate-500">Programa de parcerias comerciais da Verto</p>
      </div>
    </div>
    {approved && <div role="tablist" aria-label="Seções do portal de parceiros" className="flex gap-2 overflow-x-auto pb-1">
      {partnerTabs.map(({key,label,icon:Icon})=><button key={key} id={'partner-tab-'+key} type="button" role="tab"
        aria-controls={key==='store'||key==='interests'?'partner-panel-marketplace':'partner-panel-'+key} aria-selected={activeTab===key} tabIndex={activeTab===key?0:-1}
        aria-label={key==='interests'&&pendingInterests!==null&&pendingInterests>0
          ?'Interesses recebidos: '+pendingInterests+(pendingInterests===1?' solicitação pendente':' solicitações pendentes'):undefined}
        onClick={()=>setActiveTab(key)} onKeyDown={event=>navigateTabs(event,key)}
        className={'inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors '+
          (activeTab===key?'border-violet-300 bg-violet-50 text-violet-700':'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
        <Icon size={17} aria-hidden="true"/>{label}
        {key==='interests'&&pendingInterests!==null&&pendingInterests>0&&
          <span aria-hidden="true" className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-700 px-1 text-xs font-bold text-white">{pendingInterests}</span>}
      </button>)}
    </div>}
    {approved && activeTab!=='program' && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div id="partner-panel-program" role={approved?'tabpanel':undefined} aria-labelledby={approved?'partner-tab-program':undefined}
      hidden={approved&&activeTab!=='program'}>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
      <div className="mb-2 flex items-center gap-2 text-violet-700"><Gift size={18}/><span className="text-xs font-semibold">Programa de parceiros</span></div>
      <p className="text-2xl font-semibold text-slate-900">10% por até {currentTermMonths} meses nas próximas indicações</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">Comissão potencial sobre pagamentos recorrentes confirmados de novos clientes indicados.</p>
      {approved && <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/40 p-4 sm:p-5" aria-label="Progresso do parceiro">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={'flex h-11 w-11 shrink-0 items-center justify-center rounded-full '+levelColors}><Medal size={24} aria-hidden="true" /></span>
            <div>
              <p className="text-xs font-medium text-slate-500">Seu nível atual</p>
              <p className="text-lg font-bold text-slate-900">Parceiro {partnerLevel}</p>
            </div>
          </div>
          <span className="text-xs font-medium text-slate-600">{qualifiedActive} {qualifiedActive===1?'cliente qualificado ativo':'clientes qualificados ativos'}</span>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 text-xs font-semibold text-slate-600">
          <span>{nextMilestone===null?'Nível máximo alcançado':missingToNext===1?'Falta 1 cliente qualificado para o próximo nível':`Faltam ${missingToNext} clientes qualificados para o próximo nível`}</span>
          <span>{nextMilestone===null?'Ouro':`${qualifiedActive} / ${nextMilestone}`}</span>
        </div>
        <div role="progressbar" aria-label="Progresso para o próximo nível" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)} className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div className={'h-full rounded-full transition-all '+progressColor} style={{width:progressPercent+'%'}} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          {([{name:'Bronze',range:'0–2',term:6},{name:'Prata',range:'3–5',term:9},{name:'Ouro',range:'6+',term:12}] as const).map(level=>
            <div key={level.name} className={'rounded-xl border px-2 py-2.5 '+(currentTermMonths===level.term?'border-violet-300 bg-white font-semibold text-violet-800':'border-transparent bg-white/60 text-slate-500')}>
              <Medal size={18} className="mx-auto mb-1" aria-hidden="true" />
              <span className="block">{level.name}</span>
              <span className="mt-0.5 block text-[11px]">{level.range} clientes · {level.term} meses</span>
            </div>)}
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Cada indicação conquista um prazo próprio após dois pagamentos mensais confirmados. Reduções de nível têm carência de 30 dias; os prazos já concedidos não diminuem.</p>
      </div>}
      {loading ? <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={16}/> Carregando...</p>
      : !account && mode==='external' ? <p className="mt-5 text-sm text-slate-500">Seu cadastro não foi encontrado. Solicite participação ao comercial da Verto.</p>
      : !account ? <button type="button" disabled={saving} onClick={enroll} className="mt-5 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?'Enviando...':'Solicitar participação'}</button>
      : <div className="mt-5 space-y-3">
        {!approved && <p className="text-sm font-medium text-slate-800">{statusLabel[account.status]||'Status indisponível'}</p>}
        {approved ? <>
          <div className="space-y-2 pb-3">
            <label className="block text-xs font-medium text-slate-500" htmlFor="partner-coupon-code">Cupom de indicação personalizado</label>
            {account.referral_alias ? <div className="flex flex-wrap items-center gap-2">
              <input id="partner-coupon-code" readOnly value={account.referral_alias}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold tracking-wide text-slate-800"/>
              <button type="button" onClick={()=>{void navigator.clipboard.writeText(account.referral_alias||'').then(()=>setCouponCopied(true)).catch(()=>window.prompt('Copie seu cupom:',account.referral_alias||''));}}
                className="inline-flex items-center gap-2 rounded-xl border border-violet-200 px-4 py-3 text-sm font-semibold text-violet-700">
                {couponCopied?<Check size={16}/>:<Copy size={16}/>} {couponCopied?'Copiado':'Copiar cupom'}
              </button>
            </div> : <>
              <div className="flex flex-wrap gap-2">
                <input id="partner-coupon-code" type="text" value={couponDraft}
                  onChange={event=>{setCouponDraft(event.target.value);setCouponAttempted(false);}}
                  maxLength={64} autoComplete="off" placeholder="Ex.: FRATELLI10"
                  aria-invalid={!!couponFormatError} aria-describedby={couponFormatError?'partner-coupon-format-error':undefined}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 p-3 text-sm uppercase text-slate-800"/>
                <button type="button" disabled={couponSaving} onClick={()=>{void saveCoupon();}}
                  className="rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
                  {couponSaving?'Salvando...':'Salvar cupom'}
                </button>
              </div>
              {couponFormatError && <p id="partner-coupon-format-error" role="alert" className="text-xs text-rose-600">{couponFormatError}</p>}
              <p className="text-xs text-slate-500">O cupom é exclusivo e não poderá ser alterado após salvar, para preservar as indicações.</p>
            </>}
            {couponFeedback && <p role="status" className="text-xs font-medium text-emerald-700">{couponFeedback}</p>}
            <p className="text-xs text-slate-500">O cliente pode informar este cupom no campo “Quem te indicou?” do formulário de interesse.</p>
          </div>
        </> : <p className="text-sm text-slate-500">O código de indicação será disponibilizado somente após aprovação. Nenhuma comissão ou repasse está autorizado nesta etapa.</p>}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
    </div>
    {!!account && <div id="partner-panel-referrals" role={approved?'tabpanel':undefined} aria-labelledby={approved?'partner-tab-referrals':undefined}
      hidden={approved&&activeTab!=='referrals'}>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700"><UsersRound size={18}/> Suas indicações</h2>
        <button type="button" disabled={loading} onClick={()=>{setLoading(true);void reload();}} aria-label="Atualizar indicações" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50"><RefreshCw size={17} className={loading?'animate-spin':undefined}/></button>
      </div>
      <div className="mb-5 flex flex-wrap gap-5 text-sm text-slate-600">
        <span><strong className="text-slate-900">{referrals.length}</strong> indicações exibidas</span>
        <span><strong className="text-slate-900">{paid}</strong> com pagamento registrado</span>
        <span><strong className="text-slate-900">{referrals.length-paid}</strong> sem pagamento registrado</span>
      </div>
      {referrals.length===0 ? <p className="text-sm text-slate-500">Nenhuma indicação vinculada até o momento.</p>
      : <ul className="divide-y divide-slate-100">
        {referrals.map(item=><li key={item.referral_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <span className="min-w-0 truncate text-sm font-medium text-slate-800">{item.clinic_name}</span>
          <span className="flex flex-col items-end gap-1 text-right">
            <span className={'rounded-lg px-2.5 py-1 text-xs font-medium '+(item.has_paid?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600')}>
              {item.has_paid?'Pagamento confirmado':'Sem pagamento confirmado'}
            </span>
            {item.term_months ? <span className="text-xs text-slate-600">Direito de {item.term_months} meses · até {item.term_ends_at?new Date(item.term_ends_at).toLocaleDateString('pt-BR'):'data indisponível'}{!item.subscription_active?' · assinatura inativa':''}</span>
              : <span className="text-xs text-slate-500">Prazo pendente de qualificação</span>}
          </span>
        </li>)}
      </ul>}
      <p className="mt-4 text-xs text-slate-500">A lista exibe até 50 indicações recentes. O prazo começa no primeiro pagamento mensal elegível. Cancelamento interrompe novas comissões, mas preserva os prazos das demais indicações. Pagamento confirmado não equivale a comissão aprovada ou repasse realizado.</p>
    </div>
    </div>}
    {approved && <div id="partner-panel-marketplace" role="tabpanel"
      aria-labelledby={'partner-tab-'+(activeTab==='interests'?'interests':'store')}
      hidden={activeTab!=='store'&&activeTab!=='interests'}>
      <PartnerMarketplacePublisher activeSection={activeTab==='interests'?'interests':'store'} onPendingInterestsChange={setPendingInterests}/>
    </div>}
  </section>;
}
