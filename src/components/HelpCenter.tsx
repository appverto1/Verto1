import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Menu, Search, X } from 'lucide-react';
import type { HelpArticle } from '../help/helpManifest';
import { HelpSupportChat } from './HelpSupportChat';
import { HelpTutorialArticle } from './HelpTutorialArticle';
import { pausedSupportQuery } from '../help/helpSupport';

type Topic = HelpArticle;

const HELP_ROUTE_ALLOWLIST: Readonly<Record<string,string>> = Object.freeze({
  billing_workspace: '/',
});

const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const tokens=(v:string)=>normalize(v).split(/\s+/).filter(Boolean);
const scoreTopic=(topic:Topic,query:string)=>{
  const qs=tokens(query); if(!qs.length)return 1;
  const title=normalize(topic.title), theme=normalize(topic.theme), summary=normalize(topic.summary), body=normalize((topic.steps||[]).join(' '));
  const curated=normalize([...(topic.keywords||[]),...(topic.synonyms||[])].join(' '));
  return qs.reduce((score,q)=>{
    if(title===q) return score+100;
    if(title.includes(q)) return score+40;
    if(curated.split(/\s+/).some(k=>k===q)) return score+25;
    if(theme.includes(q)) return score+12;
    if(summary.includes(q)) return score+6;
    if(body.includes(q)) return score+4;
    if(q.length>=4 && [title,curated,body].some(v=>v.split(/\s+/).some(word=>word.startsWith(q)||q.startsWith(word)))) return score+3;
    return score;
  },0);
};

const excerpt=(value:string)=>{
  const text=String(value||'').trim();
  return text.length>150?`${text.slice(0,147)}…`:text;
};

export function HelpCenter({ clinicName, onClose }:{clinicName:string;onClose:()=>void}) {
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState('');
  const [drawer,setDrawer]=useState(false);
  const [topics,setTopics]=React.useState<Topic[]>([]);
  const [loading,setLoading]=React.useState(true);
  const [error,setError]=React.useState('');
  const [contextClinicId,setContextClinicId]=React.useState('');
  const [contextKey,setContextKey]=useState('');
  const [progress,setProgress]=useState<Record<string,string|null>>({});
  const [contextLabel,setContextLabel]=React.useState(clinicName);
  const [ctaBusy,setCtaBusy]=React.useState(false);
  const [ctaError,setCtaError]=React.useState('');
  const requestRef=useRef(0);
  const drawerButtonRef=useRef<HTMLButtonElement>(null);
  const drawerRef=useRef<HTMLElement>(null);

  const loadCatalog=React.useCallback(async()=>{
    const request=++requestRef.current;
    setLoading(true);
    setError('');
    setTopics([]);
    setSelected('');
    setContextClinicId('');
    setContextKey('');setProgress({});
    try{
      const response=await fetch('/api/help/catalog',{credentials:'include',cache:'no-store'});
      if(!response.ok)throw new Error('catalog');
      const payload=await response.json();
      if(request!==requestRef.current)return;
      const nextClinicId=String(payload?.clinicId||'').trim();
      if(!nextClinicId)throw new Error('context');
      setContextClinicId(nextClinicId);
      setContextKey(String(payload?.contextKey||''));
      setContextLabel(String(payload?.clinicName||'Clínica atual'));
      setTopics(Array.isArray(payload?.articles)?payload.articles:[]);
      setProgress(Object.fromEntries((Array.isArray(payload?.progress)?payload.progress:[]).map((row:any)=>[`${row.articleId}:${row.contentRevision}`,row.completedAt||null])));
      const requested=new URLSearchParams(window.location.search).get('topico')||'';
      setSelected((payload.articles||[]).some((topic:any)=>topic.articleId===requested)?requested:'');
    }catch{
      if(request!==requestRef.current)return;
      setTopics([]);
      setSelected('');
      setContextClinicId('');
      setContextKey('');setProgress({});
      setError('Não foi possível carregar a ajuda agora.');
    }finally{
      if(request===requestRef.current)setLoading(false);
    }
  },[]);

  React.useEffect(()=>{
    void loadCatalog();
    const refresh=()=>{if(document.visibilityState==='visible')void loadCatalog();};
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{
      requestRef.current++;
      window.removeEventListener('focus',refresh);
      document.removeEventListener('visibilitychange',refresh);
    };
  },[loadCatalog]);

  React.useEffect(()=>{
    if(!drawer)return;
    const previous=document.activeElement as HTMLElement|null;
    const close=()=>{setDrawer(false);requestAnimationFrame(()=>drawerButtonRef.current?.focus());};
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}};
    document.addEventListener('keydown',onKey);
    requestAnimationFrame(()=>drawerRef.current?.querySelector<HTMLElement>('button')?.focus());
    return()=>{
      document.removeEventListener('keydown',onKey);
      if(previous&&previous!==document.body)previous.focus();
    };
  },[drawer]);

  const filtered=useMemo(
    ()=>pausedSupportQuery(query)?[]:topics
      .map(topic=>({topic,score:scoreTopic(topic,query)}))
      .filter(x=>x.score>0)
      .sort((a,b)=>b.score-a.score||a.topic.title.localeCompare(b.topic.title,'pt-BR'))
      .map(x=>x.topic),
    [query,topics],
  );
  const article=topics.find(t=>t.articleId===selected) || filtered[0];
  const selectTopic=(id:string)=>{setSelected(id);setDrawer(false);window.history.replaceState(null,'',`/ajuda?topico=${encodeURIComponent(id)}`);};
  const related=(article?.relatedArticleIds||[])
    .map(id=>topics.find(topic=>topic.articleId===id))
    .filter((topic):topic is Topic=>Boolean(topic));

  const openArticleArea=React.useCallback(async(topic:Topic)=>{
    const routeKey=String(topic.routeKey||'').trim();
    const target=HELP_ROUTE_ALLOWLIST[routeKey];
    const expectedClinicId=contextClinicId;
    if(!target||!expectedClinicId)return;
    setCtaBusy(true);
    setCtaError('');
    try{
      const response=await fetch('/api/help/catalog',{credentials:'include',cache:'no-store'});
      if(!response.ok)throw new Error('catalog');
      const payload=await response.json();
      const nextClinicId=String(payload?.clinicId||'').trim();
      const projected=Array.isArray(payload?.articles)?payload.articles:[];
      const stillAuthorized=projected.some((candidate:any)=>
        String(candidate?.articleId||'')===topic.articleId && String(candidate?.routeKey||'')===routeKey,
      );
      if(nextClinicId!==expectedClinicId||!stillAuthorized){
        setCtaError('Seu contexto ou suas permissões mudaram. Atualizamos a Central antes de continuar.');
        await loadCatalog();
        return;
      }
      window.location.assign(target);
    }catch{
      setCtaError('Não foi possível revalidar o acesso agora. Tente novamente.');
    }finally{
      setCtaBusy(false);
    }
  },[contextClinicId,loadCatalog]);

  const resultAnnouncement=loading
    ? 'Atualizando resultados da ajuda.'
    : `${filtered.length} ${filtered.length===1?'resultado encontrado':'resultados encontrados'}.`;

  return <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3">
        <button type="button" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200" aria-label="Voltar à Verto"><ArrowLeft size={18}/></button>
        <BookOpen size={22} className="text-violet-600"/>
        <div className="min-w-0 flex-1"><h1 className="font-semibold">Ajuda e tutoriais</h1><p className="truncate text-xs text-slate-500">Contexto: {contextClinicId?contextLabel:'Atualizando contexto…'}</p></div>
        <button ref={drawerButtonRef} type="button" onClick={()=>setDrawer(v=>!v)} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 lg:hidden" aria-label={drawer?'Fechar temas':'Abrir temas'} aria-expanded={drawer}>{drawer?<X size={18}/>:<Menu size={18}/>}</button>
      </div>
    </header>
    <main className="mx-auto max-w-[1500px] px-4 py-5">
      <div className="mb-5 relative">
        <Search className="absolute left-3 top-3.5 text-slate-400" size={18}/>
        <label className="sr-only" htmlFor="help-search">Buscar ajuda</label>
        <input id="help-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Busque uma tarefa, por exemplo: trocar clínica" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 outline-none focus:ring-2 focus:ring-violet-500"/>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{resultAnnouncement}</p>
      </div>
      <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6">
        <aside ref={drawerRef} className={`${drawer?'block':'hidden'} mb-4 rounded-2xl border border-slate-200 bg-white p-2 lg:sticky lg:top-24 lg:block lg:self-start`} aria-label="Temas de ajuda">
          {loading?<p className="p-3 text-sm text-slate-500" role="status">Carregando ajuda…</p>:error?<div className="p-3 text-sm text-rose-700" role="alert"><p>{error}</p><button type="button" onClick={()=>void loadCatalog()} className="mt-2 min-h-11 font-semibold underline">Tentar novamente</button></div>:filtered.length?filtered.map(t=><button key={t.articleId} type="button" onClick={()=>selectTopic(t.articleId)} className={`mb-1 min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm ${article?.articleId===t.articleId?'bg-violet-50 font-semibold text-violet-700':'text-slate-700 hover:bg-slate-50'}`}><span className="block text-xs text-slate-400">{t.theme}</span><span className="block">{t.title}{progress[`${t.articleId}:${t.contentRevision}`]&&<span className="ml-1 text-xs text-emerald-700">✓ Concluído</span>}</span><span className="mt-1 block text-xs font-normal leading-4 text-slate-500">{excerpt(t.summary)}</span></button>):<p className="p-3 text-sm text-slate-500" role="status">Nenhum tutorial encontrado. Tente outro termo.</p>}
        </aside>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
          {article?<>
            <nav aria-label="Caminho do artigo" className="text-xs text-slate-500"><span>Ajuda</span><span aria-hidden="true"> / </span><span>{article.theme}</span><span aria-hidden="true"> / </span><span className="text-slate-700">{article.title}</span></nav>
            <p className="mt-4 text-sm font-medium text-violet-600">{article.theme}</p>
            <h2 className="mt-1 text-2xl font-semibold">{article.title}</h2>
            <p className="mt-3 text-slate-600">{article.summary}</p>

            {article.tutorialSteps?<React.Fragment key={`${contextKey}:${article.articleId}:${article.contentRevision}`}><HelpTutorialArticle article={article} contextKey={contextKey} completed={Boolean(progress[`${article.articleId}:${article.contentRevision}`])} onContextChanged={()=>void loadCatalog()} onSaved={completedAt=>setProgress(old=>({...old,[`${article.articleId}:${article.contentRevision}`]:completedAt}))}/></React.Fragment>:<>
            <section className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4" aria-labelledby="help-prerequisites">
              <h3 id="help-prerequisites" className="font-semibold">Para quem e pré-requisitos</h3>
              <p className="mt-2 text-sm text-slate-600">{article.audienceLabel||'Profissionais autorizados no contexto atual.'}</p>
              {(article.prerequisites||[]).length>0&&<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{article.prerequisites?.map(item=><li key={item}>{item}</li>)}</ul>}
            </section>
            <h3 className="mt-6 font-semibold">Passo a passo</h3>
            <ol className="mt-3 space-y-3">{article.steps.map((s,i)=><li key={s} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">{i+1}</span><span className="pt-1 text-sm text-slate-700">{s}</span></li>)}</ol>

            <section className="mt-6" aria-labelledby="help-expected-result">
              <h3 id="help-expected-result" className="font-semibold">Resultado esperado</h3>
              <p className="mt-2 text-sm text-slate-600">{article.expectedResult||'Concluir a tarefa descrita mantendo o contexto da clínica ativa.'}</p>
            </section>

            <section className="mt-6" aria-labelledby="help-recovery">
              <h3 id="help-recovery" className="font-semibold">Problemas e recuperação</h3>
              {(article.recovery||[]).length>0?<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{article.recovery?.map(item=><li key={item}>{item}</li>)}</ul>:<p className="mt-2 text-sm text-slate-600">Se algo não corresponder à tela atual, confirme a clínica ativa e atualize a Central.</p>}
            </section>

            <section className="mt-6" aria-labelledby="help-related">
              <h3 id="help-related" className="font-semibold">Artigos relacionados</h3>
              {related.length?<div className="mt-2 flex flex-wrap gap-2">{related.map(item=><button key={item.articleId} type="button" onClick={()=>setSelected(item.articleId)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-violet-700 hover:bg-violet-50">{item.title}</button>)}</div>:<p className="mt-2 text-sm text-slate-500">Nenhum artigo relacionado publicado nesta coorte.</p>}
            </section>
            </>}

            {article.routeKey&&HELP_ROUTE_ALLOWLIST[article.routeKey]&&<div className="mt-7">
              <button type="button" disabled={ctaBusy||!contextClinicId} onClick={()=>void openArticleArea(article)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60">{ctaBusy?'Validando acesso…':'Abrir esta área na Verto'}<ArrowUpRight size={17} aria-hidden="true"/></button>
              {ctaError&&<p className="mt-2 text-sm text-rose-700" role="alert">{ctaError}</p>}
            </div>}

            {!article.tutorialSteps&&<div className="mt-7 rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><strong>Conteúdo visual:</strong> prints e microvídeos serão exibidos aqui somente após revisão em ambiente sintético seguro. O passo a passo textual permanece completo sem a mídia.</div>}
          </>:<p role="status">Escolha um tema para começar.</p>}
        </article>
      </div>
    </main>
    {contextKey&&!loading&&<React.Fragment key={contextKey}><HelpSupportChat articles={topics} contextKey={contextKey} onOpenTopic={selectTopic} onContextChanged={()=>void loadCatalog()}/></React.Fragment>}
  </div>;
}
