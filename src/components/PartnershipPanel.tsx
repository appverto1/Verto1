import React, {useCallback, useEffect, useState} from 'react';
import { PartnerMarketplacePublisher } from './PartnerMarketplacePublisher';
import {ArrowLeft, Check, Copy, Gift, Loader2, RefreshCw} from 'lucide-react';

type Account = {
  id:string; display_name:string; referral_code:string; referral_alias?:string|null; status:'pending'|'approved'|'suspended';
  compliance_approved:boolean;
};
type Referral = {referral_id:string; clinic_name:string; lead_status:string; has_paid:boolean; referred_at:string};

async function callApi(path:string,init?:RequestInit) {
  const response=await fetch(path,{credentials:'include',...init});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.success) throw new Error(data?.error||'Não foi possível carregar o programa.');
  return data;
}
const statusLabel:Record<string,string>={
  pending:'Inscrição em análise',approved:'Parceiro aprovado',suspended:'Parceria suspensa'
};

export function PartnershipPanel({onBack,mode='professional'}:{onBack:()=>void;mode?:'professional'|'external'}) {
  const [account,setAccount]=useState<Account|null>(null);
  const [referrals,setReferrals]=useState<Referral[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);
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
  const referralLink=approved && typeof window!=='undefined'
    ? new URL('/?ref='+encodeURIComponent(account.referral_alias||account.referral_code),window.location.origin).toString()
    : '';
  const copy=async()=>{
    if(!referralLink)return;
    try{await navigator.clipboard.writeText(referralLink);setCopied(true);}
    catch{window.prompt('Copie seu link:',referralLink);}
  };
  const couponFormatError=(couponDraft || couponAttempted) && !/^[A-Z0-9]{4,24}$/.test(couponDraft.trim().toUpperCase())
    ? 'Use de 4 a 24 letras ou números juntos, sem espaços, hífens ou símbolos. Ex.: FRATELLI10.' : '';
  const saveCoupon=async()=>{
    if(couponSaving || !approved || account?.referral_alias)return;
    const couponCode=couponDraft.trim().toUpperCase();
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

  return <section className="mx-auto max-w-4xl space-y-6 py-3" aria-labelledby="partner-page-title">
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50" aria-label="Voltar"><ArrowLeft size={18}/></button>
      <div>
        <h1 id="partner-page-title" className="text-xl font-semibold text-slate-900">{mode==='external'?'Programa de Parcerias':'Indique e Ganhe'}</h1>
        <p className="text-sm text-slate-500">Programa de parcerias comerciais da Verto</p>
      </div>
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
      <div className="mb-2 flex items-center gap-2 text-violet-700"><Gift size={18}/><span className="text-xs font-semibold">Programa de parceiros</span></div>
      <p className="text-2xl font-semibold text-slate-900">10% por até 12 meses</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">Comissão potencial sobre pagamentos recorrentes confirmados de novos clientes indicados. Participação, elegibilidade e repasses dependem de aprovação comercial e jurídica. Não se aplica à indicação de pacientes ou serviços assistenciais.</p>
      {loading ? <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={16}/> Carregando...</p>
      : !account && mode==='external' ? <p className="mt-5 text-sm text-slate-500">Seu cadastro não foi encontrado. Solicite participação ao comercial da Verto.</p>
      : !account ? <button type="button" disabled={saving} onClick={enroll} className="mt-5 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?'Enviando...':'Solicitar participação'}</button>
      : <div className="mt-5 space-y-3">
        <p className="text-sm font-medium text-slate-800">{statusLabel[account.status]||'Status indisponível'}</p>
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
          <label className="block text-xs font-medium text-slate-500" htmlFor="partner-share-url">Seu link de indicação (opcional)</label>
          <div className="flex flex-wrap gap-2">
            <input id="partner-share-url" readOnly value={referralLink} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" />
            <button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white">{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Copiado':'Copiar'}</button>
          </div>
        </> : <p className="text-sm text-slate-500">O link de divulgação será disponibilizado somente após aprovação. Nenhuma comissão ou repasse está autorizado nesta etapa.</p>}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
    {!!account && <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Suas indicações</h2>
        <button type="button" onClick={()=>{setLoading(true);void reload();}} aria-label="Atualizar indicações" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><RefreshCw size={17}/></button>
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
          <span className={'rounded-lg px-2.5 py-1 text-xs font-medium '+(item.has_paid?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600')}>
            {item.has_paid?'Pagamento confirmado':'Sem pagamento confirmado'}
          </span>
        </li>)}
      </ul>}
      <p className="mt-4 text-xs text-slate-500">A lista exibe até 50 indicações recentes. Pagamento confirmado não equivale a comissão aprovada ou repasse realizado.</p>
    </div>}
    {approved && <PartnerMarketplacePublisher />}
  </section>;
}
