import React, { useRef, useState } from 'react';
import { getSupabase } from '../lib/supabase';

type Rule = {
  id: string; name: string; cost_type:'fixed'|'variable';
  category:'operating'|'below_ebitda'; amount_cents:number; rate_basis_points:number;
  starts_month:string; ends_month:string|null;
};
const currentMonth=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'}).slice(0,7);
const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100);
const parseDecimal=(value:string,scale:number):number|null=>{
  const normalized=value.trim().replace(',','.');
  if(!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) return null;
  const [integer,decimal='']=normalized.split('.');
  const whole=Number(integer)*scale;
  const fractional=Number(decimal.padEnd(2,'0'))*(scale/100);
  const number=whole+fractional;
  return Number.isSafeInteger(number)?number:null;
};
const newDraft=()=>({name:'',costType:'variable' as 'fixed'|'variable',category:'operating' as 'operating'|'below_ebitda',
  amount:'0',rate:'0',startsMonth:currentMonth()});

export function OwnerDreCostsPanel({rules,onChanged}:{
  rules:Rule[];onChanged:()=>Promise<void>;
}){
  const [draft,setDraft]=useState(newDraft);
  const [editing,setEditing]=useState<string|null>(null);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const requestIdRef=useRef<string|null>(null);
  const update=(patch:Partial<ReturnType<typeof newDraft>>)=>{requestIdRef.current=null;setDraft(d=>({...d,...patch}));};
  const reset=()=>{setEditing(null);setDraft(newDraft());requestIdRef.current=null;};
  const request=async(url:string,method:'POST'|'PATCH',body:Record<string,unknown>)=>{
    const supabase=await getSupabase();
    const {data:{session}}=await supabase.auth.getSession();
    if(!session?.access_token)throw new Error('Entre novamente na sua conta para salvar.');
    const response=await fetch(url,{
      method,credentials:'include',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
      body:JSON.stringify(body),
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok || result.success!==true)
      throw new Error(result.error||'Não foi possível salvar o custo.');
    return result;
  };
  const save=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(saving)return;
    setError('');setNotice('');
    const amountCents=parseDecimal(draft.amount,100);
    const rateBasisPoints=parseDecimal(draft.rate,100);
    if(!draft.name.trim()||amountCents===null||rateBasisPoints===null
      ||amountCents+rateBasisPoints<=0||rateBasisPoints>10000
      ||!/^(\d{4})-(0[1-9]|1[0-2])$/.test(draft.startsMonth)){
      setError('Informe nome, um valor em reais ou uma porcentagem válida e o mês de início.');
      return;
    }
    setSaving(true);
    if(!requestIdRef.current)requestIdRef.current=crypto.randomUUID();
    try{
      const body={name:draft.name.trim(),costType:draft.costType,category:draft.category,
        amountCents,rateBasisPoints,startsMonth:draft.startsMonth,requestId:requestIdRef.current};
      await request(editing?'/api/owner/dre/costs/'+encodeURIComponent(editing):'/api/owner/dre/costs',
        editing?'PATCH':'POST',editing?{...body,action:'update'}:body);
      await onChanged();
      reset();
      setNotice('Custo salvo. DRE e gráficos atualizados sem F5.');
    }catch(err:any){setError(String(err?.message||'Falha ao salvar.'));}
    finally{setSaving(false);}
  };
  const stop=async(rule:Rule)=>{
    if(saving)return;
    if(!window.confirm('Encerrar '+rule.name+' a partir deste mês? Os meses anteriores serão preservados.'))return;
    setSaving(true);setError('');setNotice('');
    try{
      await request('/api/owner/dre/costs/'+encodeURIComponent(rule.id),'PATCH',{action:'stop'});
      await onChanged();
      if(editing===rule.id)reset();
      setNotice('Custo encerrado para o mês atual e os próximos.');
    }catch(err:any){setError(String(err?.message||'Não foi possível encerrar o custo.'));}
    finally{setSaving(false);}
  };
  const edit=(rule:Rule)=>{
    setEditing(rule.id);requestIdRef.current=null;setError('');setNotice('');
    setDraft({name:rule.name,costType:rule.cost_type,category:rule.category,
      amount:(rule.amount_cents/100).toFixed(2).replace('.',','),
      rate:(rule.rate_basis_points/100).toFixed(2).replace('.',','),
      startsMonth:rule.starts_month.slice(0,7)});
  };
  const now=currentMonth();
  return <section className="rounded-[28px] border border-slate-100 bg-white p-4 shadow-sm sm:p-6" aria-label="Cadastro de custos do DRE">
    <div className="mb-5">
      <h3 className="text-lg font-black">Cadastro de custos do DRE</h3>
      <p className="mt-1 text-sm text-slate-600">Receitas pagas entram pelo valor bruto. Os custos só entram após o seu cadastro e clique em <strong>Salvar custo</strong>. Custos calculados para avaliar vendas de módulos não entram neste DRE. Nenhuma taxa é descontada automaticamente por premissas do simulador.</p>
      <p className="mt-2 text-xs text-slate-500">Exemplo: taxa Stripe de 3,99% + R$ 0,39 → custo variável por fatura. Em uma venda bruta de R$ 600,00: taxa R$ 24,33, caixa estimado após essa taxa R$ 575,67. Cadastre a taxa apenas se ela realmente se aplicar à sua cobrança.</p>
    </div>
    <form onSubmit={save} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs font-bold">Descrição
        <input required maxLength={120} value={draft.name} onChange={e=>update({name:e.target.value})}
          placeholder="Ex.: Taxa Stripe" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"/>
      </label>
      <label className="text-xs font-bold">Classificação
        <select value={draft.costType} onChange={e=>update({costType:e.target.value as 'fixed'|'variable'})}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
          <option value="variable">Variável · por pagamento</option>
          <option value="fixed">Fixo · por mês</option>
        </select>
      </label>
      <label className="text-xs font-bold">Classificação no resultado
        <select value={draft.category} onChange={e=>update({category:e.target.value as 'operating'|'below_ebitda'})}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
          <option value="operating">Operacional · compõe EBITDA</option>
          <option value="below_ebitda">Abaixo do EBITDA · financeiro/impostos</option>
        </select>
      </label>
      <label className="text-xs font-bold">Valor fixo (R$)
        <input required inputMode="decimal" value={draft.amount} onChange={e=>update({amount:e.target.value})} placeholder="0,39"
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"/>
      </label>
      <label className="text-xs font-bold">Percentual (%) sobre receita bruta
        <input required inputMode="decimal" value={draft.rate} onChange={e=>update({rate:e.target.value})} placeholder="3,99"
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"/>
      </label>
      <label className="text-xs font-bold">Início da vigência (mês)
        <input required type="month" min={now} value={draft.startsMonth} onChange={e=>update({startsMonth:e.target.value})}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"/>
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
        <button type="submit" disabled={saving} className="min-h-10 rounded-xl bg-[#10192D] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{saving?'Salvando…':editing?'Salvar alterações':'Salvar custo'}</button>
        {editing&&<button type="button" onClick={reset} className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm">Cancelar edição</button>}
        <span className="text-xs text-slate-500">Custos fixos são aplicados uma vez por mês; variáveis, em cada fatura paga. Valor e percentual podem ser combinados.</span>
      </div>
    </form>
    {error&&<p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice&&<p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="mt-5">
      <h4 className="mb-2 text-sm font-black">Custos cadastrados ({rules.length})</h4>
      {!rules.length?<p className="text-sm text-slate-500">Nenhum custo cadastrado neste ambiente. O EBITDA usa receita bruta sem despesas até você salvar custos.</p>:
      <div className="space-y-2">
        {rules.map(rule=>{
          const stopped=Boolean(rule.ends_month && rule.ends_month.slice(0,7)<now);
          const editable=rule.starts_month.slice(0,7)>=now && !stopped;
          return <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <div className="min-w-0">
              <div className="text-sm font-bold">{rule.name} <span className="font-normal text-slate-500">· {rule.cost_type==='fixed'?'Fixo mensal':'Variável por fatura'}</span></div>
              <p className="text-xs text-slate-600">{money(rule.amount_cents)} + {(rule.rate_basis_points/100).toFixed(2).replace('.',',')}% · {rule.category==='operating'?'Operacional':'Abaixo do EBITDA'} · desde {rule.starts_month.slice(0,7)}{rule.ends_month?' até '+rule.ends_month.slice(0,7):''}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {editable&&<button type="button" disabled={saving} onClick={()=>edit(rule)} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs">Editar</button>}
              {!stopped&&<button type="button" disabled={saving} onClick={()=>stop(rule)} className="min-h-9 rounded-lg border border-rose-200 px-3 text-xs text-rose-700">Encerrar</button>}
              {stopped&&<span className="text-xs text-slate-500">Encerrado</span>}
            </div>
          </div>;
        })}
      </div>}
      <p className="mt-3 text-xs text-slate-500">Meses encerrados não são reescritos: para atualizar uma regra antiga, encerre-a e cadastre outra com vigência no mês atual. Fluxo de caixa exibido no DRE é <strong>estimado</strong>, sem conciliação de repasses ou extrato bancário.</p>
    </div>
  </section>;
}
