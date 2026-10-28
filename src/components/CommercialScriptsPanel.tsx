import React,{useEffect,useState} from 'react';
import {getSupabase} from '../lib/supabase';

export type SalesScriptVersion={
 id:string;name:string;version_label:string;source_kind:'text'|'url'|'file';
 source_text:string|null;source_url:string|null;file_name:string|null;
 file_mime:string|null;file_bytes:number|null;is_active:boolean;created_at:string;
};
type Metrics={
 id:string;total_attempts:number;no_answer:number;not_interested:number;
 interested:number;decision_conversations:number;interested_leads:number;
};
const fmt=(n:number)=>Number(n||0).toLocaleString('pt-BR');
const pct=(num:number,den:number)=>den?(100*num/den).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
const nameVersion=(s:Pick<SalesScriptVersion,'name'|'version_label'>)=>s.name+' · '+s.version_label;
const fileMimes=new Set([
 'application/pdf','text/plain','image/png','image/jpeg','image/webp',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
export function CommercialScriptsPanel({onClose,onChanged}:{
  onClose:()=>void;onChanged:()=>Promise<void>;
}){
 const [versions,setVersions]=useState<SalesScriptVersion[]>([]);
 const [stats,setStats]=useState<Record<string,Metrics>>({});
 const [days,setDays]=useState(0);
 const [name,setName]=useState('');
 const [versionLabel,setVersionLabel]=useState('v1');
 const [kind,setKind]=useState<'text'|'url'|'file'>('text');
 const [sourceText,setSourceText]=useState('');
 const [sourceUrl,setSourceUrl]=useState('');
 const [file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [revision,setRevision]=useState(0);
 const [saveKey,setSaveKey]=useState<string|null>(null);
 const request=async(path:string,init:RequestInit={})=>{
   const auth=await getSupabase();
   const {data:{session}}=await auth.auth.getSession();
   const result=await fetch(path,{...init,credentials:'include',headers:{
     Authorization:session?.access_token?'Bearer '+session.access_token:'',
     ...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers||{}),
   }});
   const payload=await result.json().catch(()=>({}));
   if(!result.ok||!payload.success)throw Error(payload.error||'Falha na operação.');
   return payload;
 };
 const refresh=async()=>{
   const data=await request('/api/owner/sales/scripts?days='+days);
   const list:SalesScriptVersion[]=data.versions||[];
   const metrics:Metrics[]=data.metrics||[];
   setVersions(list);
   setStats(Object.fromEntries(metrics.map(m=>[m.id,m])));
 };
 useEffect(()=>{
   let active=true;
   setLoading(true);
   void (async()=>{try{
     const data=await request('/api/owner/sales/scripts?days='+days);
     if(!active)return;
     setVersions(data.versions||[]);
     setStats(Object.fromEntries((data.metrics||[]).map((m:Metrics)=>[m.id,m])));
     setError('');
   }catch(e:any){if(active)setError(e.message||'Falha ao carregar scripts.');}
   finally{if(active)setLoading(false);}})();
   return()=>{active=false;};
 },[days,revision]);
 const resetKey=()=>setSaveKey(null);
 const create=async()=>{
   if(busy)return;
   setBusy(true);setError('');setNotice('');
   try{
     if(name.trim().length<2||name.trim().length>120||!versionLabel.trim()||versionLabel.trim().length>40)
       throw Error('Informe nome e versão válidos.');
     if(kind==='text'&&(!sourceText.trim()||sourceText.length>20000))
       throw Error('O conteúdo manual deve ter até 20 mil caracteres.');
     if(kind==='url'){
       const u=new URL(sourceUrl);
       if(!['https:','http:'].includes(u.protocol)||u.username||u.password)
         throw Error('Informe um link HTTP/HTTPS válido.');
     }
     if(kind==='file'&&(!file||!fileMimes.has(file.type)||file.size>4194304||file.size<1))
       throw Error('Envie PDF, DOCX, TXT ou imagem de até 4 MB.');
     const key=saveKey||crypto.randomUUID();
     setSaveKey(key);
     let path:string|null=null;
     if(kind==='file'&&file){
       const ticket=await request('/api/owner/sales/scripts/upload-url',{
         method:'POST',body:JSON.stringify({fileName:file.name,mime:file.type,size:file.size}),
       });
       const client=await getSupabase();
       const upload=await client.storage.from('sales-script-assets-private')
         .uploadToSignedUrl(ticket.path,ticket.token,file,{contentType:file.type,upsert:false});
       if(upload.error)throw Error('Falha no envio do arquivo privado. Nenhuma versão foi cadastrada.');
       path=ticket.path;
     }
     await request('/api/owner/sales/scripts',{method:'POST',headers:{'X-Idempotency-Key':key},
       body:JSON.stringify({
         name:name.trim(),versionLabel:versionLabel.trim(),sourceKind:kind,
         sourceText:kind==='text'?sourceText:null,
         sourceUrl:kind==='url'?sourceUrl.trim():null,
         filePath:path,fileName:kind==='file'?file?.name:null,
         fileMime:kind==='file'?file?.type:null,fileBytes:kind==='file'?file?.size:null,
       }),
     });
     setSaveKey(null);setName('');setVersionLabel('v1');setSourceText('');setSourceUrl('');setFile(null);
     setNotice('Versão criada e ativada. Selecione-a ao salvar os próximos contatos.');
     await refresh();
     await onChanged();
   }catch(e:any){setError(e.message||'Não foi possível cadastrar a versão.');}
   finally{setBusy(false);}
 };
 const changeStatus=async(s:SalesScriptVersion)=>{
   if(busy)return;
   setBusy(true);setError('');setNotice('');
   try{
     await request('/api/owner/sales/scripts/'+s.id+'/active',{
       method:'PATCH',body:JSON.stringify({active:!s.is_active}),
     });
     await refresh();await onChanged();
     setNotice(s.is_active?'Versão desativada; dados históricos preservados.':'Versão ativada.');
   }catch(e:any){setError(e.message||'Não foi possível mudar o status.');}
   finally{setBusy(false);}
 };
 const openFile=async(id:string)=>{
   setError('');
   try{
     // Open a blank tab on the click before awaiting authenticated signed-URL retrieval.
     const tab=window.open('about:blank','_blank');
     const json=await request('/api/owner/sales/scripts/'+id+'/file');
     if(!/^https:\/\//i.test(json.url))throw Error('Link privado inválido.');
     if(tab){tab.opener=null;tab.location.href=json.url;}
     else window.location.assign(json.url);
   }catch(e:any){setError(e.message||'Arquivo indisponível.');}
 };
 const totals=Object.values(stats).reduce((acc,m)=>({
   attempts:acc.attempts+m.total_attempts,
   contact:acc.contact+m.decision_conversations,
   interest:acc.interest+m.interested,
 }),{attempts:0,contact:0,interest:0});
 return <section className="rounded-xl border border-violet-200 bg-white p-4 sm:p-5" aria-label="Experimentos de scripts comerciais">
   <header className="flex flex-wrap items-start justify-between gap-3">
     <div><h3 className="text-lg font-black text-slate-900">Scripts e fluxos de abordagem</h3>
       <p className="mt-1 text-xs text-slate-600">Compare versões por interesse real. Registros antigos sem atribuição permanecem sem fluxo.</p>
     </div>
     <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-xs font-semibold">Fechar scripts</button>
   </header>
   {(error||notice)&&<p role={error?'alert':'status'} className={'mt-3 rounded-lg p-3 text-xs '+(error?'bg-red-50 text-red-700':'bg-green-50 text-green-800')}>{error||notice}</p>}
   <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
     <div className="space-y-3 rounded-xl bg-slate-50 p-4">
       <h4 className="text-sm font-black">Cadastrar versão de fluxo</h4>
       <label className="block text-xs font-bold">Nome do fluxo
         <input value={name} maxLength={120} onChange={e=>{setName(e.target.value);resetKey();}} placeholder="Ex.: Diagnóstico consultivo"
           className="mt-1 w-full rounded-lg border bg-white p-2.5 text-sm"/></label>
       <label className="block text-xs font-bold">Versão
         <input value={versionLabel} maxLength={40} onChange={e=>{setVersionLabel(e.target.value);resetKey();}}
           className="mt-1 w-full rounded-lg border bg-white p-2.5 text-sm"/></label>
       <label className="block text-xs font-bold">Tipo de material
         <select value={kind} onChange={e=>{setKind(e.target.value as 'text'|'url'|'file');resetKey();}}
           className="mt-1 w-full rounded-lg border bg-white p-2.5 text-sm">
           <option value="text">Texto manual</option>
           <option value="url">Link de mapa mental ou site</option>
           <option value="file">Arquivo / imagem (privado)</option>
         </select>
       </label>
       {kind==='text'&&<label className="block text-xs font-bold">Etapas e conteúdo do script
         <textarea rows={7} maxLength={20000} value={sourceText}
           onChange={e=>{setSourceText(e.target.value);resetKey();}}
           placeholder="Escreva a abertura, perguntas, objeções e próximos passos..."
           className="mt-1 w-full rounded-lg border bg-white p-2.5 text-sm"/></label>}
       {kind==='url'&&<label className="block text-xs font-bold">URL do material
         <input type="url" maxLength={2000} value={sourceUrl} onChange={e=>{setSourceUrl(e.target.value);resetKey();}}
           placeholder="https://..." className="mt-1 w-full rounded-lg border bg-white p-2.5 text-sm"/></label>}
       {kind==='file'&&<label className="block text-xs font-bold">PDF, DOCX, TXT ou imagem (até 4 MB)
         <input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp" onChange={e=>{setFile(e.target.files?.[0]||null);resetKey();}}
           className="mt-1 block w-full rounded-lg border bg-white p-2 text-xs"/></label>}
       <p className="text-[11px] text-slate-500">Uma versão criada não substitui outra. Você pode manter várias vigentes e desativá-las sem apagar resultados.</p>
       <button type="button" disabled={busy} onClick={()=>void create()}
         className="w-full rounded-lg bg-violet-700 px-3 py-3 text-sm font-bold text-white disabled:opacity-40">{busy?'Salvando...':'Salvar nova versão'}</button>
     </div>
     <div className="min-w-0">
       <div className="flex flex-wrap items-center justify-between gap-2">
         <h4 className="text-sm font-black">Comparativo de resultados</h4>
         <select aria-label="Período da análise" value={days} onChange={e=>setDays(Number(e.target.value))}
           className="rounded-lg border p-2 text-xs">
           <option value={0}>Todo o histórico</option><option value={30}>30 dias</option>
           <option value={90}>90 dias</option><option value={365}>365 dias</option>
         </select>
       </div>
       <p className="mt-2 text-xs text-slate-600">Contato = conversas ÷ tentativas. Interesse = interessados ÷ conversas com decisor. O interesse mede a qualidade da abordagem; o não atendimento mede a dificuldade de contato.</p>
       {loading?<p className="mt-4 text-sm">Carregando versões...</p>:versions.length===0?
         <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-slate-600">Nenhum fluxo cadastrado. Cadastre a primeira versão para começar a comparação.</p>:
         <div className="mt-3 space-y-3">
           {versions.map(s=>{
             const m=stats[s.id]||{total_attempts:0,no_answer:0,not_interested:0,interested:0,decision_conversations:0,interested_leads:0};
             return <article key={s.id} className="rounded-lg border border-slate-200 p-3">
               <div className="flex flex-wrap items-center justify-between gap-2">
                 <div><strong className="text-sm">{nameVersion(s)}</strong>
                   <p className="text-[11px] text-slate-500">{s.is_active?'Vigente':'Encerrado'} · {s.source_kind==='text'?'Texto':s.source_kind==='url'?'Link':'Arquivo'}</p>
                 </div>
                 <button type="button" disabled={busy} onClick={()=>void changeStatus(s)}
                   className={'rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40 '+(s.is_active?'border border-rose-200 text-rose-700':'bg-emerald-600 text-white')}>
                   {s.is_active?'Desativar':'Ativar'}
                 </button>
               </div>
               <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                 {[
                   ['Tentativas',fmt(m.total_attempts)],
                   ['Não atendidos',fmt(m.no_answer)],
                   ['Desinteresse',fmt(m.not_interested)],
                   ['Interesse',fmt(m.interested)],
                   ['Taxa contato',pct(m.decision_conversations,m.total_attempts)],
                   ['Taxa interesse',pct(m.interested,m.decision_conversations)],
                   ['Decisores',fmt(m.decision_conversations)],
                   ['Leads interessados',fmt(m.interested_leads)],
                 ].map(([label,value])=><div key={label} className="rounded-lg bg-slate-50 p-2">
                   <span className="block text-[10px] text-slate-500">{label}</span>
                   <strong className="text-sm text-slate-900">{value}</strong></div>)}
               </div>
               <div className="mt-3 text-xs">
                 {s.source_kind==='text'?<details><summary className="cursor-pointer font-bold text-violet-700">Ver texto do fluxo</summary>
                   <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans">{s.source_text}</pre></details>
                   :s.source_kind==='url'?
                   <a href={s.source_url||'#'} target="_blank" rel="noopener noreferrer"
                     className="font-bold text-violet-700 underline">Abrir mapa mental / site externo</a>
                   :<button type="button" className="font-bold text-violet-700 underline"
                     onClick={()=>void openFile(s.id)}>Abrir arquivo privado: {s.file_name}</button>}
               </div>
             </article>;
           })}
         </div>}
       <p className="mt-3 text-xs text-slate-500">{fmt(totals.attempts)} tentativas atribuídas · {fmt(totals.contact)} conversas · {fmt(totals.interest)} interessados. Não incluem históricos sem fluxo.</p>
     </div>
   </div>
 </section>;
}
