import React, {useCallback, useEffect, useRef, useState} from 'react';
import {kanbanVirtualWindow} from '../utils/kanbanVirtualWindow';

type Item = {id:string};
type Props<T extends Item> = {
  items: readonly T[];
  columnTitle: string;
  renderCard: (item:T)=>React.ReactNode;
};

const ESTIMATED_ROW_PX=388; // includes the existing 8px card gap
const VIRTUALIZE_AT=30;

/**
 * Window the actual DOM, not just its paint. Uses page scrolling rather than
 * introducing an inner scrollbar, so column DnD and existing layout stay intact.
 * The original card JSX and all its handlers are provided untouched by caller.
 */
export function WindowedKanbanCards<T extends Item>({items,columnTitle,renderCard}:Props<T>){
  const enabled=items.length>=VIRTUALIZE_AT;
  const nodeRef=useRef<HTMLDivElement|null>(null);
  const measuredRef=useRef<Map<string,number>>(new Map());
  const draggingRef=useRef(false);
  const rafRef=useRef<number|null>(null);
  const scheduleRef=useRef<()=>void>(()=>{});
  const [windowRange,setWindowRange]=useState({start:0,end:18});
  const [focusIndex,setFocusIndex]=useState<number|null>(null);
  const ids=items.map(item=>item.id).join('|');

  // The latest item order and viewport geometry are read on demand. Scrolling
  // only changes React state when the bounded visible range actually changes.
  scheduleRef.current=()=>{
    if(rafRef.current!==null||draggingRef.current||!enabled)return;
    rafRef.current=requestAnimationFrame(()=>{
      rafRef.current=null;
      const el=nodeRef.current;
      if(!el)return;
      const rect=el.getBoundingClientRect();
      const sizes=items.map(item=>measuredRef.current.get(item.id)??ESTIMATED_ROW_PX);
      const view=kanbanVirtualWindow(sizes,Math.max(0,-rect.top),
        Math.max(0,window.innerHeight-rect.top));
      setWindowRange(old=>old.start===view.start&&old.end===view.end
        ?old:{start:view.start,end:view.end});
    });
  };

  useEffect(()=>{
    if(!enabled)return;
    const schedule=()=>scheduleRef.current();
    // Capture is important when the clinic portal scrolls a nested container.
    document.addEventListener('scroll',schedule,true);
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule);
    const stopDrag=()=>{draggingRef.current=false;schedule();};
    document.addEventListener('drop',stopDrag);
    document.addEventListener('dragend',stopDrag);
    schedule();
    return ()=>{
      document.removeEventListener('scroll',schedule,true);
      window.removeEventListener('scroll',schedule);
      window.removeEventListener('resize',schedule);
      document.removeEventListener('drop',stopDrag);
      document.removeEventListener('dragend',stopDrag);
      if(rafRef.current!==null)cancelAnimationFrame(rafRef.current);
      rafRef.current=null;
    };
  },[enabled,ids]);

  const measure=useCallback((id:string,height:number)=>{
    if(height<=0||!Number.isFinite(height))return;
    if(Math.abs((measuredRef.current.get(id)??ESTIMATED_ROW_PX)-height)<2)return;
    measuredRef.current.set(id,height);
    scheduleRef.current();
  },[]);

  // Accessible alternative to pointer scrolling: the next/previous controls
  // focus the next card and scroll the document's existing scroll container.
  const jumpTo=(index:number)=>{
    if(index<0||index>=items.length)return;
    const sizes=items.map(item=>measuredRef.current.get(item.id)??ESTIMATED_ROW_PX);
    const before=sizes.slice(0,index).reduce((sum,h)=>sum+h,0);
    const next=kanbanVirtualWindow(sizes,before,before+window.innerHeight,0);
    setWindowRange({start:next.start,end:next.end});
    setFocusIndex(index);
  };
  useEffect(()=>{
    if(focusIndex===null)return;
    const node=nodeRef.current?.querySelector('[data-kanban-index="'+focusIndex+'"] button');
    if(node instanceof HTMLElement){
      node.scrollIntoView({block:'nearest',inline:'nearest'});
      node.focus({preventScroll:true});
      setFocusIndex(null);
    }
  },[focusIndex,windowRange]);

  if(!enabled)return <div className="space-y-2">{items.map(item=>
    <React.Fragment key={item.id}>{renderCard(item)}</React.Fragment>)}</div>;

  const start=Math.min(windowRange.start,items.length-1);
  const end=Math.min(items.length,Math.max(start+1,windowRange.end));
  const sizes=items.map(item=>measuredRef.current.get(item.id)??ESTIMATED_ROW_PX);
  const before=sizes.slice(0,start).reduce((sum,h)=>sum+h,0);
  const after=sizes.slice(end).reduce((sum,h)=>sum+h,0);

  return <div ref={nodeRef} role="list" aria-label={'Cards da coluna '+columnTitle}
    onDragStartCapture={()=>{draggingRef.current=true;}}>
    {start>0&&<button type="button" className="mb-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-violet-700"
      onClick={()=>jumpTo(start-1)} aria-label={'Ver cards anteriores da coluna '+columnTitle}>
      Cards anteriores
    </button>}
    {before>0&&<div aria-hidden="true" style={{height:before}}/>}
    {items.slice(start,end).map((item,index)=>{
      const absoluteIndex=start+index;
      return <MeasuredRow key={item.id} itemId={item.id} index={absoluteIndex}
        count={items.length} onMeasure={measure}>
        {renderCard(item)}
      </MeasuredRow>;
    })}
    {after>0&&<div aria-hidden="true" style={{height:after}}/>}
    {end<items.length&&<button type="button" className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-violet-700"
      onClick={()=>jumpTo(end)} aria-label={'Ver próximos cards da coluna '+columnTitle}>
      Próximos cards ({end} de {items.length})
    </button>}
  </div>;
}

function MeasuredRow({itemId,index,count,onMeasure,children}:{
  itemId:string;index:number;count:number;
  onMeasure:(id:string,height:number)=>void;
  children:React.ReactNode;
}){
  const ref=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    const measure=()=>onMeasure(itemId,el.getBoundingClientRect().height);
    measure();
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
    observer?.observe(el);
    return ()=>observer?.disconnect();
  },[itemId,onMeasure]);
  return <div ref={ref} role="listitem" data-kanban-index={index}
    aria-posinset={index+1} aria-setsize={count} className="pb-2">
    {children}
  </div>;
}
