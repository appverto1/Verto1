import React, { useEffect, useRef, useState } from 'react';
import type { HelpArticle } from '../help/helpManifest';

export function HelpTutorialArticle({article,contextKey,completed,onSaved,onContextChanged}:{
  article:HelpArticle;contextKey:string;completed:boolean;onSaved:(completedAt:string|null)=>void;onContextChanged:()=>void;
}){
  const [index,setIndex]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[imageError,setImageError]=useState(false);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const current=article.tutorialSteps?.[index];
  if(!current)return null;
  const save=async()=>{
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/help/tutorial-progress',{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({articleId:article.articleId,contentRevision:article.contentRevision,contextKey,completed:!completed})});
      const payload=await response.json();
      if(!alive.current)return;
      if(response.status===409||response.status===401||response.status===403||response.status===404||payload.contextKey&&payload.contextKey!==contextKey){onContextChanged();return;}
      if(!response.ok)throw new Error('save');
      onSaved(payload.completedAt||null);
    }catch{if(alive.current)setError('Não foi possível salvar sua conclusão. Tente novamente.');}
    finally{if(alive.current)setBusy(false);}
  };
  const changeStep=(next:number)=>{setIndex(next);setImageError(false);};
  return <section className="mt-6" aria-label="Passo a passo do tutorial">
    <p className="text-xs font-medium text-violet-600">Passo {index+1} de {article.tutorialSteps!.length}</p>
    <h3 className="mt-2 font-semibold">{current.label}</h3><p className="mt-2 text-sm leading-6 text-slate-700">{current.instruction}</p>
    {!imageError?<div className="relative mt-4 overflow-hidden rounded-xl border border-slate-200">
      <img key={current.mediaId} src={`/api/help/tutorial-media/${encodeURIComponent(current.mediaId)}`} width={1363} height={936} alt={current.label} decoding="async" onError={()=>setImageError(true)} className="block h-auto w-full"/>
      <span aria-hidden="true" className="pointer-events-none absolute rounded-[50%] border-[3px] border-red-600" style={{left:`${current.rect[0]/1363*100}%`,top:`${current.rect[1]/936*100}%`,width:`${current.rect[2]/1363*100}%`,height:`${current.rect[3]/936*100}%`}}/>
    </div>:<p role="status" className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">O print não pôde ser carregado. Você pode seguir pela instrução acima.</p>}
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button disabled={index===0} onClick={()=>changeStep(index-1)} className="min-h-11 rounded-xl border border-slate-200 px-4 disabled:opacity-40">Anterior</button>
      <button disabled={index===article.tutorialSteps!.length-1} onClick={()=>changeStep(index+1)} className="min-h-11 rounded-xl border border-slate-200 px-4 disabled:opacity-40">Próximo</button>
      <button disabled={busy} onClick={()=>void save()} className={`min-h-11 rounded-xl px-4 font-medium disabled:opacity-50 ${completed?'bg-emerald-50 text-emerald-700':'bg-violet-600 text-white'}`}>{busy?'Salvando…':completed?'Concluído · desfazer':'Marcar como Concluído'}</button>
    </div>
    <p className="mt-2 text-xs text-slate-500">Marque Concluído quando tiver consultado este tópico. Você pode rever os passos a qualquer momento.</p>
    {error&&<p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
  </section>;
}
