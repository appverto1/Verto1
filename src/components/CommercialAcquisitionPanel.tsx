import React,{useEffect,useState} from 'react';
import {getSupabase} from '../lib/supabase';

type Channel={id:string;name:string;is_active:boolean};
type Metrics={
 id:string;name:string;is_active:boolean;
 opportunities:number;converted:number;lost:number;decision_contacts:number;interested_leads:number;
};
const n=(x:number)=>Number(x||0).toLocaleString('pt-BR');
const rate=(a:number,b:number)=>b?(a*100/b).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
export function CommercialAcquisitionPanel({onClose,onChanged}:{
 onClose:()=>void;onChanged:()=>Promise<void>;
}){
 const [channels,setChannels]=useState<Channel[]>([]);
 const [metrics,setMetrics]=useState<Metrics[]>([]);
 const [name,setName]=useState('');
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [revision,setRevision]=useState(0);
 const request=async(path:string,init:RequestInit={})=>{
  const client=await getSupabase();
  const {data:{session}}=await client.auth.getSession();
  const response=await fetch(path,{...init,credentials:'include',headers:{
    Authorization:session?.access_token?'Bearer '+session.access_token:'',
    ...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers||{})
  }});
  const json=await response.json().catch(()=>({}));
  if(!response.ok||!json.success)throw Error(json.error||'Erro na operação.');
  return json;
 };
 const refresh=async()=>{
  const [board,report]=await Promise.all([
   request('/api/owner/sales/acquisition/board'),
   request('/api/owner/sales/acquisition/metrics'),
  ]);
  setChannels(board.channels||[]);setMetrics(report.metrics||[]);
 };
 useEffect(()=>{
  let live=true;setLoading(true);
  void (async()=>{try{
   const [board,report]=await Promise.all([
    request('/api/owner/sales/acquisition/board'),
    request('/api/owner/sales/acquisition/metrics'),
   ]);
   if(live){setChannels(board.channels||[]);setMetrics(report.metrics||[]);setError('');}
  }catch(e:any){if(live)setError(e.message||'Não foi possível carregar os canais.');}
  finally{if(live)setLoading(false);}})();
  return()=>{live=false;};
 },[revision]);
 const create=async()=>{
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{
   await request('/api/owner/sales/acquisition/channels',{method:'POST',
     body:JSON.stringify({name:name.trim()})});
   setName('');await refresh();await onChanged();
   setMessage('Canal cadastrado. Já aparece em todos os cards, sem atualizar a página.');
  }catch(e:any){setError(e.message||'Não foi possível cadastrar o canal.');}
  finally{setBusy(false);}
 };
 const changeStatus=async(ch:Channel)=>{
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{
   await request('/api/owner/sales/acquisition/channels/'+ch.id,{
     method:'PATCH',body:JSON.stringify({active:!ch.is_active})});
   await refresh();await onChanged();
   setMessage(ch.is_active?'Canal desativado. Seleções anteriores preservadas.':'Canal reativado para novos registros.');
  }catch(e:any){setError(e.message||'Não foi possível alterar o canal.');}
  finally{setBusy(false);}
 };
 return <section className="rounded-xl border border-indigo-200 bg-white p-4 sm:p-5"
  aria-label="Canais de aquisição e resultados">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h3 className="text-lg font-black">Canais de aquisição</h3>
    <p className="mt-1 text-xs text-slate-600">
     Cadastre uma vez e selecione quantos canais forem necessários em cada oportunidade.
    </p></div>
   <button type="button" onClick={onClose}
    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">Fechar canais</button>
  </div>
  {(error||message)&&<p role={error?'alert':'status'}
   className={'mt-3 rounded-lg p-3 text-xs '+(error?'bg-red-50 text-red-700':'bg-green-50 text-green-800')}>{error||message}</p>}
  <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
   <div className="rounded-xl bg-slate-50 p-4">
    <h4 className="text-sm font-black">Gerenciar canais</h4>
    <label className="mt-3 block text-xs font-bold text-slate-700">Novo canal
     <input value={name} maxLength={80} onChange={e=>setName(e.target.value)}
      placeholder="Ex.: Parceria com consultoria"
      className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"/>
    </label>
    <button type="button" disabled={busy||name.trim().length<2} onClick={()=>void create()}
     className="mt-2 w-full rounded-lg bg-indigo-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">
     {busy?'Salvando...':'Cadastrar canal'}
    </button>
    {loading?<p className="mt-3 text-xs">Carregando...</p>:
     <div className="mt-4 space-y-2">{channels.map(ch=>
      <div key={ch.id} className="flex items-center justify-between gap-2 rounded-lg border bg-white p-2">
       <span className="min-w-0 break-words text-xs font-semibold text-slate-800">{ch.name}
        <span className="block text-[10px] font-normal text-slate-500">{ch.is_active?'Disponível':'Desativado'}</span>
       </span>
       <button type="button" disabled={busy} onClick={()=>void changeStatus(ch)}
        className="shrink-0 rounded-lg border px-2 py-1.5 text-xs font-semibold disabled:opacity-40">
        {ch.is_active?'Desativar':'Ativar'}
       </button>
      </div>)}</div>}
    <p className="mt-3 text-[11px] text-slate-500">
     Desativar impede novas marcações, mas mantém as origens dos cards e as estatísticas anteriores.
    </p>
   </div>
   <div className="min-w-0">
    <h4 className="text-sm font-black">Quais canais trazem melhores resultados?</h4>
    <p className="mt-1 text-xs text-slate-600">
     Atribuição múltipla: um lead marcado em Evento e Indicação conta uma vez em cada canal.
     Compare taxas, não some os totais entre canais.
    </p>
    <div className="mt-3 overflow-x-auto">
     <table className="min-w-[610px] w-full text-left text-xs">
      <thead><tr className="border-b bg-slate-50 text-slate-600">
       <th className="p-2">Canal</th><th className="p-2 text-right">Oportunidades</th>
       <th className="p-2 text-right">Decisores</th><th className="p-2 text-right">Interessados</th>
       <th className="p-2 text-right">Clientes</th><th className="p-2 text-right">Conversão</th>
      </tr></thead>
      <tbody>{metrics.map(m=><tr key={m.id} className="border-b">
       <td className="p-2 font-semibold">{m.name}{!m.is_active&&<span className="block text-[10px] text-slate-500">Histórico</span>}</td>
       <td className="p-2 text-right tabular-nums">{n(m.opportunities)}</td>
       <td className="p-2 text-right tabular-nums">{n(m.decision_contacts)}</td>
       <td className="p-2 text-right tabular-nums">{n(m.interested_leads)}</td>
       <td className="p-2 text-right tabular-nums">{n(m.converted)}</td>
       <td className="p-2 text-right font-bold tabular-nums">{rate(m.converted,m.opportunities)}</td>
      </tr>)}</tbody>
     </table>
    </div>
    <p className="mt-3 text-[11px] text-slate-500">
     Conversão = clientes convertidos ÷ oportunidades atribuídas. Registros excluídos do cadastro principal
     e históricos sem canal não são presumidos. Atribuições adicionais alteram resultados futuros e atuais.
    </p>
    <button type="button" onClick={()=>setRevision(x=>x+1)} className="mt-2 rounded-lg border px-3 py-2 text-xs font-semibold">
     Atualizar comparativo
    </button>
   </div>
  </div>
 </section>;
}
