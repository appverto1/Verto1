import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Minimize2, Send, X } from 'lucide-react';
import type { HelpArticle } from '../help/helpManifest';
import { findSupportTopics, pausedSupportQuery, supportCategory } from '../help/helpSupport';

type Message={text:string;user?:boolean};
export function HelpSupportChat({articles,contextKey,onOpenTopic,onContextChanged}:{
  articles:HelpArticle[];contextKey:string;onOpenTopic:(articleId:string)=>void;onContextChanged:()=>void;
}){
  const [open,setOpen]=useState(false),[category,setCategory]=useState(''),[query,setQuery]=useState('');
  const [minimized,setMinimized]=useState(false);
  const [messages,setMessages]=useState<Message[]>([{text:'Qual funcionalidade você deseja entender? Escolha um assunto e me diga sua dúvida em poucas palavras.'}]);
  const [matches,setMatches]=useState<HelpArticle[]>([]),[target,setTarget]=useState<HelpArticle|null>(null);
  const [followUp,setFollowUp]=useState(false),[busy,setBusy]=useState(false),[openedAt,setOpenedAt]=useState(0);
  const [pendingLink,setPendingLink]=useState(false);
  const tail=useRef<HTMLDivElement>(null),request=useRef(0);
  const categories=Array.from(new Set(articles.filter(a=>a.contentRevision).map(supportCategory)));
  useEffect(()=>()=>{request.current++;},[]);
  useEffect(()=>{tail.current?.scrollIntoView({block:'nearest'});},[messages,matches,followUp]);
  useEffect(()=>{
    if(!open||!openedAt||!target)return;
    const timer=window.setTimeout(()=>{
      setMessages(old=>[...old,{text:'Conseguiu resolver sua dúvida?'}]);setFollowUp(true);setOpenedAt(0);
    },Math.max(0,60000-(Date.now()-openedAt)));
    return()=>window.clearTimeout(timer);
  },[open,openedAt,target]);
  const close=()=>{request.current++;setBusy(false);setOpen(false);setOpenedAt(0);setFollowUp(false);setTarget(null);setMatches([]);setPendingLink(false);setMessages([{text:'Qual funcionalidade você deseja entender? Escolha um assunto e me diga sua dúvida em poucas palavras.'}]);};
  const search=(event:React.FormEvent)=>{
    event.preventDefault();const text=query.trim();if(!text||busy)return;
    request.current++;setFollowUp(false);setOpenedAt(0);setTarget(null);setPendingLink(false);
    const found=findSupportTopics(articles,text,category);setMatches(found);setQuery('');
    setMessages([{text,user:true},{text:pausedSupportQuery(text)
      ? 'O tutorial desse assunto está em preparação. Tente descrever outra tarefa disponível; esta parte será incluída quando estiver pronta.'
      :found.length?'Encontrei estes tópicos. Abra o que corresponde à sua dúvida.':'Não encontrei um tópico correspondente. Escolha outro assunto ou descreva a ação com mais detalhes.'}]);
  };
  const openTopic=(article:HelpArticle,retry=false)=>{
    request.current++;setTarget(article);setMatches([]);setPendingLink(false);onOpenTopic(article.articleId);
    if(window.matchMedia('(max-width: 640px)').matches)setMinimized(true);
    if(retry){setFollowUp(true);return;}
    setFollowUp(false);setOpenedAt(Date.now());
    setMessages(old=>[...old,{text:`Abra “${article.title}” e consulte as instruções. Você pode continuar conversando por aqui.`}]);
  };
  const stillNeedHelp=async()=>{
    if(!target||busy)return;const token=++request.current;setBusy(true);
    try{
      const response=await fetch('/api/help/support',{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({articleId:target.articleId,contentRevision:target.contentRevision,contextKey})});
      const payload=await response.json();if(token!==request.current)return;
      if(response.status===409||response.status===403||response.status===401||response.status===404||payload.contextKey&&payload.contextKey!==contextKey){onContextChanged();return;}
      if(!response.ok){
        setMessages(old=>[...old,{text:payload.error==='HELP_SUPPORT_CONTACT_NOT_CONFIGURED'
          ?'Você concluiu esse tópico. O contato de suporte ainda está sendo configurado. Tente novamente mais tarde.'
          :'Não consegui conferir sua conclusão agora. Tente novamente.'}]);return;
      }
      setMessages(old=>[...old,{text:'Ainda preciso de ajuda.',user:true},{text:payload.message}]);
      setPendingLink(!payload.completed);setFollowUp(!payload.completed);
    }catch{if(token===request.current)setMessages(old=>[...old,{text:'Não consegui conferir sua conclusão agora. Tente novamente.'}]);}
    finally{if(token===request.current)setBusy(false);}
  };
  return <div className="fixed bottom-4 right-4 z-50">
    {open&&!minimized?<section aria-label="Chat de ajuda" className="flex max-h-[min(640px,85dvh)] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-xl">
      <header className="flex items-center gap-1 bg-violet-600 px-3 py-2 text-white"><h2 className="min-w-0 flex-1 text-sm font-semibold">Ainda precisa de ajuda?</h2><button onClick={()=>setMinimized(true)} className="min-h-11 min-w-11" aria-label="Minimizar conversa"><Minimize2 className="mx-auto" size={18}/></button><button onClick={close} className="min-h-11 min-w-11" aria-label="Fechar chat"><X className="mx-auto" size={18}/></button></header>
      <div className="space-y-3 overflow-y-auto p-4 text-sm">
        <p className="text-xs text-slate-500">Use nomes de funcionalidades. Evite dados pessoais ou clínicos nesta conversa.</p>
        <label className="block font-medium" htmlFor="help-support-category">Assunto</label>
        <select id="help-support-category" value={category} onChange={event=>{setCategory(event.target.value);setMatches([]);}} className="min-h-11 w-full rounded-xl border border-slate-200 px-2"><option value="">Todos os assuntos disponíveis</option>{categories.map(item=><option key={item}>{item}</option>)}</select>
        <div role="log" aria-live="polite" aria-relevant="additions" className="space-y-2">{messages.map((message,index)=><p key={index} className={`whitespace-pre-wrap rounded-xl p-3 ${message.user?'ml-6 bg-violet-50 text-violet-900':'mr-2 bg-slate-50 text-slate-700'}`}>{message.text}</p>)}</div>
        {matches.map(article=><button key={article.articleId} onClick={()=>openTopic(article)} className="min-h-11 w-full rounded-xl border border-violet-200 p-3 text-left text-violet-700"><span className="block font-medium">{article.title}</span><span className="text-xs">Abrir tutorial</span></button>)}
        {pendingLink&&target&&<button onClick={()=>openTopic(target,true)} className="min-h-11 rounded-xl border border-violet-200 px-3 text-violet-700">Voltar ao tópico e marcar Concluído</button>}
        {followUp&&<div className="flex flex-wrap gap-2"><button disabled={busy} onClick={()=>{setFollowUp(false);setPendingLink(false);setMessages(old=>[...old,{text:'Sim, consegui.',user:true},{text:'Ótimo. Você pode fechar o chat quando quiser.'}]);}} className="min-h-11 rounded-xl border border-slate-200 px-3">Sim</button><button disabled={busy} onClick={()=>void stillNeedHelp()} className="min-h-11 rounded-xl bg-violet-600 px-3 text-white disabled:opacity-50">{busy?'Conferindo…':'Ainda preciso de ajuda'}</button></div>}
        <div ref={tail}/>
      </div>
      <form onSubmit={search} className="flex gap-2 border-t border-slate-100 p-3"><label className="sr-only" htmlFor="help-support-query">Descreva sua dúvida</label><input id="help-support-query" value={query} onChange={event=>setQuery(event.target.value)} maxLength={300} placeholder="O que você quer aprender?" className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3"/><button disabled={busy||!query.trim()} type="submit" aria-label="Buscar orientação" className="min-h-11 min-w-11 rounded-xl bg-violet-600 text-white disabled:opacity-50"><Send className="mx-auto" size={18}/></button></form>
    </section>:<button onClick={()=>{setOpen(true);setMinimized(false);}} className="flex min-h-12 items-center gap-2 rounded-full bg-violet-600 px-5 py-3 font-medium text-white shadow-lg"><MessageCircle size={20}/>{open?(followUp?'Ajuda · Conseguiu resolver?':'Voltar à conversa'):'Ainda precisa de ajuda?'}</button>}
  </div>;
}
