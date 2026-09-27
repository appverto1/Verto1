import React, { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Menu, Search, X } from 'lucide-react';

type Topic = { articleId:string; slug:string; theme:string; title:string; summary:string; keywords:string[]; steps:string[] };
const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function HelpCenter({ clinicName, onClose }:{clinicName:string;onClose:()=>void}) {
 const [query,setQuery]=useState(''); const [selected,setSelected]=useState(''); const [drawer,setDrawer]=useState(false);
 const [topics,setTopics]=React.useState<Topic[]>([]); const [loading,setLoading]=React.useState(true); const [error,setError]=React.useState('');
 const loadCatalog=React.useCallback(async()=>{setLoading(true);setError('');try{const response=await fetch('/api/help/catalog',{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('catalog');const payload=await response.json();setTopics(Array.isArray(payload?.articles)?payload.articles:[]);}catch{setTopics([]);setError('Não foi possível carregar a ajuda agora.');}finally{setLoading(false);}},[]);
 React.useEffect(()=>{void loadCatalog();},[loadCatalog]);
 const filtered=useMemo(()=>{const q=normalize(query); if(!q)return topics; return topics.filter(t=>normalize([t.title,t.summary,t.theme,...(t.keywords||[])].join(' ')).includes(q));},[query,topics]);
 const article=topics.find(t=>t.articleId===selected) || filtered[0];
 return <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
  <header className="sticky top-0 z-40 border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3">
   <button type="button" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200" aria-label="Voltar à Verto"><ArrowLeft size={18}/></button>
   <BookOpen size={22} className="text-violet-600"/><div className="min-w-0 flex-1"><h1 className="font-semibold">Ajuda e tutoriais</h1><p className="truncate text-xs text-slate-500">Contexto: {clinicName}</p></div>
   <button type="button" onClick={()=>setDrawer(v=>!v)} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 lg:hidden" aria-label={drawer?'Fechar temas':'Abrir temas'} aria-expanded={drawer}>{drawer?<X size={18}/>:<Menu size={18}/>}</button>
  </div></header>
  <main className="mx-auto max-w-[1500px] px-4 py-5"><div className="mb-5 relative"><Search className="absolute left-3 top-3.5 text-slate-400" size={18}/><label className="sr-only" htmlFor="help-search">Buscar ajuda</label><input id="help-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Busque uma tarefa, por exemplo: trocar clínica" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 outline-none focus:ring-2 focus:ring-violet-500"/></div>
   <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6">
    <aside className={`${drawer?'block':'hidden'} mb-4 rounded-2xl border border-slate-200 bg-white p-2 lg:block`} aria-label="Temas de ajuda">
     {loading?<p className="p-3 text-sm text-slate-500" role="status">Carregando ajuda…</p>:error?<div className="p-3 text-sm text-rose-700" role="alert"><p>{error}</p><button type="button" onClick={()=>void loadCatalog()} className="mt-2 min-h-11 font-semibold underline">Tentar novamente</button></div>:filtered.length?filtered.map(t=><button key={t.articleId} type="button" onClick={()=>{setSelected(t.articleId);setDrawer(false)}} className={`mb-1 min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm ${article?.articleId===t.articleId?'bg-violet-50 font-semibold text-violet-700':'text-slate-700 hover:bg-slate-50'}`}><span className="block text-xs text-slate-400">{t.theme}</span>{t.title}</button>):<p className="p-3 text-sm text-slate-500" role="status">Nenhum tutorial encontrado. Tente outro termo.</p>}
    </aside>
    <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">{article?<><p className="text-sm font-medium text-violet-600">{article.theme}</p><h2 className="mt-1 text-2xl font-semibold">{article.title}</h2><p className="mt-3 text-slate-600">{article.summary}</p><h3 className="mt-6 font-semibold">Passo a passo</h3><ol className="mt-3 space-y-3">{article.steps.map((s,i)=><li key={s} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">{i+1}</span><span className="pt-1 text-sm text-slate-700">{s}</span></li>)}</ol><div className="mt-7 rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><strong>Conteúdo visual:</strong> prints e microvídeos serão exibidos aqui somente após revisão em ambiente sintético seguro. O passo a passo textual permanece completo sem a mídia.</div></>:<p role="status">Escolha um tema para começar.</p>}</article>
   </div>
  </main>
 </div>;
}
