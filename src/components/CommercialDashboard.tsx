import React, { useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { BarChart3, Clock3, RefreshCw, TrendingUp, Users, X, ChevronRight } from 'lucide-react';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';
import { getSupabase } from '../lib/supabase';
import { SALES_LEAD_STATUS_LABELS } from '../constants/salesCommercial';

export type CommercialAttempt = {
  id: string; lead_id: string; channel: 'phone' | 'whatsapp_call' | 'whatsapp_message';
  outcome: 'no_decisor' | 'decisor_spoken'; occurred_at: string;
  script_version_id?: string | null;
  contact_result?: 'no_answer' | 'interested' | 'not_interested' | null;
};
type DrilldownSelection={
  dimension:'stage'|'overview'|'daily'|'cumulative'|'hour'|'weekday'|'channel'|'attempt';
  value:string;measure:'leads'|'calls'|'conversations'|'failures'|'messages'|'attempted';
  label:string;expected?:number;
};
type ChartLead={
  id:string;name:string|null;clinic_name:string|null;phone:string|null;email:string|null;
  status:string;created_at:string|null;updated_at:string|null;matched_at?:string|null;
  matching_events:number;converted_clinic_id?:string|null;converted_user_id?:string|null;
};
type DrilldownResults={totalLeads:number;matchingEvents:number;items:ChartLead[];offset:number;limit:number};
type NumberPoint = { calls: number; conversations: number };
type Analytics = {
  days: number;
  overview: {
    totalLeads: number; attemptedLeads: number; contactedLeads: number; totalCalls: number;
    callContactedLeads?: number; messageContacts?: number;
    successfulCalls: number; convertedLeads: number; lostLeads: number;
  };
  daily: (NumberPoint & { day: string })[];
  hours: (NumberPoint & { hour: number })[];
  weekdays: (NumberPoint & { weekday: number })[];
  channels: (NumberPoint & { channel: string })[];
  attempts: (NumberPoint & { attempt: number })[];
  stages: { status: string; leads: number }[];
};
const percent = (numerator: number, denominator: number) =>
  denominator ? (numerator * 100 / denominator).toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%' : '—';
const n = (value: number) => Number(value || 0).toLocaleString('pt-BR');
const WEEKDAYS = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const COLORS = ['#7951e7','#1f7be3','#12a590','#f59e0b','#e05a78','#5972a6','#c084fc'];
const channelLabel = (channel: string) => channel === 'phone' ? 'Operadora' : 'Ligação WhatsApp';

const Plot = ({ children, height=290 }: { children:React.ReactNode; height?:number }) =>
  <div className="min-w-0" style={{height,minHeight:height}}>
    <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={height}>
      {children as React.ReactElement}
    </SafeResponsiveContainer>
  </div>;
const Empty = () => <div className="flex h-[290px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm font-medium text-slate-400">
  Registre ligações para visualizar o gráfico.
</div>;
const Panel = ({title,subtitle,children}: {title:string;subtitle:string;children:React.ReactNode}) =>
  <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <h3 className="text-sm font-black text-slate-900">{title}</h3><p className="mb-4 mt-1 text-xs text-slate-500">{subtitle}</p>
    {children}
  </section>;
const Axes = () => <>
  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
</>;

export const CommercialDashboard = () => {
  const [days,setDays] = useState(90);
  const [refresh,setRefresh] = useState(0);
  const [data,setData] = useState<Analytics|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string|null>(null);
  const [drilldown,setDrilldown]=useState<DrilldownSelection|null>(null);
  const [drilldownOffset,setDrilldownOffset]=useState(0);
  const [drilldownData,setDrilldownData]=useState<DrilldownResults|null>(null);
  const [drilldownLoading,setDrilldownLoading]=useState(false);
  const [drilldownError,setDrilldownError]=useState<string|null>(null);
  const showLeads=(dimension:DrilldownSelection['dimension'],value:string,
    measure:DrilldownSelection['measure'],label:string,expected?:number)=>{
    if(!value)return;
    setDrilldown({dimension,value,measure,label,expected});
    setDrilldownOffset(0);
    setDrilldownData(null);
    setDrilldownError(null);
  };
  useEffect(()=>{
    if(!drilldown)return;
    let live=true;
    setDrilldownLoading(true);setDrilldownError(null);
    void (async()=>{try{
      const client=await getSupabase();
      const {data:{session}}=await client.auth.getSession();
      const query=new URLSearchParams({
        days:String(days),dimension:drilldown.dimension,value:drilldown.value,
        measure:drilldown.measure,offset:String(drilldownOffset),
      });
      const response=await fetch('/api/owner/sales/prospecting/analytics/drilldown?'+query,{
        credentials:'include',headers:{Authorization:session?.access_token?'Bearer '+session.access_token:''},
      });
      const json=await response.json().catch(()=>({}));
      if(!response.ok||!json.success)throw Error(json.error||'Não foi possível localizar os leads.');
      if(live)setDrilldownData(json.data);
    }catch(e:any){if(live)setDrilldownError(e.message||'Detalhamento indisponível.');}
    finally{if(live)setDrilldownLoading(false);}})();
    return()=>{live=false;};
  },[drilldown,drilldownOffset,days,refresh]);
  useEffect(()=>{
    let active = true;
    setLoading(true);setError(null);
    void (async()=>{
      try {
        const client = await getSupabase();
        const {data:{session}} = await client.auth.getSession();
        const response = await fetch('/api/owner/sales/prospecting/analytics?days='+days,{
          credentials:'include',headers:{Authorization:session?.access_token?'Bearer '+session.access_token:''}
        });
        const json = await response.json().catch(()=>({}));
        if(!response.ok||!json.success)throw Error(json.error||'Não foi possível consultar o dashboard.');
        if(active)setData(json.data);
      }catch(e:any){if(active)setError(e.message||'Gráficos indisponíveis.');}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;};
  },[days,refresh]);

  const daily=useMemo(()=>{
    let calls=0,conversations=0;
    return (data?.daily||[]).map(point=>{
      calls+=point.calls;conversations+=point.conversations;
      return {...point,date:point.day,day:point.day.slice(5),rate: Number((100*conversations/Math.max(calls,1)).toFixed(1))};
    });
  },[data]);
  const hours=useMemo(()=>Array.from({length:24},(_,i)=>{
    const row=data?.hours?.find(x=>Number(x.hour)===i);
    return {hour:String(i).padStart(2,'0')+'h',hourValue:String(i),calls:row?.calls||0,conversations:row?.conversations||0,
      rate:row?.calls ? Number((100*row.conversations/row.calls).toFixed(1)) : 0};
  }),[data]);
  const weekdays=useMemo(()=>WEEKDAYS.map((name,i)=>{
    const row=data?.weekdays?.find(x=>Number(x.weekday)===i+1);
    return {weekday:name,weekdayValue:String(i+1),calls:row?.calls||0,conversations:row?.conversations||0,
      rate:row?.calls ? Number((100*row.conversations/row.calls).toFixed(1)):0};
  }),[data]);
  const channels=useMemo(()=>['phone','whatsapp_call'].map(channel=>{
    const row=data?.channels?.find(x=>x.channel===channel);
    return {channel:channelLabel(channel),channelValue:channel,calls:row?.calls||0,conversations:row?.conversations||0,
      failures:(row?.calls||0)-(row?.conversations||0),
      rate:row?.calls ? Number((100*row.conversations/row.calls).toFixed(1)):0};
  }),[data]);
  const stages=useMemo(()=>(data?.stages||[]).map(x=>({
    stage:SALES_LEAD_STATUS_LABELS[x.status as keyof typeof SALES_LEAD_STATUS_LABELS]||x.status,
    status:x.status,leads:x.leads,
  })).sort((a,b)=>b.leads-a.leads),[data]);
  const attemptSequence=useMemo(()=>Array.from({length:10},(_,i)=>{
    const row=data?.attempts?.find(x=>Number(x.attempt)===i+1);
    return {attempt:(i+1)+'ª',attemptValue:String(i+1),calls:row?.calls||0,conversations:row?.conversations||0,
      rate:row?.calls ? Number((100*row.conversations/row.calls).toFixed(1)):0};
  }),[data]);
  const hasCalls=Boolean(data?.overview?.totalCalls);
  const overview=data?.overview;
  const bestHour=hours.filter(x=>x.calls>0).sort((a,b)=>b.rate-a.rate||b.calls-a.calls)[0];
  const bestDay=weekdays.filter(x=>x.calls>0).sort((a,b)=>b.rate-a.rate||b.calls-a.calls)[0];
  const cards:Array<{title:string;value:string;detail:string;dimension:DrilldownSelection['dimension'];
    group:string;measure:DrilldownSelection['measure'];expected:number}>=[
    {title:'Leads na base',value:n(overview?.totalLeads||0),detail:'Todos os leads não excluídos',dimension:'overview',group:'all',measure:'leads',expected:overview?.totalLeads||0},
    {title:'Leads abordados',value:n(overview?.attemptedLeads||0),detail:'Pelo menos uma ligação no período',dimension:'overview',group:'attempted',measure:'attempted',expected:overview?.attemptedLeads||0},
    {title:'Ligações realizadas',value:n(overview?.totalCalls||0),detail:'Operadora + chamada de WhatsApp',dimension:'overview',group:'calls',measure:'calls',expected:overview?.totalCalls||0},
    {title:'Decisores contatados',value:n(overview?.contactedLeads||0),detail:'Ligações e mensagens efetivas',dimension:'overview',group:'contacted',measure:'conversations',expected:overview?.contactedLeads||0},
    {title:'Por mensagem WhatsApp',value:n(overview?.messageContacts||0),detail:'Conversas efetivas por texto, sem virar ligação',dimension:'overview',group:'messages',measure:'messages',expected:overview?.messageContacts||0},
    {title:'Taxa de contato por ligação',value:percent(overview?.callContactedLeads??overview?.contactedLeads??0,overview?.attemptedLeads||0),detail:'Leads contatados por ligação',dimension:'overview',group:'call_contacted',measure:'conversations',expected:overview?.callContactedLeads||0},
    {title:'Efetividade por ligação',value:percent(overview?.successfulCalls||0,overview?.totalCalls||0),detail:'Conversas / ligações registradas',dimension:'overview',group:'call_contacted',measure:'conversations',expected:overview?.successfulCalls||0},
  ];
  return (
    <div className="space-y-6" aria-label="Inteligência e gráficos comerciais">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#141C34] p-5 text-white">
        <div><p className="text-xs font-bold uppercase tracking-[.16em] text-violet-300">Business intelligence · Verto</p>
          <h2 className="mt-1 text-2xl font-black">Inteligência comercial</h2>
          <p className="mt-1 text-xs text-slate-300">Indicadores reais agregados no banco, não limitados aos cards carregados no Kanban.</p></div>
        <div className="flex items-center gap-2">
          <select aria-label="Período de análise comercial" value={days} onChange={e=>setDays(Number(e.target.value))}
            className="rounded-lg border border-white/20 bg-slate-800 px-3 py-2 text-xs font-bold text-white">
            <option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option><option value={365}>Últimos 365 dias</option>
          </select>
          <button onClick={()=>setRefresh(v=>v+1)} className="flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-900"><RefreshCw size={14}/> Atualizar</button>
        </div>
      </div>
      <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-800">
        <b>Regra de sucesso:</b> uma conversa efetiva com o decisor pode ocorrer por ligação ou mensagem WhatsApp.
        Envio ou leitura sem resposta do decisor, tentativas sem atendimento e conversas com recepcionistas não contam como contato efetivo.
        Mensagens não entram nos indicadores de quantidade e efetividade das ligações.
        Horários em Brasília. As métricas de atividade respeitam o período selecionado; totais de leads e estados são atuais.
      </div>
      {loading&&<div role="status" className="rounded-xl bg-white p-5 text-sm text-slate-500">Atualizando inteligência comercial…</div>}
      {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {data&&<div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
          {cards.map((item,index)=><button key={item.title} type="button"
            aria-label={'Ver leads de '+item.title}
            onClick={()=>showLeads(item.dimension,item.group,item.measure,item.title,item.expected)}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-violet-500">
            <div className="mb-3 flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-500">{item.title}</span>
              {index<3?<BarChart3 size={16} className="text-violet-400"/>:index<5?<Users size={16} className="text-blue-500"/>:<TrendingUp size={16} className="text-emerald-500"/>}</div>
            <strong className="block text-2xl font-black tabular-nums text-slate-900">{item.value}</strong>
            <p className="mt-2 text-[10px] text-slate-500">{item.detail}</p>
            <p className="mt-2 text-[10px] font-bold text-violet-700">Ver leads <ChevronRight size={12} className="inline"/></p>
          </button>)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"><Clock3 className="text-violet-500"/>
            <div><span className="text-[11px] text-slate-500">Melhor horário registrado</span><p className="text-lg font-black">{bestHour?bestHour.hour:'Sem dados'}</p><p className="text-[11px] text-slate-500">{bestHour?percent(bestHour.conversations,bestHour.calls)+' de contatos':'Aguardando histórico'}</p></div></div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"><BarChart3 className="text-blue-500"/>
            <div><span className="text-[11px] text-slate-500">Melhor dia da semana</span><p className="text-lg font-black">{bestDay?bestDay.weekday:'Sem dados'}</p><p className="text-[11px] text-slate-500">{bestDay?percent(bestDay.conversations,bestDay.calls)+' de contatos':'Aguardando histórico'}</p></div></div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"><TrendingUp className="text-emerald-500"/>
            <div><span className="text-[11px] text-slate-500">Conversão da base em clientes</span><p className="text-lg font-black">{percent(overview.convertedLeads,overview.totalLeads)}</p><p className="text-[11px] text-slate-500">{n(overview.convertedLeads)} clientes · pagamento confirmado</p></div></div>
        </div>

        <div><h3 className="mb-3 text-base font-black text-slate-900">01 · Volume e evolução</h3>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Atividade comercial diária" subtitle="Ligações realizadas e conversas efetivas por dia.">
              {hasCalls?<Plot><AreaChart data={daily} margin={{top:5,right:10,bottom:5,left:-20}}><Axes/>
                <XAxis dataKey="day" tick={{fontSize:10}}/><YAxis allowDecimals={false} tick={{fontSize:10}}/>
                <Tooltip/><Legend/><Area type="monotone" dataKey="calls" name="Ligações" stroke="#7951e7" fill="#7951e7" fillOpacity={.17}/>
                <Area type="monotone" dataKey="conversations" name="Conversas com decisor" stroke="#0FA896" fill="#0FA896" fillOpacity={.22}/></AreaChart></Plot>:<Empty/>}
            </Panel>
            <Panel title="Taxa de contato acumulada" subtitle="Evolução da eficiência ao longo dos dias registrados.">
              {hasCalls?<Plot><LineChart data={daily} margin={{top:5,right:12,bottom:5,left:-25}}><Axes/>
                <XAxis dataKey="day" tick={{fontSize:10}}/><YAxis unit="%" domain={[0,100]} tick={{fontSize:10}}/>
                <Tooltip/><Line dataKey="rate" name="Taxa acumulada %" stroke="#1f7be3" strokeWidth={3} dot={{r:3}}/></LineChart></Plot>:<Empty/>}
            </Panel>
          </div>
        </div>

        <div><h3 className="mb-3 text-base font-black text-slate-900">02 · Quando ligar?</h3>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Distribuição por hora do dia" subtitle="Picos de tentativas e atendimento · Brasília (00h a 23h).">
              {hasCalls?<Plot><BarChart data={hours} margin={{top:5,right:12,bottom:5,left:-24}}><Axes/>
                <XAxis dataKey="hour" tick={{fontSize:9}} interval={2}/><YAxis allowDecimals={false} tick={{fontSize:10}}/>
                <Tooltip/><Legend/><Bar name="Ligações" dataKey="calls" fill="#7951e7" radius={[4,4,0,0]}/>
                <Bar name="Conversas" dataKey="conversations" fill="#0FA896" radius={[4,4,0,0]}/></BarChart></Plot>:<Empty/>}
            </Panel>
            <Panel title="Eficiência por faixa horária" subtitle="Porcentagem de ligações que chegaram ao decisor em cada horário.">
              {hasCalls?<Plot><LineChart data={hours} margin={{top:5,right:12,bottom:5,left:-20}}><Axes/>
                <XAxis dataKey="hour" tick={{fontSize:9}} interval={2}/><YAxis domain={[0,100]} unit="%" tick={{fontSize:10}}/>
                <Tooltip/><Line name="Contato %" dataKey="rate" type="monotone" stroke="#0FA896" strokeWidth={3} dot={false}/></LineChart></Plot>:<Empty/>}
            </Panel>
            <Panel title="Volume por dia da semana" subtitle="Ligações e conversas conforme o dia de realização.">
              {hasCalls?<Plot><BarChart data={weekdays} margin={{top:5,right:12,bottom:5,left:-20}}><Axes/>
                <XAxis dataKey="weekday" tick={{fontSize:10}}/><YAxis allowDecimals={false} tick={{fontSize:10}}/>
                <Tooltip/><Legend/><Bar dataKey="calls" name="Ligações" fill="#1f7be3" radius={[4,4,0,0]}/>
                <Bar dataKey="conversations" name="Conversas" fill="#12a590" radius={[4,4,0,0]}/></BarChart></Plot>:<Empty/>}
            </Panel>
            <Panel title="Taxa de contato por dia" subtitle="Taxa de conversas por ligações feitas no respectivo dia.">
              {hasCalls?<Plot><BarChart data={weekdays} margin={{top:5,right:12,bottom:5,left:-20}}><Axes/>
                <XAxis dataKey="weekday" tick={{fontSize:10}}/><YAxis domain={[0,100]} unit="%" tick={{fontSize:10}}/>
                <Tooltip/><Bar name="Taxa de contato %" dataKey="rate" fill="#12a590" radius={[6,6,0,0]}/></BarChart></Plot>:<Empty/>}
            </Panel>
          </div>
        </div>

        <div><h3 className="mb-3 text-base font-black text-slate-900">03 · Canais e cadência</h3>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Comparativo de canais" subtitle="Conversas efetivas vs. ligações que não chegaram ao decisor.">
              {hasCalls?<Plot><BarChart layout="vertical" data={channels} margin={{top:5,right:12,bottom:5,left:4}}><Axes/>
                <XAxis type="number" allowDecimals={false} tick={{fontSize:10}}/><YAxis type="category" dataKey="channel" width={116} tick={{fontSize:10}}/>
                <Tooltip/><Legend/><Bar stackId="a" name="Conversas" dataKey="conversations" fill="#12a590"/>
                <Bar stackId="a" name="Sem contato" dataKey="failures" fill="#d0d6e5" radius={[5,5,5,5]}/></BarChart></Plot>:<Empty/>}
            </Panel>
            <Panel title="Participação por canal" subtitle="Distribuição percentual das ligações registradas.">
              {hasCalls?<Plot><PieChart><Pie data={channels} dataKey="calls" nameKey="channel" innerRadius={62} outerRadius={105}
                paddingAngle={3} label={({percent}:any)=>((percent||0)*100).toFixed(1)+'%'}>
                {channels.map((_,i)=><Cell key={i} fill={COLORS[i]}/>)}</Pie>
                <Tooltip/><Legend/></PieChart></Plot>:<Empty/>}
            </Panel>
            <Panel title="Em qual tentativa houve contato?" subtitle="Ordem cronológica da 1ª até a 10ª ligação por lead no período.">
              {hasCalls?<Plot><BarChart data={attemptSequence} margin={{top:5,right:12,bottom:5,left:-20}}><Axes/>
                <XAxis dataKey="attempt" tick={{fontSize:10}}/><YAxis allowDecimals={false} tick={{fontSize:10}}/>
                <Tooltip/><Bar dataKey="conversations" name="Primeiro contato efetivo" fill="#7951e7" radius={[5,5,0,0]}/></BarChart></Plot>:<Empty/>}
            </Panel>
            <Panel title="Eficiência em cada tentativa" subtitle="Taxa de sucesso em cada posição da cadência 5+5.">
              {hasCalls?<Plot><LineChart data={attemptSequence} margin={{top:5,right:12,bottom:5,left:-20}}><Axes/>
                <XAxis dataKey="attempt" tick={{fontSize:10}}/><YAxis domain={[0,100]} unit="%" tick={{fontSize:10}}/>
                <Tooltip/><Line dataKey="rate" name="Taxa %" stroke="#e05a78" strokeWidth={3} dot={{r:4}}/></LineChart></Plot>:<Empty/>}
            </Panel>
          </div>
        </div>

        <div><h3 className="mb-3 text-base font-black text-slate-900">04 · Funil e resultados comerciais</h3>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Distribuição da base por etapa" subtitle="Todos os leads não excluídos, independentemente do período das ligações.">
              {stages.length?<Plot height={320}><BarChart data={stages} layout="vertical" margin={{top:5,right:12,bottom:5,left:0}}><Axes/>
                <XAxis type="number" allowDecimals={false} tick={{fontSize:10}}/><YAxis type="category" dataKey="stage" width={150} tick={{fontSize:10}}/>
                <Tooltip/><Bar dataKey="leads" name="Leads" fill="#7951e7" radius={[0,5,5,0]}/></BarChart></Plot>:<Empty/>}
            </Panel>
            <Panel title="Composição do pipeline" subtitle="Participação de cada status no total de leads da Verto.">
              {stages.length?<Plot height={320}><PieChart><Pie data={stages} dataKey="leads" nameKey="stage" innerRadius={54} outerRadius={95}
                paddingAngle={2}>{stages.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></Plot>:<Empty/>}
            </Panel>
          </div>
        </div>
        <p className="text-xs text-slate-500">Fonte: agregações no Supabase Staging. Nenhum dado de receita foi presumido; clientes convertidos dependem de confirmação de pagamento.</p>
      </div>}
    </div>
  );
};
