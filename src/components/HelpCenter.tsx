import React, { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Menu, Search, X } from 'lucide-react';

type Topic = { id:string; theme:string; title:string; summary:string; keywords:string[]; steps:string[] };
const TOPICS: Topic[] = [
 {id:'faturamento-inicio',theme:'Convênios e faturamento',title:'Comece no faturamento da clínica',summary:'Entenda onde localizar pré-guias, conferência, lotes XML, convênios e atualizações.',keywords:['tiss','faturamento','guia','xml','convenio'],steps:['Confirme a clínica ativa no topo da tela.','Use o menu lateral para escolher a tarefa desejada.','Antes de enviar ou alterar dados, confira o contexto e o convênio selecionados.']},
 {id:'trocar-clinica',theme:'Comece aqui',title:'Trocar de clínica com segurança',summary:'Mude de unidade sem misturar informações entre clínicas.',keywords:['clinica','unidade','trocar','acesso'],steps:['Selecione “Trocar unidade” no topo quando houver mais de uma clínica.','Escolha o contexto profissional desejado.','Confirme o nome da clínica ativa antes de continuar.']},
 {id:'atualizacoes',theme:'Convênios e faturamento',title:'Acompanhar atualizações do faturamento',summary:'Consulte comunicações e assuntos da unidade ativa.',keywords:['atualizacoes','mensagens','mencoes','comunicacao'],steps:['Abra “Atualizações” no menu do faturamento.','Selecione o assunto que deseja acompanhar.','Confira a clínica ativa antes de responder ou criar um assunto.']}
];
const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function HelpCenter({ clinicName, onClose }:{clinicName:string;onClose:()=>void}) {
 const [query,setQuery]=useState(''); const [selected,setSelected]=useState(TOPICS[0].id); const [drawer,setDrawer]=useState(false);
 const filtered=useMemo(()=>{const q=normalize(query); if(!q)return TOPICS; return TOPICS.filter(t=>normalize([t.title,t.summary,t.theme,...t.keywords].join(' ')).includes(q));},[query]);
 const article=TOPICS.find(t=>t.id===selected) || filtered[0];
 return <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
  <header className="sticky top-0 z-40 border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3">
   <button type="button" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200" aria-label="Voltar à Verto"><ArrowLeft size={18}/></button>
   <BookOpen size={22} className="text-violet-600"/><div className="min-w-0 flex-1"><h1 className="font-semibold">Ajuda e tutoriais</h1><p className="truncate text-xs text-slate-500">Contexto: {clinicName}</p></div>
   <button type="button" onClick={()=>setDrawer(v=>!v)} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 lg:hidden" aria-label={drawer?'Fechar temas':'Abrir temas'} aria-expanded={drawer}>{drawer?<X size={18}/>:<Menu size={18}/>}</button>
  </div></header>
  <main className="mx-auto max-w-[1500px] px-4 py-5"><div className="mb-5 relative"><Search className="absolute left-3 top-3.5 text-slate-400" size={18}/><label className="sr-only" htmlFor="help-search">Buscar ajuda</label><input id="help-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Busque uma tarefa, por exemplo: trocar clínica" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 outline-none focus:ring-2 focus:ring-violet-500"/></div>
   <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6">
    <aside className={`${drawer?'block':'hidden'} mb-4 rounded-2xl border border-slate-200 bg-white p-2 lg:block`} aria-label="Temas de ajuda">
     {filtered.length?filtered.map(t=><button key={t.id} type="button" onClick={()=>{setSelected(t.id);setDrawer(false)}} className={`mb-1 min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm ${article?.id===t.id?'bg-violet-50 font-semibold text-violet-700':'text-slate-700 hover:bg-slate-50'}`}><span className="block text-xs text-slate-400">{t.theme}</span>{t.title}</button>):<p className="p-3 text-sm text-slate-500" role="status">Nenhum tutorial encontrado. Tente outro termo.</p>}
    </aside>
    <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">{article?<><p className="text-sm font-medium text-violet-600">{article.theme}</p><h2 className="mt-1 text-2xl font-semibold">{article.title}</h2><p className="mt-3 text-slate-600">{article.summary}</p><h3 className="mt-6 font-semibold">Passo a passo</h3><ol className="mt-3 space-y-3">{article.steps.map((s,i)=><li key={s} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">{i+1}</span><span className="pt-1 text-sm text-slate-700">{s}</span></li>)}</ol><div className="mt-7 rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><strong>Conteúdo visual:</strong> prints e microvídeos serão exibidos aqui somente após revisão em ambiente sintético seguro. O passo a passo textual permanece completo sem a mídia.</div></>:<p role="status">Escolha um tema para começar.</p>}</article>
   </div>
  </main>
 </div>;
}
