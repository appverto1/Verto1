import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

type Partner = {
  id: string;
  display_name: string;
  status: 'pending' | 'approved' | 'suspended';
  referral_alias: string | null;
  referral_code: string;
};
type Totals = {
  partner_id: string;
  total_referrals: number;
  paid_referrals: number;
  negotiating_referrals: number;
  converted_unpaid_referrals: number;
  lost_referrals: number;
};
type Referral = {
  referral_id: string;
  clinic_name: string;
  lead_status: string;
  has_paid: boolean;
  referred_at: string;
};
const count=(value:number|null|undefined)=>Number(value||0).toLocaleString('pt-BR');
const date=(value:string)=>new Date(value).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
const state=(item:Referral)=>{
  if(item.has_paid)return 'Compra confirmada';
  if(item.lead_status==='converted')return 'Convertido, pagamento não confirmado';
  if(['lost','archived'].includes(item.lead_status))return 'Encerrada sem compra';
  if(item.lead_status==='new')return 'Em prospecção';
  return 'Em negociação';
};
async function request(path:string){
  const response=await fetch(path,{credentials:'include',cache:'no-store'});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||body.success!==true)throw new Error(body.error||'Não foi possível consultar as indicações.');
  return body;
}

export function OwnerPartnerReferralsPanel(){
  const [partners,setPartners]=useState<Partner[]>([]);
  const [totals,setTotals]=useState<Record<string,Totals>>({});
  const [loading,setLoading]=useState(true);
  const [loadingMore,setLoadingMore]=useState(false);
  const [hasMore,setHasMore]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [details,setDetails]=useState<Record<string,Referral[]>>({});
  const [detailMore,setDetailMore]=useState<Record<string,boolean>>({});
  const [detailLoading,setDetailLoading]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');

  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const result=await request('/api/owner/partnerships/referral-report?offset=0');
      setPartners(result.partners||[]);
      setTotals(Object.fromEntries((result.summary||[]).map((item:Totals)=>[item.partner_id,item])));
      setHasMore(Boolean(result.hasMore));
      setDetails({});setDetailMore({});setSelected(null);
    }catch(e:any){setError(e.message||'Indicadores indisponíveis.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);

  const morePartners=async()=>{
    if(loadingMore||!hasMore)return;
    setLoadingMore(true);setError('');
    try{
      const result=await request('/api/owner/partnerships/referral-report?offset='+partners.length);
      setPartners(old=>{
        const ids=new Set(old.map(p=>p.id));
        return [...old,...(result.partners||[]).filter((p:Partner)=>!ids.has(p.id))];
      });
      setHasMore(Boolean(result.hasMore));
      setTotals(Object.fromEntries((result.summary||[]).map((item:Totals)=>[item.partner_id,item])));
    }catch(e:any){setError(e.message||'Não foi possível carregar mais parceiros.');}
    finally{setLoadingMore(false);}
  };

  const open=async(id:string,loadMore=false)=>{
    if(detailLoading)return;
    if(!loadMore&&selected===id){setSelected(null);return;}
    setSelected(id);
    if(!loadMore&&details[id])return;
    setDetailLoading(id);setError('');
    try{
      const existing=details[id]||[];
      const offset=loadMore?existing.length:0;
      const result=await request('/api/owner/partnerships/referral-report/'+encodeURIComponent(id)+'?offset='+offset);
      const newRows:Referral[]=result.referrals||[];
      setDetails(old=>({...old,[id]:loadMore?[...(old[id]||[]),...newRows]:newRows}));
      setDetailMore(old=>({...old,[id]:newRows.length===50&&offset+50<=5000}));
    }catch(e:any){setError(e.message||'Não foi possível consultar as indicações desse parceiro.');}
    finally{setDetailLoading(null);}
  };

  const filtered=useMemo(()=>partners.filter(item=>
    (item.display_name+' '+(item.referral_alias||item.referral_code)).toLocaleLowerCase('pt-BR')
      .includes(search.trim().toLocaleLowerCase('pt-BR'))),[partners,search]);
  const displayedTotals=partners.reduce((a,p)=>{
    const t=totals[p.id];
    a.referred+=Number(t?.total_referrals||0);
    a.paid+=Number(t?.paid_referrals||0);
    return a;
  },{referred:0,paid:0});

  return <section className="space-y-5" aria-label="Indicações comerciais dos parceiros">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Indicações dos parceiros</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Origem vinculada ao lead do CRM. Uma compra só é confirmada após pagamento positivo registrado no ledger Stripe da Verto.
          Leads em negociação, perdidos e convertidos sem pagamento são separados.
        </p>
      </div>
      <button type="button" onClick={()=>void reload()} disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">
        <RefreshCw size={14}/>Atualizar
      </button>
    </div>
    {error&&<p role="alert" className="rounded-xl border border-rose-200 p-3 text-sm text-rose-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-xs text-slate-500">Parceiros carregados</span>
        <p className="text-2xl font-bold text-slate-900">{count(partners.length)}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-xs text-slate-500">Indicações desses parceiros</span>
        <p className="text-2xl font-bold text-slate-900">{count(displayedTotals.referred)}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-xs text-slate-500">Compras confirmadas desses parceiros</span>
        <p className="text-2xl font-bold text-slate-900">{count(displayedTotals.paid)}</p>
      </div>
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <label htmlFor="partner-referral-search" className="mb-1.5 block text-xs font-semibold text-slate-600">
        Buscar parceiro ou cupom nos resultados carregados
      </label>
      <input id="partner-referral-search" value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="Nome ou cupom" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:max-w-md"/>
      {loading?<p className="mt-5 text-sm text-slate-500">Consultando indicações...</p>
        :filtered.length===0?<p className="mt-5 text-sm text-slate-500">Nenhum parceiro encontrado.</p>
        :<ul className="mt-4 divide-y divide-slate-100">
          {filtered.map(p=>{
            const t=totals[p.id];
            const expanded=selected===p.id;
            return <li key={p.id} className="py-3">
              <button type="button" onClick={()=>void open(p.id)}
                aria-expanded={expanded} className="w-full rounded-lg p-2 text-left hover:bg-slate-50">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{p.display_name}</p>
                    <p className="text-xs text-slate-500">Cupom: {p.referral_alias||p.referral_code} · {p.status==='approved'?'Aprovado':p.status==='pending'?'Em análise':'Suspenso'}</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-semibold text-violet-700">
                    Ver indicações {expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700">
                  <span><b>{count(t?.total_referrals)}</b> indicados</span>
                  <span><b>{count(t?.paid_referrals)}</b> compraram</span>
                  <span><b>{count(t?.negotiating_referrals)}</b> em negociação</span>
                  <span><b>{count(t?.converted_unpaid_referrals)}</b> convertidos sem pagamento</span>
                  <span><b>{count(t?.lost_referrals)}</b> perdidos</span>
                </div>
              </button>
              {expanded&&<div className="mt-2 space-y-2 px-2" aria-label={'Indicações de '+p.display_name}>
                {detailLoading===p.id&&!details[p.id]&&<p className="text-xs text-slate-500">Carregando indicações...</p>}
                {details[p.id]?.length===0&&<p className="text-xs text-slate-500">Nenhuma indicação registrada para este parceiro.</p>}
                {(details[p.id]||[]).map(r=><div key={r.referral_id}
                  className="flex flex-wrap justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                  <div>
                    <p className="font-semibold text-slate-800">{r.clinic_name}</p>
                    <p className="mt-1 text-slate-500">Indicada em {date(r.referred_at)}</p>
                  </div>
                  <span className={r.has_paid?'font-semibold text-emerald-700':'text-slate-600'}>{state(r)}</span>
                </div>)}
                {detailMore[p.id]&&<button type="button" disabled={detailLoading===p.id}
                  onClick={()=>void open(p.id,true)}
                  className="rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 disabled:opacity-50">
                  {detailLoading===p.id?'Carregando...':'Carregar mais indicações'}
                </button>}
              </div>}
            </li>;
          })}
        </ul>}
      {hasMore&&<button type="button" disabled={loadingMore} onClick={()=>void morePartners()}
        className="mt-4 rounded-lg border border-violet-200 px-4 py-2 text-xs font-semibold text-violet-700 disabled:opacity-50">
        {loadingMore?'Carregando...':'Carregar mais parceiros'}
      </button>}
      <p className="mt-4 text-xs text-slate-500">
        Pagamento significa fatura paga de valor positivo, não apenas proposta aceita, acesso criado ou cartão informado.
        Nenhuma comissão é liquidada automaticamente por este relatório.
      </p>
    </div>
  </section>;
}
