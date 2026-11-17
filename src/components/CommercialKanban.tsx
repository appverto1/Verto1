import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, GripVertical,
  FileText, MessageCircle, Pencil, Phone, Plus, RefreshCw, Search, Trash2, X,
} from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import type { CommercialAttempt } from './CommercialDashboard';
import { CommercialScriptsPanel } from './CommercialScriptsPanel';
import { CommercialAcquisitionPanel } from './CommercialAcquisitionPanel';
import { nextSalesCadenceSlots } from '../utils/salesProspectingCadence';
import { compareSiteInterestProspecting } from '../utils/siteInterestPriority.mjs';
import { splitOpportunityPhones, previewOpportunityDuplicates, createManualOpportunities } from '../services/salesKanbanOpportunityCreation';
import { loadSalesProspectingHistory, moveSalesKanbanLead, persistSalesAttemptTime, persistSalesDecisorContact, persistSalesFollowup, persistSalesLoss } from '../services/salesKanbanActivity';
import { loadSalesKanbanAcquisitionBoard, persistSalesKanbanAcquisition, persistSalesKanbanAcquisitionBulk } from '../services/salesKanbanAcquisition';
import {
  agendaMatches,compareAgendaPriority,resolveAgendaMoment,
  brazilDateKey,followupBucket,followupFilters,matchesFollowup,isCallDueToday,progressColor,progressWidth,
  type AgendaMode,type AgendaSource,type AgendaMoment,type FollowupFilter,
} from '../utils/salesKanbanFollowupVisuals.mjs';
import { SALES_LEAD_STATUS_LABELS, type SalesLeadStatus } from '../constants/salesCommercial';

type Lead = {
  id: string; name?: string; email?: string; phone?: string; clinicName?: string; notes?: string;
  status: SalesLeadStatus; lostAt?: string | null; lossReasonId?:string|null; updatedAt?: string; createdAt?: string;
  legacyReadOnly?: boolean; siteInterestAt?: string | null;
};
type DuplicateMatch = {
  normalizedPhone:string|null; invalid:boolean; inBatch:boolean;
  existing:{id:string;name:string|null;phone:string|null;status:string}|null;
};
type Column = {
  id: string; slug: string; kind: string; title: string; color: string;
  position: number; is_system: boolean;
};
type Props = {
  leads: Lead[];
  onLeadPatch: (id: string, patch: Record<string, unknown>) => void;
  onLeadsCreated: (leads: Lead[]) => void;
  onPriorityLeadsLoaded: (leads: Lead[]) => void;
  onLeadDeleted: (id: string) => void;
  onOpenLead: (lead: Lead) => void;
  onRefresh: () => Promise<void>;
  onMetrics: () => void;
  onLoadMore: () => Promise<void>;
  remaining: number;
  loadingMore: boolean;
};
const DEFAULT_COLORS = ['#943B75','#1D65C1','#0F8478','#BD404D','#7650B5','#D97706','#0891B2','#4F46E5'];
const dateText = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short', timeZone:'America/Sao_Paulo' })
    : '—';
};
type SalesFollowup = {id:string;lead_id:string;contact_due_at:string;status:'scheduled'|'canceled'};
const brazilLocalInput=(iso:string)=>{
  const instant=new Date(iso);
  if(!Number.isFinite(instant.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(instant);
  const get=(kind:string)=>parts.find(part=>part.type===kind)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day')+'T'+get('hour')+':'+get('minute');
};
const brazilInputToIso=(local:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))throw Error('Informe data e hora válidas.');
  const parsed=new Date(local+':00-03:00');
  if(!Number.isFinite(parsed.getTime())||brazilLocalInput(parsed.toISOString())!==local)
    throw Error('Data ou horário inválido para Brasília.');
  return parsed.toISOString();
};
const isUuid = (s: string) => /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(s);
const stageFromStatus = (status: string) => {
  if (status === 'new') return 'prospecting';
  if (status === 'contact_started') return 'contact';
  if (status === 'lost' || status === 'archived') return 'lost';
  if (status === 'converted') return 'customers';
  return 'proposals';
};

export const CommercialKanban = ({ leads, onLeadPatch, onLeadsCreated, onPriorityLeadsLoaded, onLeadDeleted, onOpenLead, onRefresh, onMetrics, onLoadMore, remaining, loadingMore }: Props) => {
  const [columns, setColumns] = useState<Column[]>([]);
  const [placements, setPlacements] = useState<Record<string,string>>({});
  const [overrides, setOverrides] = useState<Record<string,{details:Partial<Lead>;hidden:boolean}>>({});
  const [attempts, setAttempts] = useState<CommercialAttempt[]>([]);
  const [scriptLabels,setScriptLabels]=useState<Array<{id:string;name:string;version_label:string;is_active:boolean}>>([]);
  const [scriptsOpen,setScriptsOpen]=useState(false);
  const [scriptCatalogUnavailable,setScriptCatalogUnavailable]=useState(false);
  const [acquisitionOpen,setAcquisitionOpen]=useState(false);
  const [acquisitionCatalogUnavailable,setAcquisitionCatalogUnavailable]=useState(false);
  const [acquisitionRefreshKey,setAcquisitionRefreshKey]=useState(0);
  const [acquisitionChannels,setAcquisitionChannels]=useState<Array<{id:string;name:string;is_active:boolean}>>([]);
  const [acquisitionByLead,setAcquisitionByLead]=useState<Record<string,string[]>>({});
  const [referralsByLead,setReferralsByLead]=useState<Record<string,{partnerName:string;couponCode:string|null;partnerCouponCode:string|null}>>({});
  const [acquisitionDialog,setAcquisitionDialog]=useState<{leadId:string;channelIds:string[]}|null>(null);
  const [savingAcquisition,setSavingAcquisition]=useState(false);
  const [inlineChannelIds,setInlineChannelIds]=useState<string[]>([]);
  const [selectedScriptId,setSelectedScriptId]=useState('');
  const [contactResult,setContactResult]=useState<'interested'|'not_interested'|''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notesPreviewId,setNotesPreviewId]=useState<string|null>(null);
  const [notesPreviewText,setNotesPreviewText]=useState('');
  const [notesPreviewLoading,setNotesPreviewLoading]=useState(false);
  const [notesPreviewError,setNotesPreviewError]=useState('');
  const [notesPreviewReload,setNotesPreviewReload]=useState(0);
  const [search, setSearch] = useState('');
  const [showStage, setShowStage] = useState('all');
  const [globalFollowupFilter,setGlobalFollowupFilter]=useState<FollowupFilter>('all');
  const [callTodayOnly,setCallTodayOnly]=useState(false);
  const [columnFollowupFilters,setColumnFollowupFilters]=useState<Record<string,FollowupFilter>>({});
  const [calendarToday,setCalendarToday]=useState(()=>brazilDateKey(new Date()));
  const [clockNow,setClockNow]=useState(()=>Date.now());
  const [agendaMode,setAgendaMode]=useState<AgendaMode>('all');
  const [agendaSource,setAgendaSource]=useState<AgendaSource>('all');
  const [agendaDate,setAgendaDate]=useState(()=>brazilDateKey(new Date()));
  const [agendaFrom,setAgendaFrom]=useState('');
  const [agendaTo,setAgendaTo]=useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftColor, setDraftColor] = useState('#943B75');
  const [busy, setBusy] = useState(false);
  const [busyLead, setBusyLead] = useState<string | null>(null);
  const [lossReasons,setLossReasons]=useState<Array<{id:string;name:string;is_active:boolean}>>([]);
  const [lossDialog,setLossDialog]=useState<{leadId:string}|null>(null);
  const [lossReasonDraft,setLossReasonDraft]=useState('');
  const [inlineLossName,setInlineLossName]=useState('');
  const [inlineLossBusy,setInlineLossBusy]=useState(false);
  const [inlineLossError,setInlineLossError]=useState<string|null>(null);
  const [lossCatalogUnavailable,setLossCatalogUnavailable]=useState(false);
  const [lossSettingsOpen,setLossSettingsOpen]=useState(false);
  const [lossSettingsBusy,setLossSettingsBusy]=useState(false);
  const [lossNameDraft,setLossNameDraft]=useState('');
  const [editingLossReasonId,setEditingLossReasonId]=useState<string|null>(null);
  const [lossActiveDraft,setLossActiveDraft]=useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyReady,setHistoryReady]=useState(false);
  const [revision, setRevision] = useState(0);
  const [spokenChannel, setSpokenChannel] = useState<CommercialAttempt['channel']>('phone');
  const [spokenAtDraft,setSpokenAtDraft]=useState('');
  const [attemptDialog,setAttemptDialog]=useState<{leadId:string;channel:'phone'|'whatsapp_call';attemptId?:string;localAt:string;scriptVersionId:string}|null>(null);
  const [editingSpokenId,setEditingSpokenId]=useState<string|null>(null);
  const [editingSpokenAt,setEditingSpokenAt]=useState('');
  const [followups,setFollowups]=useState<Record<string,SalesFollowup>>({});
  const [followupAtDraft,setFollowupAtDraft]=useState('');
  const [savingFollowup,setSavingFollowup]=useState(false);
  // Refresh the São Paulo calendar date on tab return; no background polling/requests.
  useEffect(()=>{
    const update=()=>{
      const now=Date.now();
      setClockNow(now);
      setCalendarToday(brazilDateKey(new Date(now)));
    };
    const onVisibility=()=>{if(!document.hidden)update();};
    const interval=window.setInterval(update,60000); // UI-only clock, no HTTP polling.
    window.addEventListener('focus',update);
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{
      window.clearInterval(interval);
      window.removeEventListener('focus',update);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[]);
  const [creatingOpen,setCreatingOpen] = useState(false);
  const [phonesDraft,setPhonesDraft] = useState('');
  const [firstCreationContact,setFirstCreationContact] = useState({name:'',clinicName:'',email:''});
  const [additionalCreationContacts,setAdditionalCreationContacts] = useState<Record<number,{name:string;clinicName:string;email:string}>>({});
  const [duplicateCheck,setDuplicateCheck] = useState<{draft:string;matches:DuplicateMatch[];error?:string}|null>(null);
  const [duplicateCheckRetry,setDuplicateCheckRetry] = useState(0);
  const [bulkSelectedRows,setBulkSelectedRows]=useState<number[]>([]);
  const [bulkChannelsToApply,setBulkChannelsToApply]=useState<string[]>([]);
  const [bulkChannelsByRow,setBulkChannelsByRow]=useState<Record<number,string[]>>({});
  const [cardFeedback,setCardFeedback]=useState<{leadId:string;info?:string;error?:string}|null>(null);
  const [bulkExistingMode,setBulkExistingMode]=useState(false);
  const [bulkExistingIds,setBulkExistingIds]=useState<string[]>([]);
  const [bulkExistingChannels,setBulkExistingChannels]=useState<string[]>([]);
  const [bulkExistingReplace,setBulkExistingReplace]=useState(false);
  const [bulkExistingBusy,setBulkExistingBusy]=useState(false);
  const [creatingBusy,setCreatingBusy] = useState(false);
  const [savingLead,setSavingLead] = useState(false);
  const [loadingLeadDetails,setLoadingLeadDetails] = useState(false);
  const [leadDetailsError,setLeadDetailsError]=useState(false);
  const [leadReload,setLeadReload]=useState(0);
  const [deletingLead,setDeletingLead] = useState(false);
  const [leadDraft,setLeadDraft] = useState({name:'',phone:'',clinicName:'',email:'',notes:''});
  const keysRef = useRef<Record<string,string>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState({ left:0, max:0 });
  const idsKey = useMemo(() => leads.filter(x => !x.legacyReadOnly && isUuid(x.id))
    .map(x => x.id).sort().join(','), [leads]);

  const refreshScripts=async()=>{
    const data=await request('/api/owner/sales/scripts/active');
    const versions:Array<{id:string;name:string;version_label:string;is_active:boolean}>=data.versions||[];
    setScriptLabels(versions);
    setScriptCatalogUnavailable(false);
    setSelectedScriptId(old=>{
      if(old&&versions.some(v=>v.id===old&&v.is_active))return old;
      const active=versions.filter(v=>v.is_active);
      return active.length===1?active[0].id:'';
    });
  };
  const scriptLabel=(id?:string|null)=>{
    if(!id)return 'Sem fluxo atribuído';
    const match=scriptLabels.find(x=>x.id===id);
    return match?match.name+' · '+match.version_label:'Versão histórica';
  };
  const activeScripts=scriptLabels.filter(v=>v.is_active);
  const scriptSelect=(value:string,onChange:(v:string)=>void,disabled=false)=>(
    <label className="block text-xs font-bold text-slate-700">Fluxo utilizado
      <select aria-label="Fluxo comercial utilizado" value={value} disabled={disabled}
        onChange={e=>onChange(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-violet-200 bg-white p-2.5 text-sm">
        {activeScripts.length===0?<option value="">Sem fluxo cadastrado</option>:<>
          <option value="">Selecione o fluxo usado</option>
          {activeScripts.map(v=><option key={v.id} value={v.id}>{v.name} · {v.version_label}</option>)}
        </>}
      </select>
    </label>
  );
  const refreshAcquisitionCatalog=async(channels?:Array<{id:string;name:string;is_active:boolean}>)=>{
    // The acquisition editor has just loaded this catalog: reuse it, no duplicate HTTP/DB read.
    if(channels){
      setAcquisitionChannels(channels);
      setAcquisitionCatalogUnavailable(false);
      return;
    }
    const result=await loadSalesKanbanAcquisitionBoard(request);
    setAcquisitionChannels(result.channels||[]);
    setAcquisitionCatalogUnavailable(false);
  };
  const acquisitionNames=(leadId:string)=>{
    const ids=acquisitionByLead[leadId]||[];
    return ids.map(id=>acquisitionChannels.find(x=>x.id===id)?.name||'Origem histórica');
  };
  const openAcquisitionEditor=(leadId:string)=>{
    if(savingAcquisition||acquisitionCatalogUnavailable){
      if(acquisitionCatalogUnavailable)cardError(leadId,'Canais indisponíveis. Atualize o quadro antes de editar as origens.');
      return;
    }
    setAcquisitionDialog({leadId,channelIds:[...(acquisitionByLead[leadId]||[])]});
    setError(null);
  };
  const saveAcquisition=async(dialog:{leadId:string;channelIds:string[]}|null=acquisitionDialog)=>{
    if(!dialog||savingAcquisition||acquisitionCatalogUnavailable)return;
    const keyName='acquisition:'+dialog.leadId;
    try{
      const key=keysRef.current[keyName]||crypto.randomUUID();
      keysRef.current[keyName]=key;
      setSavingAcquisition(true);setError(null);
      const result=await persistSalesKanbanAcquisition(request,dialog.leadId,key,dialog.channelIds);
      delete keysRef.current[keyName];
      setAcquisitionByLead(old=>({...old,[dialog.leadId]:result.selection.channelIds||[]}));
      setAcquisitionRefreshKey(k=>k+1);
      setAcquisitionDialog(null);
      cardInfo(dialog.leadId,'Canais de aquisição salvos sem atualizar a página.');
    }catch(e:any){cardError(dialog.leadId,e.message||'Não foi possível salvar os canais.');}
    finally{setSavingAcquisition(false);}
  };
  const request = async (url: string, init: RequestInit = {}) => {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(url, {
      ...init, credentials:'include',
      headers: {
        'Authorization': session?.access_token ? 'Bearer ' + session.access_token : '',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.success !== true) throw Error(json.error || 'Não foi possível concluir a operação.');
    return json;
  };

  useEffect(() => {
    let live = true;
    setLoading(true);
    setHistoryReady(false);
    const load = async () => {
      try {
        const ids = idsKey ? idsKey.split(',') : [];
        const chunks = ids.length ? Array.from({length:Math.ceil(ids.length/80)},(_,i)=>ids.slice(i*80,i*80+80)) : [[]];
        // Optional catalogs must never prevent the canonical board/history from loading.
        const lossPromise=request('/api/owner/sales/loss-reasons')
          .then(data=>({data,failed:false}))
          .catch(()=>({data:{reasons:[]},failed:true}));
        const scriptsPromise=request('/api/owner/sales/scripts/active')
          .then(data=>({data,failed:false}))
          .catch(()=>({data:{versions:[]},failed:true}));
        // In batches, support large lead volumes without a hard 100-ID request failure.
        const pages = await Promise.all(chunks.map(async (chunk, pageIndex) => {
          const q = encodeURIComponent(chunk.join(','));
          const [board,history,acquisitionResult] = await Promise.all([
            request('/api/owner/sales/kanban/board?leadIds='+q+(pageIndex===0?'&sitePriority=1':'')),
            chunk.length ? loadSalesProspectingHistory(request,q) : Promise.resolve({data:[],leads:[]}),
            loadSalesKanbanAcquisitionBoard(request,q)
              .then(data=>({data,failed:false}))
              .catch(()=>({data:{channels:[],links:[]},failed:true})),
          ]);
          return {board,history,acquisition:acquisitionResult.data,acquisitionFailed:acquisitionResult.failed};
        }));
        const [scriptResult,lossResult]=await Promise.all([scriptsPromise,lossPromise]);
        if (!live) return;
        setLossCatalogUnavailable(lossResult.failed);
        setLossReasons(lossResult.data.reasons||[]);
        setScriptCatalogUnavailable(scriptResult.failed);
        setAcquisitionCatalogUnavailable(pages.some(page=>page.acquisitionFailed));
        const versions=scriptResult.data.versions||[];
        setScriptLabels(versions);
        setSelectedScriptId(current=>{
          if(current&&versions.some((v:any)=>v.id===current&&v.is_active))return current;
          const active=versions.filter((v:any)=>v.is_active);
          return active.length===1?active[0].id:'';
        });
        setColumns(pages[0].board.columns || []);
        if (pages[0].board.priorityLeads?.length) onPriorityLeadsLoaded(pages[0].board.priorityLeads);
        const nextPlacements: Record<string,string> = {};
        const nextOverrides: Record<string,{details:Partial<Lead>;hidden:boolean}> = {};
        const dedup = new Map<string,CommercialAttempt>();
        const loadedFollowups:Record<string,SalesFollowup>={};
        const acquired:Record<string,string[]>={};
        const referred:Record<string,{partnerName:string;couponCode:string|null;partnerCouponCode:string|null}>={};
        for (const page of pages) {
          for (const item of page.board.placements || []) nextPlacements[item.lead_id] = item.column_id;
          for (const item of page.board.overrides || []) {
            nextOverrides[item.lead_id] = { details:item.details || {}, hidden:Boolean(item.hidden_at) };
          }
          for (const item of page.history.data || []) dedup.set(item.id,item);
          for (const followup of page.history.followups || []) loadedFollowups[followup.lead_id]=followup;
          for(const item of page.board.referrals||[]){
            if(item.leadId)referred[item.leadId]={
              partnerName:String(item.partnerName||'Parceiro'),
              couponCode:item.couponCode||null,
              partnerCouponCode:item.partnerCouponCode||null,
            };
          }
          for(const link of page.acquisition.links||[]){
            const arr=acquired[link.lead_id]||[];
            arr.push(link.channel_id);acquired[link.lead_id]=arr;
          }
          for (const item of page.history.leads || []) {
            // Only changed server facts cause an in-place patch; no F5 necessary.
            const local = leads.find(x => x.id === item.id);
            if (local && (local.status !== item.status || (local.lostAt || null) !== (item.lost_at || null) ||
              (local.lossReasonId||null)!==(item.loss_reason_id||null)))
              onLeadPatch(item.id,{status:item.status,lostAt:item.lost_at,lossReasonId:item.loss_reason_id});
          }
        }
        setAcquisitionChannels(pages[0]?.acquisition.channels||[]);
        setAcquisitionByLead(acquired);
        setReferralsByLead(referred);
        setAttempts([...dedup.values()]);
        setHistoryReady(true);
        setFollowups(loadedFollowups);
        setPlacements(nextPlacements);
        setOverrides(nextOverrides);
        setError(null);
      } catch (cause: any) { if (live) setError(cause.message || 'Falha ao carregar Kanban.'); }
      finally { if (live) setLoading(false); }
    };
    void load();
    return () => { live = false; };
  }, [idsKey,revision]);

  const countByLead = useMemo(() => {
    const map = new Map<string,{phone:number;whatsapp:number;spoken:boolean;spokenVia?:CommercialAttempt['channel']}>();
    for (const attempt of attempts) {
      const r = map.get(attempt.lead_id) || {phone:0,whatsapp:0,spoken:false,
        spokenVia:undefined as CommercialAttempt['channel']|undefined};
      // Text messages are contact outcomes, not phone attempts.
      if (attempt.channel === 'phone') r.phone++;
      else if (attempt.channel === 'whatsapp_call') r.whatsapp++;
      if (attempt.outcome === 'decisor_spoken') {
        r.spoken = true;
        r.spokenVia = attempt.channel;
      }
      map.set(attempt.lead_id,r);
    }
    return map;
  }, [attempts]);
  const leadCounts = (id: string) => countByLead.get(id) || {phone:0,whatsapp:0,spoken:false};
  const attemptsByLead=useMemo(()=>{
    const map=new Map<string,CommercialAttempt[]>();
    for(const attempt of attempts){
      const items=map.get(attempt.lead_id)||[];
      items.push(attempt);map.set(attempt.lead_id,items);
    }
    return map;
  },[attempts]);
  const leadAttemptDates=(id:string)=>attemptsByLead.get(id)||[];
  const slotLabel=(date:Date)=>date.toLocaleString('pt-BR',{
    timeZone:'America/Sao_Paulo',weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',
  });

  const columnFor = (lead: Lead) => {
    // Terminal status is authoritative; a stale custom placement cannot hide it.
    if (['lost','archived','converted'].includes(lead.status))
      return columns.find(c => c.slug === stageFromStatus(lead.status))?.id;
    return placements[lead.id] || columns.find(c => c.slug === stageFromStatus(lead.status))?.id;
  };
  const visibleLeads = useMemo(() => leads
    .filter(lead => !overrides[lead.id]?.hidden)
    .map(lead => ({...lead,...(overrides[lead.id]?.details || {})})), [leads,overrides]);
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('pt-BR');
    return visibleLeads.filter(lead => !lead.legacyReadOnly && isUuid(lead.id) &&
      (!q || [lead.name,lead.clinicName,lead.email,lead.phone].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(q))));
  }, [visibleLeads,search]);
  const selected = visibleLeads.find(x=>x.id === selectedId) || null;
  const bulkPhones=splitOpportunityPhones(phonesDraft);
  const checkedDuplicates=duplicateCheck?.draft===phonesDraft&&!duplicateCheck.error?duplicateCheck.matches:null;
  const blockedByDuplicate=Boolean(checkedDuplicates?.some(item=>item.invalid||item.inBatch||item.existing));
  useEffect(()=>{
    if(!creatingOpen||!bulkPhones.length||bulkPhones.length>100){
      setDuplicateCheck(null);return;
    }
    let active=true;
    setDuplicateCheck(null);
    const timer=window.setTimeout(()=>{
      void previewOpportunityDuplicates(request,phonesDraft).then(json=>{
        if(active)setDuplicateCheck({draft:phonesDraft,matches:json.matches||[]});
      }).catch((e:Error)=>{
        if(active)setDuplicateCheck({draft:phonesDraft,matches:[],error:e.message||'Verificação indisponível.'});
      });
    },350);
    return()=>{active=false;window.clearTimeout(timer);};
  },[creatingOpen,phonesDraft,duplicateCheckRetry]);

  const feedbackFor=(leadId:string)=>cardFeedback?.leadId===leadId?cardFeedback:null;
  const cardInfo=(leadId:string,info:string)=>setCardFeedback({leadId,info});
  const cardError=(leadId:string,error:string)=>setCardFeedback({leadId,error});
  const openCard=(leadId:string)=>{
    setError(null);setInfo(null);setCardFeedback(null);
    setLoadingLeadDetails(true);setLeadDetailsError(false);
    setInlineChannelIds([...(acquisitionByLead[leadId]||[])]);
    setSelectedId(leadId);
  };
  useEffect(()=>{
    if(!notesPreviewId){
      setNotesPreviewText('');setNotesPreviewLoading(false);setNotesPreviewError('');
      return;
    }
    // The board listing may omit notes. Load one authoritative record only on demand.
    let active=true;
    setNotesPreviewLoading(true);setNotesPreviewError('');
    void request('/api/owner/sales/kanban/opportunities/'+notesPreviewId).then(json=>{
      if(active)setNotesPreviewText(String(json.lead?.notes||''));
    }).catch((e:Error)=>{
      if(active)setNotesPreviewError(e.message||'Não foi possível consultar as observações.');
    }).finally(()=>{if(active)setNotesPreviewLoading(false);});
    return ()=>{active=false;};
  },[notesPreviewId,notesPreviewReload]);
  const saveExistingBulkChannels=async()=>{
    if(bulkExistingBusy||!bulkExistingIds.length||!bulkExistingChannels.length||
      acquisitionCatalogUnavailable)return;
    const selections=bulkExistingIds.map(leadId=>{
      const channels=bulkExistingReplace?bulkExistingChannels:
        [...new Set([...(acquisitionByLead[leadId]||[]),...bulkExistingChannels])];
      return {leadId,channelIds:channels};
    });
    if(selections.some(item=>item.channelIds.length>20)){
      setError('Há um card que excederia 20 canais. Revise a seleção.');return;
    }
    const keyName='acquisition-bulk-existing';
    const key=keysRef.current[keyName]||crypto.randomUUID();
    keysRef.current[keyName]=key;
    setBulkExistingBusy(true);setError(null);setInfo(null);
    try{
      const result=await persistSalesKanbanAcquisitionBulk(request,key,selections);
      delete keysRef.current[keyName];
      setAcquisitionByLead(old=>{
        const next={...old};
        for(const item of result.selections||[])next[item.leadId]=item.channelIds||[];
        return next;
      });
      setAcquisitionRefreshKey(x=>x+1);
      setBulkExistingIds([]);
      setInfo(selections.length+' card(s) classificados em lote, sem atualizar a página.');
    }catch(e:any){setError(e.message||'Não foi possível classificar os cards selecionados.');}
    finally{setBulkExistingBusy(false);}
  };
  const applyBulkChannels=()=>{
    setBulkChannelsByRow(old=>{
      const next={...old};
      for(const index of bulkSelectedRows)if(index<bulkPhones.length)next[index]=[...bulkChannelsToApply];
      return next;
    });
    delete keysRef.current.create;
  };
  const selectedCounts = selected ? leadCounts(selected.id) : {phone:0,whatsapp:0,spoken:false};
  useEffect(()=>{
    const lead=leads.find(x=>x.id===selectedId);
    setLeadDraft({name:lead?.name||'',phone:lead?.phone||'',clinicName:lead?.clinicName||'',email:lead?.email||'',notes:lead?.notes||''});
    setEditingSpokenId(null);
    setSpokenAtDraft(brazilLocalInput(new Date().toISOString()));
    if(!selectedId){setLoadingLeadDetails(false);setLeadDetailsError(false);return;}
    // Fetch the authoritative record once per open; ignore responses from previously opened cards.
    let active=true;
    setLoadingLeadDetails(true);setLeadDetailsError(false);
    void request('/api/owner/sales/kanban/opportunities/'+selectedId).then(json=>{
      if(!active)return;
      setLeadDraft({
        name:json.lead.name||'',phone:json.lead.phone||'',
        clinicName:json.lead.clinicName||'',email:json.lead.email||'',notes:json.lead.notes||'',
      });
      onLeadPatch(selectedId,json.lead);
    }).catch((e:Error)=>{
      if(!active)return;
      setLeadDetailsError(true);
      cardError(selectedId,e.message||'Não foi possível abrir o cadastro.');
    }).finally(()=>{if(active)setLoadingLeadDetails(false);});
    return ()=>{active=false;};
  },[selectedId,leadReload]);
  useEffect(()=>{
    const saved=selectedId?followups[selectedId]:null;
    setFollowupAtDraft(saved?.status==='scheduled'?brazilLocalInput(saved.contact_due_at):'');
  },[selectedId,followups]);
  const createOpportunities = async () => {
    const phones=bulkPhones;
    if(!phones.length||phones.length>100){setError('Informe de 1 a 100 números, separados por linha, vírgula ou ponto e vírgula.');return;}
    if(!checkedDuplicates||checkedDuplicates.length!==phones.length||blockedByDuplicate){
      setError('Revise os números destacados antes de salvar. Nenhum registro será sobrescrito.');return;
    }
    const channelsByPhone=phones.map((_,index)=>bulkChannelsByRow[index]||[]);
    const detailsByPhone=phones.map((_,index)=>index===0
      ? firstCreationContact
      : additionalCreationContacts[index]||{name:'',clinicName:'',email:''});
    const emails=new Set<string>();
    for(const contact of detailsByPhone){
      const email=contact.email.trim().toLowerCase();
      if((contact.name.trim()&&contact.name.trim().length<2)||
        contact.name.trim().length>180||contact.clinicName.trim().length>180||
        (email&&!/^[^ @]+@[^ @]+[.][^ @]+$/.test(email))||email.length>254||
        (email&&emails.has(email))){
        setError('Revise o nome, a clínica e o e-mail de cada contato (e-mails não podem se repetir).');return;
      }
      if(email)emails.add(email);
    }
    if(acquisitionCatalogUnavailable&&channelsByPhone.some(ids=>ids.length)){
      setError('Canais indisponíveis. Atualize antes de classificar o lote.');return;
    }
    setCreatingBusy(true);setError(null);
    const key=keysRef.current.create||crypto.randomUUID();keysRef.current.create=key;
    try {
      const json=await createManualOpportunities(request,phones,channelsByPhone,key,detailsByPhone);
      delete keysRef.current.create;
      onLeadsCreated(json.leads||[]);
      setAcquisitionByLead(old=>{
        const next={...old};
        for(const item of json.leads||[])next[item.id]=item.channelIds||[];
        return next;
      });
      setPhonesDraft('');setFirstCreationContact({name:'',clinicName:'',email:''});setAdditionalCreationContacts({});
      setCreatingOpen(false);setSearch('');setShowStage('all');
      setBulkChannelsByRow({});setBulkSelectedRows([]);setBulkChannelsToApply([]);
      setGlobalFollowupFilter('all');setColumnFollowupFilters({});
      setAgendaMode('all');setAgendaSource('all');setAgendaFrom('');setAgendaTo('');
      setInfo((json.leads||[]).length+' oportunidade(s) cadastrada(s) com as origens selecionadas.');
    }catch(e:any){
      setError(e.message||'Não foi possível cadastrar oportunidades.');
      // Another owner session may have registered a phone after our preview.
      if(/repetido|cadastrado/i.test(String(e.message||'')))setDuplicateCheckRetry(v=>v+1);
    }
    finally{setCreatingBusy(false);}
  };
  const saveLeadDetails = async () => {
    if(!selected||savingLead)return;
    const patch=Object.fromEntries(Object.entries(leadDraft).filter(([k,v])=>
      String(v||'')!==String((selected as unknown as Record<string,unknown>)[k]||'')));
    if(!Object.keys(patch).length)return;
    const keyName='edit:'+selected.id;
    const key=keysRef.current[keyName]||crypto.randomUUID();keysRef.current[keyName]=key;
    setSavingLead(true);setError(null);
    try {
      const json=await request('/api/owner/sales/kanban/opportunities/'+selected.id,{
        method:'PATCH',headers:{'X-Idempotency-Key':key},body:JSON.stringify(patch),
      });
      delete keysRef.current[keyName];
      // The server's Kanban-only overlay must win over a previously fetched snapshot,
      // including a second edit without a page refresh.
      setOverrides(current=>{
        const next={...current};
        if(json.lead?.kanbanOnly){
          next[selected.id]={
            hidden:false,
            details:{
              name:json.lead.name,phone:json.lead.phone,
              email:json.lead.email,clinicName:json.lead.clinicName,notes:json.lead.notes,
            },
          };
        }else{
          delete next[selected.id];
        }
        return next;
      });
      onLeadPatch(selected.id,json.lead);
      if(notesPreviewId===selected.id)setNotesPreviewText(String(json.lead?.notes||''));
      cardInfo(selected.id,json.lead?.kanbanOnly
        ? 'Dados salvos na ficha do Kanban. Cadastros de clientes, propostas e cobranças não foram alterados.'
        : 'Oportunidade salva.');
    }catch(e:any){cardError(selected.id,e.message||'Erro ao salvar oportunidade.');}
    finally{setSavingLead(false);}
  };
  const deleteLead = async (lead:Lead) => {
    if(!window.confirm('Remover '+(lead.name||lead.phone||'a oportunidade')+' do Kanban? O histórico e os dados de clientes, propostas e pagamentos serão preservados.'))return;
    const keyName='delete:'+lead.id;
    const key=keysRef.current[keyName]||crypto.randomUUID();keysRef.current[keyName]=key;
    setDeletingLead(true);setError(null);
    try {
      await request('/api/owner/sales/kanban/opportunities/'+lead.id,{
        method:'DELETE',headers:{'X-Idempotency-Key':key},
      });
      delete keysRef.current[keyName];
      setSelectedId(null);onLeadDeleted(lead.id);setInfo('Oportunidade removida do Kanban. Vínculos e histórico preservados.');
    }catch(e:any){cardError(lead.id,e.message||'Erro ao excluir oportunidade.');}
    finally{setDeletingLead(false);}
  };


  const updateScroll = () => {
    const e = scrollRef.current;
    if (e) setScroll({left:Math.round(e.scrollLeft),max:Math.max(0,Math.round(e.scrollWidth-e.clientWidth))});
  };
  useEffect(() => {
    updateScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll',updateScroll,{passive:true});
    window.addEventListener('resize',updateScroll);
    return () => {el.removeEventListener('scroll',updateScroll);window.removeEventListener('resize',updateScroll);};
  }, [columns,filtered.length,showStage]);
  const scrollBy = (d:number) => scrollRef.current?.scrollBy({left:d*340,behavior:'smooth'});

  const doAction = async (action:()=>Promise<void>) => {
    if (busy) return;
    setBusy(true);setError(null);setInfo(null);
    try { await action(); }
    catch (cause:any) {setError(cause.message || 'Não foi possível salvar.');}
    finally {setBusy(false);}
  };

  const editColumn = (c:Column) => {setEditingId(c.id);setDraftTitle(c.title);setDraftColor(c.color);};
  const saveColumn = () => void doAction(async()=>{
    if (!draftTitle.trim()) throw Error('Informe o título da coluna.');
    if (editingId === 'new') {
      const json = await request('/api/owner/sales/kanban/columns',{method:'POST',body:JSON.stringify({title:draftTitle.trim(),color:draftColor})});
      setColumns(old=>[...old,json.column]);setInfo('Nova coluna criada.');
    } else {
      const json = await request('/api/owner/sales/kanban/columns/'+editingId,{
        method:'PATCH',body:JSON.stringify({title:draftTitle.trim(),color:draftColor}),
      });
      setColumns(old=>old.map(c=>c.id===json.column.id?json.column:c));
      setInfo('Coluna atualizada.');
    }
    setEditingId(null);
  });
  const saveColumnOrder=async(next:Column[])=>{
    await request('/api/owner/sales/kanban/columns/order',{method:'PATCH',body:JSON.stringify({ids:next.map(c=>c.id)})});
    setColumns(next.map((c,i)=>({...c,position:i})));
  };
  const reorder = (id:string,delta:number) => void doAction(async()=>{
    const next=[...columns];const i=next.findIndex(x=>x.id===id),j=i+delta;
    if (i<0 || j<0 || j>=next.length) return;
    [next[i],next[j]]=[next[j],next[i]];
    await saveColumnOrder(next);
  });
  const moveColumnTo=(fromId:string,toId:string)=>void doAction(async()=>{
    const next=[...columns];
    const from=next.findIndex(c=>c.id===fromId),to=next.findIndex(c=>c.id===toId);
    if(from<0||to<0||from===to)return;
    next.splice(to,0,next.splice(from,1)[0]);
    await saveColumnOrder(next);
  });
  const deleteColumn = (col:Column) => {
    if (col.is_system || !window.confirm('Excluir a coluna "'+col.title+'"? Os cards voltarão à etapa comercial definida pelo seu status.')) return;
    void doAction(async()=>{
      await request('/api/owner/sales/kanban/columns/'+col.id,{method:'DELETE'});
      setColumns(old=>old.filter(c=>c.id!==col.id));
      setPlacements(old=>Object.fromEntries(Object.entries(old).filter(([,id])=>id!==col.id)));
      setEditingId(null);
      setInfo('Coluna excluída. Leads preservados.');
    });
  };
  const moveLead = (lead:Lead,column:Column) => {
    if (busy || busyLead || lead.status==='converted' || column.kind==='customers') return;
    if (column.id === columnFor(lead)) return;
    if(column.kind==='lost'){
      setLossDialog({leadId:lead.id});
      setLossReasonDraft(lead.lossReasonId||'');
      return; // Never persist loss without explicitly clicking Save.
    }
    const keyName='move:'+lead.id+':'+column.id;
    const key=keysRef.current[keyName] || crypto.randomUUID();keysRef.current[keyName]=key;
    setBusyLead(lead.id);setError(null);
    void (async()=>{
      try {
        const json=await moveSalesKanbanLead(request,lead.id,column.id,key);
        delete keysRef.current[keyName];
        setPlacements(old=>{
          const next={...old};if(column.kind==='custom')next[lead.id]=column.id;else delete next[lead.id];return next;
        });
        onLeadPatch(lead.id,{status:json.data.status,lostAt:json.data.lostAt,updatedAt:json.data.updatedAt});
        cardInfo(lead.id,'Lead movido para '+column.title+'.');
      } catch(e:any){cardError(lead.id,e.message || 'Erro ao mover lead.');}
      finally{setBusyLead(null);}
    })();
  };
  const recordAttempt = (lead:Lead,channel:'phone'|'whatsapp_call',outcome:'no_decisor'|'decisor_spoken') => {
    // Clicking any call button only opens the editor. Save persists.
    if(outcome!=='no_decisor'||busyLead)return;
    setAttemptDialog({leadId:lead.id,channel,localAt:brazilLocalInput(new Date().toISOString()),scriptVersionId:selectedScriptId});
    setError(null);
  };
  const saveAttemptTime=async()=>{
    const draft=attemptDialog;
    if(!draft||busyLead)return;
    const lead=visibleLeads.find(x=>x.id===draft.leadId);
    if(!lead){cardError(draft.leadId,'Oportunidade não encontrada.');return;}
    const keyName='attempt-time:'+draft.leadId+':'+(draft.attemptId||'new');
    try{
      const occurredAt=brazilInputToIso(draft.localAt);
      if(!draft.attemptId&&scriptCatalogUnavailable)
        throw Error('Fluxos indisponíveis. Atualize o quadro antes de registrar novos contatos.');
      if(!draft.attemptId&&activeScripts.length>0&&!draft.scriptVersionId)
        throw Error('Selecione o fluxo usado na tentativa.');
      const original=draft.attemptId?attempts.find(a=>a.id===draft.attemptId):null;
      const scriptVersionId=original
        ? original.script_version_id??null
        : draft.scriptVersionId||null;
      const key=keysRef.current[keyName]||crypto.randomUUID();
      keysRef.current[keyName]=key;
      setBusyLead(draft.leadId);setError(null);
      const json=await persistSalesAttemptTime(request,draft.leadId,key,{attemptId:draft.attemptId||null,channel:draft.channel,occurredAt,scriptVersionId});
      delete keysRef.current[keyName];
      setAttempts(old=>draft.attemptId
        ? old.map(item=>item.id===draft.attemptId?{...item,occurred_at:json.data.occurredAt}:item)
        : old.some(item=>item.id===json.data.attemptId)?old:
          [...old,{id:json.data.attemptId,lead_id:draft.leadId,
            channel:draft.channel,outcome:'no_decisor',occurred_at:json.data.occurredAt,
            script_version_id:scriptVersionId,contact_result:'no_answer'}]);
      onLeadPatch(draft.leadId,{status:json.data.status,lostAt:json.data.lostAt,updatedAt:json.data.updatedAt});
      setAttemptDialog(null);
      cardInfo(draft.leadId,draft.attemptId?'Data e hora da tentativa corrigidas.':'Tentativa registrada na data e hora informadas.');
      // Ten calls is a visual cadence reference, not a hard stop or automatic loss.
      // A lead remains in its existing funnel stage until explicitly changed.
    }catch(e:any){cardError(draft.leadId,e.message||'Não foi possível salvar a tentativa.');}
    finally{setBusyLead(null);}
  };
  const saveSpokenContact=async(lead:Lead,attempt?:CommercialAttempt)=>{
    if(busyLead)return;
    const input=attempt?editingSpokenAt:spokenAtDraft;
    const keyName='decisor:'+lead.id+':'+(attempt?.id||'new');
    try{
      const occurredAt=brazilInputToIso(input);
      if(!attempt&&scriptCatalogUnavailable)
        throw Error('Fluxos indisponíveis. Atualize o quadro antes de registrar novos contatos.');
      if(!attempt&&activeScripts.length>0&&!selectedScriptId)
        throw Error('Selecione o fluxo usado na conversa.');
      if(!attempt&&!contactResult)
        throw Error('Informe se houve interesse ou desinteresse do decisor.');
      // Historical corrections must not inherit a newly selected script/result.
      const scriptVersionId=attempt?attempt.script_version_id??null:selectedScriptId||null;
      const resolvedResult=attempt?attempt.contact_result??null:contactResult||null;
      const key=keysRef.current[keyName]||crypto.randomUUID();
      keysRef.current[keyName]=key;
      setBusyLead(lead.id);setError(null);
      const json=await persistSalesDecisorContact(request,lead.id,key,{channel:attempt?.channel||spokenChannel,
        attemptId:attempt?.id||null,occurredAt,scriptVersionId,contactResult:resolvedResult});
      delete keysRef.current[keyName];
      setAttempts(old=>attempt
        ? old.map(item=>item.id===attempt.id?{...item,occurred_at:json.data.occurredAt}:item)
        : old.some(item=>item.id===json.data.attemptId)?old:
          [...old,{id:json.data.attemptId,lead_id:lead.id,
            channel:spokenChannel,outcome:'decisor_spoken',occurred_at:json.data.occurredAt,
            script_version_id:scriptVersionId,contact_result:resolvedResult as 'interested'|'not_interested'}]);
      onLeadPatch(lead.id,{status:json.data.status,lostAt:json.data.lostAt,updatedAt:json.data.updatedAt});
      setEditingSpokenId(null);
      cardInfo(lead.id,attempt?'Data e hora do contato corrigidas e auditadas.':'Contato com decisor salvo no horário informado.');
    }catch(e:any){cardError(lead.id,e.message||'Não foi possível salvar o contato.');}
    finally{setBusyLead(null);}
  };
  const saveFollowup=async(lead:Lead,cancel=false)=>{
    if(savingFollowup)return;
    const keyName='followup:'+lead.id;
    try{
      const contactDueAt=cancel?null:brazilInputToIso(followupAtDraft);
      const key=keysRef.current[keyName]||crypto.randomUUID();
      keysRef.current[keyName]=key;
      setSavingFollowup(true);setError(null);
      const json=await persistSalesFollowup(request,lead.id,key,contactDueAt);
      delete keysRef.current[keyName];
      setFollowups(old=>({...old,[lead.id]:json.followup}));
      cardInfo(lead.id,cancel?'Retorno cancelado.':'Data e hora do retorno salvas (sem notificações).');
    }catch(e:any){cardError(lead.id,e.message||'Não foi possível salvar o retorno.');}
    finally{setSavingFollowup(false);}
  };
  const manualLost = (lead:Lead) => {
    if(busyLead)return;
    setLossReasonDraft(lead.lossReasonId||'');
    setLossDialog({leadId:lead.id});
    setError(null);
  };
  useEffect(()=>{
    setInlineLossName('');
    setInlineLossError(null);
  },[lossDialog?.leadId]);
  const createInlineLossReason=async()=>{
    const name=inlineLossName.trim();
    if(inlineLossBusy||busyLead||name.length<2||name.length>100)return;
    setInlineLossBusy(true);setInlineLossError(null);
    try{
      const json=await request('/api/owner/sales/loss-reasons',{
        method:'POST',body:JSON.stringify({name}),
      });
      setLossReasons(old=>[...old.filter(reason=>reason.id!==json.reason.id),json.reason].sort((a,b)=>
        Number(b.is_active)-Number(a.is_active)||a.name.localeCompare(b.name,'pt-BR')));
      setLossReasonDraft(json.reason.id);
      setInlineLossName('');
      // Catalog creation is persisted separately; the lead stays unchanged until Save loss.
    }catch(e:any){setInlineLossError(e.message||'Não foi possível cadastrar o motivo.');}
    finally{setInlineLossBusy(false);}
  };
  const saveLoss=async()=>{
    if(inlineLossBusy)return;
    const id=lossDialog?.leadId;
    if(!id||!lossReasonDraft||!lossReasons.some(r=>r.id===lossReasonDraft&&r.is_active))return;
    const keyName='lost:'+id+':'+lossReasonDraft;
    const key=keysRef.current[keyName]||crypto.randomUUID();keysRef.current[keyName]=key;
    setBusyLead(id);setError(null);
    try{
      const json=await persistSalesLoss(request,id,key,lossReasonDraft);
      delete keysRef.current[keyName];
      setPlacements(old=>{const next={...old};delete next[id];return next;});
      onLeadPatch(id,{status:json.data.status,lostAt:json.data.lostAt,updatedAt:json.data.updatedAt,lossReasonId:json.data.lossReasonId});
      setLossDialog(null);
      cardInfo(id,'Perda salva com motivo.');
    }catch(e:any){setError(e.message||'Não foi possível salvar a perda.');}
    finally{setBusyLead(null);}
  };
  const saveLossReason=async()=>{
    if(lossSettingsBusy||lossNameDraft.trim().length<2)return;
    setLossSettingsBusy(true);setError(null);
    try{
      const editing=Boolean(editingLossReasonId);
      const json=await request('/api/owner/sales/loss-reasons'+(editing?'/'+editingLossReasonId:''),{
        method:editing?'PATCH':'POST',
        body:JSON.stringify({name:lossNameDraft.trim(),...(editing?{isActive:lossActiveDraft}:{})})
      });
      setLossReasons(old=>[...old.filter(r=>r.id!==json.reason.id),json.reason].sort((a,b)=>
        Number(b.is_active)-Number(a.is_active)||a.name.localeCompare(b.name,'pt-BR')));
      setEditingLossReasonId(null);setLossNameDraft('');setLossActiveDraft(true);
      setInfo('Motivo de perda salvo. Histórico e gráficos usam o nome atualizado.');
    }catch(e:any){setError(e.message||'Não foi possível salvar o motivo.');}
    finally{setLossSettingsBusy(false);}
  };

  const shownColumns=columns.filter(c=>showStage==='all'||showStage===c.id);
  // A manually agreed date takes precedence over the next suggested call slot.
  // Suggested slots are computed once per loaded lead and never persisted as appointments.
  const agendaByLead=useMemo(()=>{
    const map=new Map<string,AgendaMoment|null>();
    for(const lead of filtered){
      const count=countByLead.get(lead.id);
      const eligible=!['lost','archived','converted'].includes(lead.status);
      const hasManual=followups[lead.id]?.status==='scheduled';
      const suggestion=historyReady&&eligible&&!hasManual&&!count?.spoken
        ? nextSalesCadenceSlots(attemptsByLead.get(lead.id)||[],new Date(clockNow))[0]
        : null;
      map.set(lead.id,resolveAgendaMoment(followups[lead.id],suggestion,eligible));
    }
    return map;
  },[filtered,followups,countByLead,attemptsByLead,clockNow,historyReady]);
  const callDueToday=(lead:Lead)=>historyReady&&
    isCallDueToday(agendaByLead.get(lead.id),calendarToday,lead.status,
      Boolean(String(lead.phone||'').trim()),Boolean(countByLead.get(lead.id)?.spoken));
  const callFilterPass=(lead:Lead)=>!callTodayOnly||callDueToday(lead);
  const callTodayCount=filtered.filter(callDueToday).length;
  const agendaActive=agendaMode!=='all'||agendaSource!=='all'||Boolean(agendaFrom||agendaTo);
  const agendaPass=(leadId:string)=>agendaMatches(agendaByLead.get(leadId),{
    mode:agendaMode,source:agendaSource,date:agendaDate,from:agendaFrom,to:agendaTo,now:clockNow,
  });
  const filterAgendaAndSort=(items:Lead[])=>{
    const matched=items.filter(l=>agendaPass(l.id));
    if(!agendaActive)return matched;
    return matched.sort((a,b)=>
      compareAgendaPriority(agendaByLead.get(a.id),agendaByLead.get(b.id),clockNow));
  };
  const setAgendaFilter=(mode:AgendaMode)=>{
    setClockNow(Date.now());
    setAgendaMode(mode);
    setCallTodayOnly(false);
    // Agenda and legacy manual-return filters are separate views; reset legacy
    // filters so suggested slots don't disappear behind the stored-only filter.
    setGlobalFollowupFilter('all');
    setColumnFollowupFilters({});
  };
  const matchReturnFilter=(lead:Lead,filter:FollowupFilter)=>
    matchesFollowup(followups[lead.id],filter,calendarToday,lead.status);
  const effectiveReturnFilter=(columnId:string)=>
    columnFollowupFilters[columnId]??globalFollowupFilter;
  const cardCount=(c:Column)=>filtered.filter(l=>columnFor(l)===c.id&&
    matchReturnFilter(l,effectiveReturnFilter(c.id))&&agendaPass(l.id)&&callFilterPass(l)).length;
  const returnsTodayCount=filtered.filter(l=>matchReturnFilter(l,'today')).length;
  const overdueCount=filtered.filter(l=>matchReturnFilter(l,'overdue')).length;
  const shownCount=filtered.filter(l=>{
    const id=columnFor(l);
    if(!id)return false;
    return (showStage==='all'||id===showStage)&&
      matchReturnFilter(l,effectiveReturnFilter(id))&&agendaPass(l.id)&&callFilterPass(l);
  }).length;
  const currentlyShownLeadIds=filtered.filter(lead=>{
    const id=columnFor(lead);
    return Boolean(id)&&(showStage==='all'||showStage===id)&&
      matchReturnFilter(lead,effectiveReturnFilter(id||''))&&agendaPass(lead.id)&&callFilterPass(lead);
  }).map(lead=>lead.id);
  const chooseGlobalFollowupFilter=(filter:FollowupFilter)=>{
    setCalendarToday(brazilDateKey(new Date()));
    setGlobalFollowupFilter(filter);
    setCallTodayOnly(false);
    setColumnFollowupFilters({});
    setAgendaMode('all');setAgendaSource('all');setAgendaFrom('');setAgendaTo('');
  };
  const toggleCallToday=()=>{
    setClockNow(Date.now());setCalendarToday(brazilDateKey(new Date()));
    setCallTodayOnly(value=>!value);
    setGlobalFollowupFilter('all');setColumnFollowupFilters({});
    setAgendaMode('all');setAgendaSource('all');setAgendaFrom('');setAgendaTo('');
  };
  // A funnel stage, prior conversation or cadence milestone must never disable
  // either call button. Only an in-flight save temporarily prevents double taps.
  const callEnabled=(_lead:Lead,_ch:'phone'|'whatsapp_call')=>!busyLead;
  const lossReasonLabel=(lead:Lead)=>lossReasons.find(x=>x.id===lead.lossReasonId)?.name||'Sem motivo informado';
  const editingColumn=columns.find(c=>c.id===editingId);
  const editingColumnIndex=columns.findIndex(c=>c.id===editingId);
  return (
    <section className="min-w-0 flex-1 flex flex-col gap-3" aria-label="Kanban comercial de tela inteira">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#10192D] px-4 py-3 text-white">
        <div>
          <h2 className="text-base font-black tracking-tight">Central de prospecção <span className="ml-1 text-xs font-medium text-slate-400">· Quadro operacional</span></h2>
          <p className="text-xs text-slate-300">{leads.length} leads carregados · {columns.length} colunas personalizáveis · salvamento automático no servidor</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={()=>{setCreatingOpen(true);setError(null);}} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-white hover:bg-emerald-600"><Plus size={15}/> Nova oportunidade</button>
          <button type="button" onClick={()=>setScriptsOpen(v=>!v)}
            className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs font-bold hover:bg-white/10">
            Scripts / Testes A-B
          </button>
          <button type="button" onClick={()=>{setLossSettingsOpen(v=>!v);setError(null);}}
            className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs font-bold hover:bg-white/10">
            Motivos de perda
          </button>
          <button type="button" onClick={()=>{
              setBulkExistingMode(v=>!v);setBulkExistingIds([]);setError(null);setInfo(null);
            }} className={'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold '+(
              bulkExistingMode?'border-violet-300 bg-violet-600 text-white':'border-white/20 hover:bg-white/10')}>
            {bulkExistingMode?'Concluir seleção':'Selecionar vários cards'}
          </button>
          <button type="button" onClick={()=>setAcquisitionOpen(v=>!v)}
            className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs font-bold hover:bg-white/10">
            Canais + Resultados
          </button>
          <button type="button" onClick={onMetrics} className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs font-bold hover:bg-white/10"><BarChart3 size={15}/> Gráficos</button>
          <button type="button" onClick={()=>{void onRefresh().then(()=>setRevision(x=>x+1));}} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-900"><RefreshCw size={15}/> Atualizar</button>
        </div>
      </div>

      {scriptsOpen&&<CommercialScriptsPanel onClose={()=>setScriptsOpen(false)} onChanged={refreshScripts}/>}
      {acquisitionOpen&&<CommercialAcquisitionPanel refreshKey={acquisitionRefreshKey} onClose={()=>setAcquisitionOpen(false)} onChanged={refreshAcquisitionCatalog}/>}
      {bulkExistingMode&&<div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4" aria-label="Classificação de cards em lote">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-sm text-indigo-950">Classificar cards em lote · {bulkExistingIds.length} selecionado(s)</strong>
          <div className="flex gap-2">
            <button type="button" disabled={bulkExistingBusy}
              onClick={()=>setBulkExistingIds(currentlyShownLeadIds.slice(0,100))}
              className="rounded-lg border bg-white px-3 py-2 text-xs font-bold">Selecionar até 100 visíveis</button>
            <button type="button" disabled={bulkExistingBusy} onClick={()=>setBulkExistingIds([])}
              className="rounded-lg border bg-white px-3 py-2 text-xs font-bold">Limpar seleção</button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-600">Marque os cards no quadro ou selecione os visíveis após aplicar filtros. Os canais serão adicionados aos existentes por padrão.</p>
        <fieldset className="mt-3 flex flex-wrap gap-3 rounded-lg border border-indigo-100 bg-white p-3">
          <legend className="px-1 text-xs font-bold">Canais para os cards selecionados</legend>
          {acquisitionChannels.filter(c=>c.is_active).map(channel=><label key={channel.id}
            className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" disabled={bulkExistingBusy} checked={bulkExistingChannels.includes(channel.id)}
              onChange={e=>{
                setBulkExistingChannels(old=>e.target.checked?[...old,channel.id]:old.filter(id=>id!==channel.id));
                delete keysRef.current['acquisition-bulk-existing'];
              }}
              className="h-4 w-4 accent-indigo-700"/>{channel.name}
          </label>)}
        </fieldset>
        <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={bulkExistingReplace} disabled={bulkExistingBusy}
            onChange={e=>{setBulkExistingReplace(e.target.checked);delete keysRef.current['acquisition-bulk-existing'];}}
            className="h-4 w-4 accent-indigo-700"/>
          Substituir os canais atuais (em vez de adicionar)
        </label>
        <button type="button" disabled={bulkExistingBusy||!bulkExistingIds.length||
          !bulkExistingChannels.length||acquisitionCatalogUnavailable}
          onClick={()=>void saveExistingBulkChannels()}
          className="mt-3 rounded-lg bg-indigo-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">
          {bulkExistingBusy?'Salvando...':'Salvar canais nos '+bulkExistingIds.length+' cards'}
        </button>
      </div>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {columns.filter(c=>c.is_system).map(c=>(
          <button key={c.id} type="button" onClick={()=>setShowStage(x=>x===c.id?'all':c.id)}
            className={'flex min-w-0 items-center justify-between rounded-lg border bg-white px-3 py-2 text-left shadow-sm '+(showStage===c.id?'ring-2 ring-violet-500':'border-slate-200')}
          ><span className="min-w-0 truncate text-[11px] font-bold text-slate-600">{c.title}</span><strong className="ml-1 text-lg tabular-nums" style={{color:c.color}}>{cardCount(c)}</strong></button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
          <Search size={16} className="text-slate-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Buscar por nome, clínica, telefone ou e-mail..." aria-label="Buscar leads"
            className="h-10 min-w-0 flex-1 bg-transparent text-xs outline-none"/>
        </label>
        <select aria-label="Filtrar coluna" value={showStage} onChange={e=>setShowStage(e.target.value)}
          className="h-10 max-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-xs">
          <option value="all">Todas as colunas</option>
          {columns.map(c=><option value={c.id} key={c.id}>{c.title}</option>)}
        </select>
        <span className="text-xs text-slate-500">{shownCount} de {filtered.length} cards carregados</span>
        {remaining>0&&<button onClick={()=>void onLoadMore()} disabled={loadingMore} className="h-10 rounded-lg border border-violet-300 px-3 text-xs font-bold text-violet-700 disabled:opacity-50">{loadingMore?"Carregando...":"Carregar mais "+Math.min(remaining,100)+" leads ("+remaining+" restantes)"}</button>}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2"
        aria-label="Filtros de retorno do Kanban">
        <span className="px-2 text-xs font-bold text-slate-700">Retornos:</span>
        <button type="button" aria-label="Filtrar leads para ligar hoje"
          aria-pressed={callTodayOnly} onClick={toggleCallToday}
          className={'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold '+
            (callTodayOnly?'bg-teal-700 text-white':'border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100')}>
          <Phone size={14}/> Ligar hoje · {callTodayCount}
        </button>
        {([
          {key:'all' as const,title:'Todos'},
          {key:'today' as const,title:'Hoje',count:returnsTodayCount},
          {key:'overdue' as const,title:'Atrasados',count:overdueCount},
        ]).map(item=><button key={item.key} type="button"
          aria-pressed={globalFollowupFilter===item.key&&Object.keys(columnFollowupFilters).length===0}
          onClick={()=>chooseGlobalFollowupFilter(item.key)}
          className={'rounded-lg px-3 py-2 text-xs font-bold '+(
            globalFollowupFilter===item.key&&Object.keys(columnFollowupFilters).length===0
            ? 'bg-violet-700 text-white':'border border-slate-200 text-slate-700 hover:bg-violet-50'
          )}>
          {item.title}{typeof item.count==='number'?' · '+item.count:''}
        </button>)}
        <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-slate-700">
          Mais filtros
          <select aria-label="Filtrar todos os retornos" value={globalFollowupFilter}
            onChange={e=>chooseGlobalFollowupFilter(e.target.value as FollowupFilter)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
            {followupFilters.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        {remaining>0&&<p className="w-full px-2 text-[11px] text-amber-700">
          Os filtros consideram os cards carregados. Use “Carregar mais leads” para incluir os demais.
        </p>}
      </div>

      <details className="group rounded-xl border border-violet-200 bg-violet-50/70 p-3"
        aria-label="Agenda de retorno por data e horário">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <div>
            <h3 className="text-xs font-black text-violet-950">Agenda priorizada de contatos</h3>
            <p className="text-[11px] text-violet-800">Compromissos agendados e janelas sugeridas · mais urgentes primeiro</p>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-violet-800">
            {agendaActive?'Filtro ativo':'Filtros'} <ChevronDown size={16} className="transition-transform group-open:rotate-180"/>
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          <div className="flex justify-end">
            <button type="button" onClick={()=>{setAgendaFilter('all');setAgendaSource('all');setAgendaFrom('');setAgendaTo('');}}
              className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-700">
              Limpar agenda
            </button>
          </div>
        <div className="flex flex-wrap gap-2">
          {([
            {value:'priority' as const,label:'Priorizar retornos'},
            {value:'today' as const,label:'Retornos de hoje'},
            {value:'next2h' as const,label:'Próximas 2 horas'},
            {value:'overdue' as const,label:'Atrasados'},
          ]).map(item=><button type="button" key={item.value}
            aria-pressed={agendaMode===item.value}
            onClick={()=>setAgendaFilter(item.value)}
            className={'rounded-lg px-3 py-2 text-xs font-bold '+(agendaMode===item.value
              ? 'bg-violet-700 text-white':'border border-violet-200 bg-white text-violet-800')}>
            {item.label}
          </button>)}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-slate-700">Data do retorno
            <input type="date" aria-label="Data específica do retorno" value={agendaDate}
              onChange={e=>{setAgendaDate(e.target.value);setAgendaFilter('date');}}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"/>
          </label>
          <label className="text-xs font-bold text-slate-700">Horário a partir de
            <input type="time" aria-label="Horário inicial do retorno" value={agendaFrom}
              onChange={e=>{setAgendaFrom(e.target.value);if(agendaMode==='all')setAgendaFilter('priority');}}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"/>
          </label>
          <label className="text-xs font-bold text-slate-700">Horário até
            <input type="time" aria-label="Horário final do retorno" value={agendaTo}
              onChange={e=>{setAgendaTo(e.target.value);if(agendaMode==='all')setAgendaFilter('priority');}}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"/>
          </label>
          <label className="text-xs font-bold text-slate-700">Origem do horário
            <select aria-label="Origem do retorno" value={agendaSource}
              onChange={e=>{setAgendaSource(e.target.value as AgendaSource);if(agendaMode==='all')setAgendaFilter('priority');}}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
              <option value="all">Agendados + sugeridos</option>
              <option value="scheduled">Somente cadastrados</option>
              <option value="suggested">Somente sugeridos</option>
            </select>
          </label>
        </div>
        <p className="text-[11px] text-slate-600">
          {agendaActive?'Ordenado por urgência dentro de cada coluna. Atrasados aparecem antes dos próximos horários.':
            'Selecione um filtro para ordenar os retornos por urgência.'}
          {' '}Sugestões não são agendamentos e não enviam notificações.
        </p>
        </div>
      </details>

      {lossSettingsOpen&&<section aria-label="Cadastrar e editar motivos de perda" className="rounded-xl border border-violet-200 bg-white p-4">
        <h3 className="text-sm font-black">Motivos de perda</h3>
        <p className="mt-1 text-xs text-slate-600">Edite o nome sem perder os vínculos das oportunidades já perdidas. Desativar impede novas seleções, mas preserva o histórico.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-bold">Nome do motivo
            <input maxLength={100} value={lossNameDraft} onChange={e=>setLossNameDraft(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" placeholder="Ex.: Preço fora do orçamento"/>
          </label>
          {editingLossReasonId&&<label className="flex items-center gap-2 pb-2 text-xs">
            <input type="checkbox" checked={lossActiveDraft} onChange={e=>setLossActiveDraft(e.target.checked)}/> Ativo
          </label>}
          <button type="button" disabled={lossSettingsBusy||lossNameDraft.trim().length<2} onClick={()=>void saveLossReason()}
            className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Salvar motivo</button>
          {editingLossReasonId&&<button type="button" onClick={()=>{setEditingLossReasonId(null);setLossNameDraft('');setLossActiveDraft(true);}}
            className="rounded-lg border px-3 py-2 text-xs">Cancelar edição</button>}
        </div>
        {lossCatalogUnavailable&&<p role="alert" className="mt-2 text-xs text-red-700">Catálogo indisponível. Nenhuma perda será salva sem motivo.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {lossReasons.map(reason=><button key={reason.id} type="button"
            onClick={()=>{setEditingLossReasonId(reason.id);setLossNameDraft(reason.name);setLossActiveDraft(reason.is_active);}}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 hover:border-violet-400">
            <Pencil size={12} className="mr-1 inline"/>{reason.name}{reason.is_active?'':' · Inativo'}
          </button>)}
        </div>
      </section>}
      {(error||info)&&<div role={error?'alert':'status'} className={'rounded-lg border px-3 py-2 text-xs '+(error?'border-red-200 bg-red-50 text-red-700':'border-green-200 bg-green-50 text-green-800')}>
        {error||info} <button type="button" className="ml-2 underline" onClick={()=>{setError(null);setInfo(null);}}>Fechar</button>
      </div>}
      {(scriptCatalogUnavailable||acquisitionCatalogUnavailable)&&
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {scriptCatalogUnavailable?'Scripts indisponíveis: os cards permanecem acessíveis, mas novos contatos exigem recarregar os fluxos. ':''}
          {acquisitionCatalogUnavailable?'Canais de aquisição indisponíveis: a seleção foi temporariamente bloqueada para preservar as origens já salvas. ':''}
          Use “Atualizar” para tentar novamente.
        </p>}
      {loading&&<p role="status" className="text-xs text-slate-500">Sincronizando quadro e histórico de ligações...</p>}
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
        <button type="button" onClick={()=>scrollBy(-1)} aria-label="Rolar colunas à esquerda" disabled={scroll.left<=0}
          className="rounded-md border p-1.5 text-slate-600 disabled:opacity-30"><ChevronLeft size={16}/></button>
        <input aria-label="Navegar horizontalmente no Kanban" type="range" min={0} max={Math.max(scroll.max,1)}
          value={Math.min(scroll.left,Math.max(scroll.max,1))}
          onChange={e=>{if(scrollRef.current)scrollRef.current.scrollLeft=Number(e.target.value);}}
          className="h-2 w-full min-w-0 accent-violet-600" disabled={scroll.max===0}/>
        <button type="button" onClick={()=>scrollBy(1)} aria-label="Rolar colunas à direita" disabled={scroll.left>=scroll.max}
          className="rounded-md border p-1.5 text-slate-600 disabled:opacity-30"><ChevronRight size={16}/></button>
      </div>

      <div ref={scrollRef} className="min-w-0 overflow-x-auto pb-2" aria-label="Etapas comerciais">
        <div className="flex min-h-[380px] w-max min-w-full gap-2.5">
          {shownColumns.map((col)=>{
            const columnFilter=effectiveReturnFilter(col.id);
            const allCards=filtered.filter(l=>columnFor(l)===col.id);
            const cards=filterAgendaAndSort(allCards.filter(l=>matchReturnFilter(l,columnFilter)&&callFilterPass(l)))
              .sort((a,b)=>{
                if(col.slug==='prospecting'){
                  const siteOrder=compareSiteInterestProspecting(a,b);
                  if(siteOrder!==0)return siteOrder;
                }
                return agendaActive||columnFilter==='all'||columnFilter==='none'?0:
                  Date.parse(followups[a.id]?.contact_due_at||'')-
                  Date.parse(followups[b.id]?.contact_due_at||'');
              });
            return <div key={col.id} className="flex w-[315px] min-w-[315px] flex-col overflow-hidden rounded-xl border shadow-sm"
              style={{backgroundColor:col.color+'0D',borderColor:col.color+'44'}}
              onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-verto-kanban-column')||col.kind!=='customers')e.preventDefault();}}
              onDrop={e=>{
                e.preventDefault();
                const sourceColumn=e.dataTransfer.getData('application/x-verto-kanban-column');
                if(sourceColumn){moveColumnTo(sourceColumn,col.id);return;}
                const id=e.dataTransfer.getData('text/plain');
                const lead=leads.find(x=>x.id===id);if(lead)moveLead(lead,col);
              }}>
              <div className="px-3 py-3 text-white" style={{backgroundColor:col.color}}>
                <div className="flex items-center justify-between gap-2">
                  <h3 draggable={!busy} onDragStart={e=>{
                    e.dataTransfer.setData('application/x-verto-kanban-column',col.id);
                    e.dataTransfer.effectAllowed='move';
                  }} title={'Arraste para reordenar '+col.title}
                    className="min-w-0 flex-1 cursor-grab truncate text-sm font-black active:cursor-grabbing">{col.title}</h3>
                  <button type="button" aria-label={'Editar '+col.title} title={'Editar '+col.title}
                    disabled={busy} onClick={()=>editColumn(col)} className="rounded p-1 hover:bg-white/20 disabled:opacity-40"><Pencil size={14}/></button>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-black tabular-nums">{cards.length}</span>
                </div>
                <p className="mt-1 text-[10px] font-medium opacity-85">{col.kind==='custom'?'Etapa personalizada':col.kind==='customers'?'Conversão confirmada pelo pagamento':'Arraste ou selecione um card para mover'}</p>
              </div>
              <div className="border-b border-slate-200 bg-white/90 px-2 py-2">
                <label className="block text-[11px] font-bold text-slate-700">
                  Filtrar retornos nesta coluna
                  <select aria-label={'Filtrar retornos da coluna '+col.title}
                    value={columnFilter}
                    onChange={e=>{setCallTodayOnly(false);setColumnFollowupFilters(old=>({...old,[col.id]:e.target.value as FollowupFilter}));}}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs">
                    {followupFilters.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <p className="mt-1 text-[10px] text-slate-500">{cards.length} de {allCards.length} cards nesta coluna</p>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {cards.length===0&&<div className="rounded-lg border border-dashed border-slate-300 bg-white/70 p-5 text-center text-xs text-slate-400">{allCards.length>0?'Nenhum card corresponde ao filtro':'Nenhum card nesta etapa'}</div>}
                {cards.map(lead=>{
                  const a=leadCounts(lead.id),total=a.phone+a.whatsapp;
                  const newLead=historyReady&&total===0&&!['converted','lost','archived'].includes(lead.status);
                  const dueToday=callDueToday(lead);
                  const partnerReferral=referralsByLead[lead.id];
                  return <article key={lead.id} draggable={!busyLead&&lead.status!=='converted'}
                    onDragStart={e=>e.dataTransfer.setData('text/plain',lead.id)}
                    className="group rounded-lg border-l-4 bg-white p-3 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md"
                    style={{borderLeftColor:col.color}}>
                    {bulkExistingMode&&<label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-bold text-indigo-900">
                      <input type="checkbox" aria-label={'Selecionar card '+(lead.name||lead.phone)}
                        disabled={bulkExistingBusy}
                        checked={bulkExistingIds.includes(lead.id)}
                        onChange={e=>{
                          setBulkExistingIds(old=>e.target.checked?
                            old.length>=100?old:[...old,lead.id]:old.filter(id=>id!==lead.id));
                          delete keysRef.current['acquisition-bulk-existing'];
                        }}
                        className="h-4 w-4 accent-indigo-700"/>
                      Incluir na classificação em lote
                    </label>}
                    <button type="button" onClick={()=>openCard(lead.id)} className="w-full text-left" aria-label={'Abrir lead '+(lead.name||'sem nome')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <strong className="line-clamp-2 text-xs font-black uppercase leading-5 text-slate-900">{lead.name||'Lead sem nome'}</strong>
                          {(newLead||dueToday)&&<div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {newLead&&<span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Novo</span>}
                            {dueToday&&<span className="inline-flex items-center gap-1 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-800">
                              <Phone size={11} aria-hidden="true"/> Ligar hoje
                            </span>}
                          </div>}
                        </div>
                        <GripVertical size={15} className="shrink-0 text-slate-300 group-hover:text-slate-500"/>
                      </div>
                      <p className="mt-1 truncate text-[11px] font-semibold text-slate-600">{lead.clinicName||'Clínica não informada'}</p>
                      {partnerReferral&&<div className="mt-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5 text-[10px] text-violet-950">
                        <span className="font-bold">Aquisição: Indicação</span>
                        <span className="block truncate" title={partnerReferral.partnerName}>Parceiro: {partnerReferral.partnerName}</span>
                        {partnerReferral.couponCode
                          ? <span className="block truncate">Cupom informado: {partnerReferral.couponCode}</span>
                          : partnerReferral.partnerCouponCode
                            ? <span className="block truncate">Cupom atual do parceiro: {partnerReferral.partnerCouponCode}</span>
                            : null}
                      </div>}
                      <p className="mt-1 truncate text-[11px] text-slate-500">{lead.phone||'Telefone não informado'}</p>
                      <div className="mt-3 grid grid-cols-2 gap-1.5">
                        <div className="rounded bg-slate-50 p-1.5"><span className="block text-[9px] text-slate-500">Tentativas</span><b className="text-xs">{total} ligações</b></div>
                        <div className="rounded bg-slate-50 p-1.5"><span className="block text-[9px] text-slate-500">Status</span><b className={'line-clamp-1 text-[10px] '+(a.spoken?'text-green-700':'text-slate-700')}>{a.spoken?(a.spokenVia==='whatsapp_message'?'Decisor por mensagem':'Decisor por ligação'):SALES_LEAD_STATUS_LABELS[lead.status]||lead.status}</b></div>
                      </div>
                      <div role="progressbar" aria-label="Tentativas de ligação"
                        aria-valuemin={0} aria-valuemax={10} aria-valuenow={Math.min(total,10)}
                        title={total+' de 10 ligações realizadas'}
                        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full transition-all duration-300"
                          style={{width:progressWidth(total),backgroundColor:progressColor(total)}}/>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">Operadora {a.phone} · Ligação WhatsApp {a.whatsapp}</p>
                      {followups[lead.id]?.status==='scheduled'&&
                        !['converted','lost','archived'].includes(lead.status)&&
                        <p className={'mt-2 rounded-lg px-2 py-1.5 text-[10px] font-bold '+(
                          followupBucket(followups[lead.id],calendarToday)==='overdue'
                          ? 'bg-red-50 text-red-800'
                          : followupBucket(followups[lead.id],calendarToday)==='today'
                          ? 'bg-amber-100 text-amber-900':'bg-violet-50 text-violet-800'
                        )}>
                          {followupBucket(followups[lead.id],calendarToday)==='overdue'?'Retorno atrasado':
                           followupBucket(followups[lead.id],calendarToday)==='today'?'Retornar hoje':'Próximo retorno'}
                          {' · '+dateText(followups[lead.id].contact_due_at)}
                        </p>}
                      {agendaByLead.get(lead.id)?.source==='suggested'&&
                        <p className="mt-1 text-[10px] font-semibold text-violet-700">
                          {dueToday&&brazilDateKey(agendaByLead.get(lead.id)?.at)<calendarToday
                            ? 'Ligação sugerida pendente' : 'Próxima ligação sugerida'}
                          {' · '+dateText(agendaByLead.get(lead.id)?.at)}
                        </p>}
                      {lead.status==='lost'&&<p className="mt-1 text-[10px] font-bold text-red-700">Perdido · {dateText(lead.lostAt)} · {lossReasonLabel(lead)}</p>}
                    </button>
                    {feedbackFor(lead.id)&&<p role={feedbackFor(lead.id)?.error?'alert':'status'}
                      className={'mt-2 rounded-lg px-2 py-1.5 text-[10px] '+(feedbackFor(lead.id)?.error
                        ? 'bg-red-50 text-red-700':'bg-green-50 text-green-800')}>
                      {feedbackFor(lead.id)?.error||feedbackFor(lead.id)?.info}
                    </p>}
                    <button type="button" onClick={()=>openAcquisitionEditor(lead.id)}
                      className="mt-2 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-2 text-left text-[11px] font-bold text-indigo-700"
                      aria-label={'Selecionar canais de aquisição para '+(lead.name||'oportunidade')}>
                      <span className="block">Canais de aquisição · selecionar <span aria-hidden="true">▾</span></span>
                      <span className="mt-0.5 block truncate text-[10px] font-normal text-slate-600">
                        {acquisitionNames(lead.id).join(' · ')||'Nenhum canal marcado'}
                      </span>
                    </button>
                    <button type="button"
                      onClick={()=>setNotesPreviewId(current=>current===lead.id?null:lead.id)}
                      aria-label={'Visualizar observações de '+(lead.name||lead.phone||'oportunidade')}
                      aria-expanded={notesPreviewId===lead.id}
                      aria-controls={notesPreviewId===lead.id?'notes-preview-'+lead.id:undefined}
                      className="mt-2 flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-100">
                      <span className="flex items-center gap-1.5"><FileText size={13}/> Observações</span>
                      <ChevronDown size={14} className={notesPreviewId===lead.id?'rotate-180 transition-transform':'transition-transform'}/>
                    </button>
                    {notesPreviewId===lead.id&&<div id={'notes-preview-'+lead.id} role="region"
                      aria-label={'Observações de '+(lead.name||lead.phone||'oportunidade')}
                      className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2.5">
                      {notesPreviewError?<div role="alert" className="text-[11px] text-red-700">
                        <p>{notesPreviewError}</p>
                        <button type="button" onClick={()=>setNotesPreviewReload(value=>value+1)}
                          className="mt-2 rounded border border-red-200 px-2 py-1 font-bold">Tentar novamente</button>
                      </div>:notesPreviewLoading?
                        <p role="status" className="text-[11px] text-slate-500">Carregando observações...</p>:
                        <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-700">
                          {notesPreviewText.trim()||'Sem observações registradas.'}
                        </p>}
                    </div>}
                    <div className="mt-2 flex gap-1.5 border-t border-slate-100 pt-2">
                      <button type="button" disabled={!callEnabled(lead,'phone')}
                        onClick={()=>recordAttempt(lead,'phone','no_decisor')} aria-label={'Contabilizar ligação pela operadora para '+lead.name}
                        className="flex flex-1 items-center justify-center gap-1 rounded-md border py-1.5 text-[10px] font-bold text-slate-700 disabled:opacity-40"><Phone size={12}/> Operadora {a.phone}</button>
                      <button type="button" disabled={!callEnabled(lead,'whatsapp_call')}
                        onClick={()=>recordAttempt(lead,'whatsapp_call','no_decisor')} aria-label={'Contabilizar ligação pelo WhatsApp para '+lead.name}
                        className="flex flex-1 items-center justify-center gap-1 rounded-md border py-1.5 text-[10px] font-bold text-emerald-700 disabled:opacity-40"><MessageCircle size={12}/> WhatsApp {a.whatsapp}</button>
                      <button onClick={()=>openCard(lead.id)} className="flex-1 rounded-md bg-slate-900 py-1.5 text-[10px] font-bold text-white">Detalhes</button>
                    </div>
                  </article>;
                })}
              </div>
            </div>;
          })}
          <div className="flex w-[104px] min-w-[104px] items-start justify-center pt-3">
            <button type="button" aria-label="Adicionar coluna" title="Adicionar coluna" disabled={busy}
              onClick={()=>{setDraftTitle('Nova etapa');setDraftColor(DEFAULT_COLORS[5]);setEditingId('new');}}
              className="flex w-[88px] flex-col items-center gap-2 rounded-xl border-2 border-dashed border-violet-300 bg-white px-2 py-5 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-40">
              <Plus size={20}/> Coluna
            </button>
          </div>
        </div>
      </div>

      {acquisitionDialog&&<div role="dialog" aria-modal="true"
        aria-label="Selecionar canais de aquisição"
        className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/60 p-4"
        onMouseDown={e=>{if(e.target===e.currentTarget&&!savingAcquisition)setAcquisitionDialog(null);}}>
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
          <h3 className="text-lg font-black">De onde veio esta oportunidade?</h3>
          <p className="mt-1 text-xs text-slate-600">
            Marque uma ou várias origens. As alterações só serão salvas ao confirmar.
          </p>
          <fieldset className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border p-3">
            <legend className="px-1 text-xs font-bold text-slate-700">Canais de aquisição</legend>
            {acquisitionChannels.map(channel=>{
              const checked=acquisitionDialog.channelIds.includes(channel.id);
              return <label key={channel.id} className={'flex items-center gap-3 rounded-lg px-2 py-2 text-sm '+(!channel.is_active?'bg-slate-50 text-slate-500':'hover:bg-indigo-50')}>
                <input type="checkbox" checked={checked} disabled={savingAcquisition||(!channel.is_active&&!checked)}
                  onChange={e=>{
                    setAcquisitionDialog(prev=>prev?{...prev,channelIds:e.target.checked?
                      [...prev.channelIds,channel.id]:prev.channelIds.filter(id=>id!==channel.id)}:prev);
                    delete keysRef.current['acquisition:'+acquisitionDialog.leadId];
                  }} className="h-4 w-4 accent-indigo-700"/>
                <span>{channel.name}{!channel.is_active&&<span className="ml-1 text-[11px]">(histórico)</span>}</span>
              </label>;
            })}
            {acquisitionChannels.length===0&&<p className="text-xs text-slate-500">Nenhum canal cadastrado. Use “Canais + Resultados”.</p>}
          </fieldset>
          {feedbackFor(acquisitionDialog.leadId)?.error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{feedbackFor(acquisitionDialog.leadId)?.error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={savingAcquisition} onClick={()=>{setAcquisitionDialog(null);setError(null);}}
              className="rounded-lg border px-4 py-2 text-xs font-semibold">Cancelar</button>
            <button type="button" disabled={savingAcquisition||acquisitionDialog.channelIds.length>20}
              onClick={()=>void saveAcquisition()}
              className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
              {savingAcquisition?'Salvando...':'Salvar canais'}
            </button>
          </div>
        </div>
      </div>}

      {attemptDialog&&<div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/60 p-4"
        role="dialog" aria-modal="true" aria-label={attemptDialog.attemptId?'Editar data e hora da tentativa':'Registrar data e hora da tentativa'}
        onMouseDown={e=>{if(e.target===e.currentTarget&&!busyLead)setAttemptDialog(null);}}>
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-black">{attemptDialog.attemptId?'Editar tentativa':'Registrar tentativa'}</h3>
            <button type="button" aria-label="Fechar horário da tentativa" disabled={Boolean(busyLead)}
              onClick={()=>{setAttemptDialog(null);setError(null);}}><X size={20}/></button>
          </div>
          <p className="mt-2 text-xs text-slate-600">{attemptDialog.channel==='phone'?'Ligação operadora':'Ligação WhatsApp'} · O horário só será registrado em Salvar.</p>
          <label className="mt-4 block text-xs font-bold text-slate-700">
            Data e hora reais da tentativa (Brasília)
            <input autoFocus type="datetime-local" value={attemptDialog.localAt}
              onChange={e=>{
                setAttemptDialog(d=>d?{...d,localAt:e.target.value}:d);
                delete keysRef.current['attempt-time:'+attemptDialog.leadId+':'+(attemptDialog.attemptId||'new')];
              }}
              className="mt-2 block w-full rounded-lg border border-slate-200 bg-white p-3 text-sm"/>
          </label>
          {attemptDialog.attemptId?
            <p className="mt-3 text-xs text-slate-600">Fluxo histórico: {scriptLabel(attempts.find(a=>a.id===attemptDialog.attemptId)?.script_version_id)}</p>:
            <div className="mt-3">{scriptSelect(attemptDialog.scriptVersionId,id=>{
              setAttemptDialog(d=>d?{...d,scriptVersionId:id}:d);
              delete keysRef.current['attempt-time:'+attemptDialog.leadId+':new'];
            })}</div>}
          <button type="button" disabled={Boolean(busyLead)} onClick={()=>{
            setAttemptDialog(d=>d?{...d,localAt:brazilLocalInput(new Date().toISOString())}:d);
            delete keysRef.current['attempt-time:'+attemptDialog.leadId+':'+(attemptDialog.attemptId||'new')];
          }} className="mt-2 rounded-lg border border-violet-200 px-3 py-2 text-xs font-bold text-violet-700">
            Usar horário atual
          </button>
          <p className="mt-2 text-xs text-slate-500">Registre a data e hora reais da tentativa, inclusive se houve outra ligação no mesmo dia ou fora do expediente. A cadência é apenas sugestão.</p>
          {feedbackFor(attemptDialog.leadId)?.error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{feedbackFor(attemptDialog.leadId)?.error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={Boolean(busyLead)}
              onClick={()=>{setAttemptDialog(null);setError(null);}}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancelar</button>
            <button type="button" disabled={Boolean(busyLead)||!attemptDialog.localAt}
              onClick={()=>void saveAttemptTime()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              {busyLead?'Salvando...':attemptDialog.attemptId?'Salvar alteração':'Salvar tentativa'}
            </button>
          </div>
        </div>
      </div>}

      {lossDialog&&<div className="fixed inset-0 z-[195] flex items-center justify-center bg-slate-950/60 p-4"
        role="dialog" aria-modal="true" aria-label="Selecionar motivo da perda">
        <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
          <h3 className="text-base font-black">Por que a oportunidade foi perdida?</h3>
          <p className="mt-1 text-xs text-slate-600">O motivo é obrigatório. Só o botão Salvar confirma a perda ou altera a justificativa.</p>
          <select aria-label="Motivo da perda" value={lossReasonDraft} onChange={e=>setLossReasonDraft(e.target.value)}
            className="mt-4 w-full rounded-lg border border-slate-300 p-3 text-sm">
            <option value="">Selecione um motivo</option>
            {lossReasons.filter(r=>r.is_active).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
            <label className="block text-xs font-bold text-violet-900">
              Não encontrou o motivo? Cadastre aqui
              <input type="text" maxLength={100} value={inlineLossName} disabled={inlineLossBusy||Boolean(busyLead)}
                onChange={e=>{setInlineLossName(e.target.value);setInlineLossError(null);}}
                placeholder="Ex.: Sem orçamento disponível"
                className="mt-2 block w-full rounded-lg border border-violet-200 bg-white p-2.5 text-sm font-normal"/>
            </label>
            <button type="button" disabled={inlineLossBusy||Boolean(busyLead)||inlineLossName.trim().length<2}
              onClick={()=>void createInlineLossReason()}
              className="mt-2 rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
              {inlineLossBusy?'Salvando motivo…':'Salvar motivo e selecionar'}
            </button>
            <p className="mt-2 text-[11px] text-slate-600">O motivo será incluído no catálogo e selecionado automaticamente. A oportunidade só será marcada como perdida ao clicar em Salvar perda.</p>
            {inlineLossError&&<p role="alert" className="mt-2 text-xs text-red-700">{inlineLossError}</p>}
          </div>
          {lossCatalogUnavailable&&<p role="alert" className="mt-2 text-xs text-red-700">Não foi possível carregar os motivos existentes. Você pode tentar cadastrar um novo motivo.</p>}
          {!lossReasons.some(r=>r.is_active)&&!lossCatalogUnavailable&&<p className="mt-2 text-xs text-amber-700">Nenhum motivo cadastrado. Crie o primeiro motivo acima.</p>}
          {error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={()=>{setLossDialog(null);setError(null);}} disabled={Boolean(busyLead)||inlineLossBusy}
              className="rounded-lg border px-4 py-2 text-xs font-bold">Cancelar</button>
            <button type="button" onClick={()=>void saveLoss()}
              disabled={Boolean(busyLead)||inlineLossBusy||Boolean(inlineLossName.trim())||!lossReasons.some(r=>r.id===lossReasonDraft&&r.is_active)}
              className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
              {busyLead?'Salvando…':'Salvar perda'}
            </button>
          </div>
        </div>
      </div>}
      {creatingOpen&&<div className="fixed inset-0 z-[155] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="Cadastrar oportunidades">
        <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
          <div className="flex shrink-0 items-center justify-between"><h3 className="text-lg font-black">Novas oportunidades e canais de aquisição</h3>
            <button type="button" disabled={creatingBusy} onClick={()=>setCreatingOpen(false)} aria-label="Fechar cadastro"><X size={20}/></button></div>
          <p className="mt-2 shrink-0 text-sm text-slate-600">Informe os dados da primeira oportunidade e até 100 números com DDD. Para outros telefones, os dados podem ser personalizados por contato.</p>
          {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <fieldset className="mb-4 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
              <legend className="px-1 text-xs font-bold text-violet-950">Dados da primeira oportunidade</legend>
              <p className="mb-3 text-[11px] text-slate-600">Identificação opcional do primeiro telefone. Os demais telefones podem ter dados próprios abaixo.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  ['name','Nome do contato',180],['clinicName','Nome da clínica',180],['email','E-mail (opcional)',254],
                ] as const).map(([field,title,limit])=><label key={field} className="block text-xs font-bold text-slate-700">{title}
                  <input type={field==='email'?'email':'text'} maxLength={limit}
                    value={firstCreationContact[field]} disabled={creatingBusy}
                    onChange={e=>{setFirstCreationContact(old=>({...old,[field]:e.target.value}));delete keysRef.current.create;}}
                    className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:border-violet-500" />
                </label>)}
              </div>
            </fieldset>
            <label className="block text-xs font-bold text-slate-700">Telefones (até 100 por cadastro)
              <textarea autoFocus rows={4} maxLength={5000} disabled={creatingBusy} value={phonesDraft}
                onChange={e=>{
                  const text=e.target.value;
                  const previousPhones=splitOpportunityPhones(phonesDraft);
                  const nextPhones=splitOpportunityPhones(text);
                  setAdditionalCreationContacts(old=>{
                    const next:Record<number,{name:string;clinicName:string;email:string}>={};
                    nextPhones.forEach((phone,index)=>{
                      if(index===0)return;
                      const previousIndex=previousPhones.findIndex((value,i)=>i>0&&value===phone);
                      if(previousIndex>0&&old[previousIndex])next[index]=old[previousIndex];
                    });
                    return next;
                  });
                  setPhonesDraft(text);
                  const count=text.split(/[\n,;]+/).map(v=>v.trim()).filter(Boolean).length;
                  setBulkSelectedRows(Array.from({length:Math.min(count,100)},(_,i)=>i));
                  setBulkChannelsByRow({});
                  delete keysRef.current.create;
                }}
                placeholder={'11 99999-9999\n21 98888-8888'}
                className="mt-2 w-full rounded-lg border border-slate-200 p-3 font-mono text-sm focus:border-violet-500"/>
            </label>
            <p className="mt-1 text-xs text-slate-500">Separe por linha, vírgula ou ponto e vírgula. A verificação consulta todo o cadastro, não apenas os cards carregados.</p>
            {bulkPhones.length>0&&<div role="status" aria-live="polite" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
              {bulkPhones.length>100?'Máximo de 100 telefones por cadastro.':
                duplicateCheck?.draft===phonesDraft&&duplicateCheck.error?
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Não foi possível verificar duplicidades: {duplicateCheck.error}</span>
                  <button type="button" onClick={()=>setDuplicateCheckRetry(v=>v+1)} className="font-bold underline">Tentar novamente</button>
                </div>:
                !checkedDuplicates?'Verificando telefones existentes…':
                blockedByDuplicate?
                  <strong>{checkedDuplicates.filter(item=>item.invalid||item.inBatch||item.existing).length} número(s) exigem revisão. Corrija ou remova os repetidos para salvar.</strong>:
                  <span className="font-semibold text-emerald-800">Nenhum telefone repetido encontrado no cadastro ou neste lote.</span>}
            </div>}
            {bulkPhones.length>0&&<div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-xs text-indigo-950">{bulkPhones.length} contato(s) · {bulkSelectedRows.length} selecionado(s)</strong>
                <div className="flex gap-2">
                  <button type="button" disabled={creatingBusy}
                    onClick={()=>setBulkSelectedRows(bulkPhones.map((_,i)=>i))}
                    className="rounded-lg border bg-white px-2 py-1.5 text-xs font-semibold">Selecionar todos</button>
                  <button type="button" disabled={creatingBusy} onClick={()=>setBulkSelectedRows([])}
                    className="rounded-lg border bg-white px-2 py-1.5 text-xs font-semibold">Desmarcar todos</button>
                </div>
              </div>
              <fieldset className="mt-3 rounded-lg border border-indigo-100 bg-white p-3">
                <legend className="px-1 text-xs font-bold text-indigo-950">Canais a aplicar aos selecionados</legend>
                {acquisitionChannels.filter(ch=>ch.is_active).map(channel=><label key={channel.id}
                  className="mr-4 inline-flex items-center gap-1.5 py-1 text-xs">
                  <input type="checkbox" disabled={creatingBusy} checked={bulkChannelsToApply.includes(channel.id)}
                    onChange={e=>setBulkChannelsToApply(old=>e.target.checked?[...old,channel.id]:old.filter(id=>id!==channel.id))}
                    className="h-4 w-4 accent-indigo-700"/>
                  {channel.name}
                </label>)}
                {!acquisitionChannels.some(ch=>ch.is_active)&&
                  <p className="text-xs text-slate-600">Cadastre canais antes pelo botão “Canais + Resultados” no Kanban.</p>}
              </fieldset>
              <button type="button" disabled={creatingBusy||!bulkSelectedRows.length||acquisitionCatalogUnavailable}
                onClick={applyBulkChannels}
                className="mt-2 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
                Aplicar canais aos {bulkSelectedRows.length} selecionados
              </button>
              <p className="mt-2 text-[11px] text-slate-600">
                Depois de aplicar, você pode ajustar individualmente cada número.
                Os contatos desmarcados não serão alterados.
              </p>
              <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
                {bulkPhones.slice(0,100).map((phone,index)=><div key={index}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" aria-label={'Selecionar contato '+(index+1)}
                      disabled={creatingBusy} checked={bulkSelectedRows.includes(index)}
                      onChange={e=>setBulkSelectedRows(old=>e.target.checked?
                        [...old,index]:old.filter(i=>i!==index))}
                      className="h-4 w-4 accent-indigo-700"/>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{index+1}. {phone}</span>
                    {checkedDuplicates?.[index]?.invalid&&<span className="text-[11px] font-bold text-red-700">Inválido</span>}
                    {checkedDuplicates?.[index]?.inBatch&&<span className="text-[11px] font-bold text-amber-700">Repetido no lote</span>}
                    {checkedDuplicates?.[index]?.existing&&<span className="text-[11px] font-bold text-red-700">Já cadastrado</span>}
                    <span className="max-w-[48%] truncate text-[11px] text-indigo-700">
                      {(bulkChannelsByRow[index]||[]).map(id=>acquisitionChannels.find(c=>c.id===id)?.name||'Canal histórico').join(', ')||'Sem canal'}
                    </span>
                  </div>
                  {checkedDuplicates?.[index]?.existing&&<p className="mt-1 pl-6 text-[11px] text-red-800">
                    Cadastro existente: {checkedDuplicates[index].existing?.name||'Sem nome'} · {checkedDuplicates[index].existing?.phone||phone} ·
                    {' '+(SALES_LEAD_STATUS_LABELS[checkedDuplicates[index].existing!.status as SalesLeadStatus]||checkedDuplicates[index].existing?.status)}
                    {leads.some(lead=>lead.id===checkedDuplicates[index].existing?.id)&&<button type="button" className="ml-2 font-bold underline"
                      onClick={()=>{const existingId=checkedDuplicates[index].existing!.id;setCreatingOpen(false);openCard(existingId);}}>Abrir card</button>}
                  </p>}
                  {index>0&&<details className="mt-2 pl-6 text-xs">
                    <summary className="cursor-pointer font-semibold text-violet-700">Dados deste contato (nome, clínica e e-mail)</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {([
                        ['name','Nome do contato',180],['clinicName','Nome da clínica',180],['email','E-mail (opcional)',254],
                      ] as const).map(([field,title,limit])=><label key={field} className="text-xs font-bold text-slate-700">{title}
                        <input type={field==='email'?'email':'text'} maxLength={limit}
                          value={(additionalCreationContacts[index]||{name:'',clinicName:'',email:''})[field]}
                          disabled={creatingBusy}
                          onChange={e=>{
                            setAdditionalCreationContacts(old=>({
                              ...old,[index]:{name:'',clinicName:'',email:'',...old[index],[field]:e.target.value},
                            }));
                            delete keysRef.current.create;
                          }}
                          className="mt-1 block w-full rounded-lg border border-slate-200 p-2 text-sm" />
                      </label>)}
                    </div>
                  </details>}
                  <details className="mt-1 pl-6 text-xs">
                    <summary className="cursor-pointer font-semibold text-violet-700">Editar canais deste contato</summary>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                      {acquisitionChannels.filter(ch=>ch.is_active).map(channel=><label key={channel.id}
                        className="inline-flex items-center gap-1.5">
                        <input type="checkbox" disabled={creatingBusy}
                          checked={(bulkChannelsByRow[index]||[]).includes(channel.id)}
                          onChange={e=>{
                            setBulkChannelsByRow(old=>{
                              const current=old[index]||[];
                              return {...old,[index]:e.target.checked?[...current,channel.id]:current.filter(id=>id!==channel.id)};
                            });
                            delete keysRef.current.create;
                          }}
                          className="h-4 w-4 accent-indigo-700"/>
                        {channel.name}
                      </label>)}
                    </div>
                  </details>
                </div>)}
              </div>
            </div>}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={creatingBusy} onClick={()=>setCreatingOpen(false)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
            <button type="button" disabled={creatingBusy||!phonesDraft.trim()||!checkedDuplicates||checkedDuplicates.length!==bulkPhones.length||blockedByDuplicate} onClick={()=>void createOpportunities()}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Check size={15}/> {creatingBusy?'Salvando...':'Salvar oportunidades'}</button>
          </div>
        </div>
      </div>}

      {editingId&&<div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label="Configurar coluna">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex items-center justify-between"><h3 className="text-lg font-black">{editingId==='new'?'Criar coluna':'Personalizar coluna'}</h3><button onClick={()=>setEditingId(null)} aria-label="Fechar"><X size={20}/></button></div>
          <label className="mt-5 block text-xs font-bold">Título da coluna
            <input maxLength={60} value={draftTitle} onChange={e=>setDraftTitle(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm" autoFocus />
          </label>
          <label className="mt-4 block text-xs font-bold">Cor da coluna
            <div className="mt-2 flex items-center gap-3"><input type="color" value={draftColor} onChange={e=>setDraftColor(e.target.value)}
              aria-label="Escolher cor da coluna" className="h-11 w-16 cursor-pointer"/>
              <span className="text-xs text-slate-500">{draftColor}</span></div>
          </label>
          <div className="mt-3 flex flex-wrap gap-1.5">{DEFAULT_COLORS.map(hex=><button key={hex} title={hex} aria-label={'Cor '+hex} onClick={()=>setDraftColor(hex)}
            className="h-8 w-8 rounded-md border-2" style={{backgroundColor:hex,borderColor:draftColor===hex?'#111827':'transparent'}}/>)}</div>
          {editingColumn&&<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <span className="mr-auto text-xs font-bold text-slate-700">Ordem da coluna</span>
            <button type="button" aria-label="Mover coluna para a esquerda" disabled={busy||editingColumnIndex===0}
              onClick={()=>reorder(editingColumn.id,-1)}
              className="rounded-lg border border-slate-200 p-2 disabled:opacity-30"><ChevronLeft size={16}/></button>
            <button type="button" aria-label="Mover coluna para a direita" disabled={busy||editingColumnIndex===columns.length-1}
              onClick={()=>reorder(editingColumn.id,1)}
              className="rounded-lg border border-slate-200 p-2 disabled:opacity-30"><ChevronRight size={16}/></button>
            {!editingColumn.is_system&&<button type="button" title="Excluir etapa personalizada" disabled={busy}
              onClick={()=>deleteColumn(editingColumn)}
              className="rounded-lg border border-red-200 px-2 py-2 text-xs font-bold text-red-700 disabled:opacity-40"><Trash2 size={14}/> Excluir</button>}
          </div>}
          <div className="mt-6 flex justify-end gap-2"><button className="rounded-lg border px-4 py-2 text-sm" onClick={()=>setEditingId(null)}>Cancelar</button>
            <button disabled={busy||!draftTitle.trim()} onClick={saveColumn} className="flex items-center gap-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Check size={15}/> Salvar</button></div>
        </div>
      </div>}

      {selected&&<div className="fixed inset-0 z-[145] flex justify-end bg-slate-950/50" role="dialog" aria-modal="true" aria-label={'Detalhes de '+selected.name} onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedId(null);}}>
        <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-white p-5">
            <div className="min-w-0"><p className="text-[11px] font-bold uppercase text-violet-600">Ficha de prospecção</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">{selected.name||'Lead sem nome'}</h3>
              <p className="text-xs text-slate-500">{selected.clinicName||'Clínica não informada'}</p></div>
            <button type="button" onClick={()=>setSelectedId(null)} aria-label="Fechar detalhes" className="rounded-lg border p-2"><X size={18}/></button>
          </div>
          <div className="space-y-5 p-5">
            {feedbackFor(selected.id)?.error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{feedbackFor(selected.id)?.error}</p>}
            {feedbackFor(selected.id)?.info&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">{feedbackFor(selected.id)?.info}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={savingLead||deletingLead||Boolean(busyLead)}
                onClick={()=>void deleteLead(selected)}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40"><Trash2 size={14}/> {deletingLead?'Excluindo...':'Excluir oportunidade'}</button>
            </div>
            {referralsByLead[selected.id]&&<section aria-label="Indicação do parceiro" className="rounded-xl border border-violet-200 bg-violet-50 p-4">
              <h4 className="text-sm font-bold text-violet-900">Canal de aquisição: Indicação</h4>
              <p className="mt-2 break-words text-sm text-slate-800">Parceiro: <strong>{referralsByLead[selected.id].partnerName}</strong></p>
              {referralsByLead[selected.id].couponCode
                ? <p className="mt-1 break-all text-sm text-slate-800">Cupom informado: <strong>{referralsByLead[selected.id].couponCode}</strong></p>
                : referralsByLead[selected.id].partnerCouponCode
                  ? <>
                    <p className="mt-1 break-all text-sm text-slate-800">Cupom atual do parceiro: <strong>{referralsByLead[selected.id].partnerCouponCode}</strong></p>
                    <p className="mt-1 text-xs text-slate-600">O código utilizado na inscrição anterior não ficou registrado; este é o cupom atual do parceiro.</p>
                  </>
                  : <p className="mt-1 text-xs text-slate-600">O cupom informado não foi registrado nesta indicação.</p>}
            </section>}
            <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-black text-violet-900">Dados da oportunidade e observações</h4>
                {loadingLeadDetails&&<span role="status" className="text-[11px] text-violet-700">Carregando...</span>}
              </div>
              {leadDetailsError&&<button type="button" onClick={()=>{setCardFeedback(null);setLeadReload(n=>n+1);}}
                className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700">Tentar carregar novamente</button>}
              <p className="text-xs text-slate-600">Em oportunidades vinculadas a propostas, clientes ou contatos duplicados, estas alterações são exclusivas da ficha do Kanban.</p>
              {([
                ['name','Nome / identificação',180],['phone','Telefone com DDD',40],
                ['clinicName','Nome da clínica',180],['email','E-mail (opcional)',254],
              ] as const).map(([field,title,limit])=><label key={field} className="block text-xs font-bold text-slate-700">{title}
                <input value={leadDraft[field]} maxLength={limit} disabled={savingLead||loadingLeadDetails||leadDetailsError}
                  onChange={e=>{setLeadDraft(d=>({...d,[field]:e.target.value}));delete keysRef.current['edit:'+selected.id];}}
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm"/>
              </label>)}
              <label className="block text-xs font-bold text-slate-700">Observações
                <textarea rows={3} maxLength={1500} value={leadDraft.notes} disabled={savingLead||loadingLeadDetails||leadDetailsError}
                  onChange={e=>{setLeadDraft(d=>({...d,notes:e.target.value}));delete keysRef.current['edit:'+selected.id];}}
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm"/>
              </label>
              <button type="button" disabled={savingLead||loadingLeadDetails||leadDetailsError||!leadDraft.name.trim()||!leadDraft.phone.trim()}
                onClick={()=>void saveLeadDetails()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 p-3 text-sm font-black text-white disabled:opacity-40"><Check size={16}/> {savingLead?'Salvando...':'Salvar alterações'}</button>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
              <fieldset disabled={savingAcquisition||acquisitionCatalogUnavailable}>
                <legend className="text-xs font-black text-indigo-900">Canais de aquisição</legend>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {acquisitionChannels.map(channel=><label key={channel.id} className="inline-flex items-center gap-2 text-xs text-indigo-950">
                    <input type="checkbox" checked={inlineChannelIds.includes(channel.id)}
                      disabled={!channel.is_active&&!inlineChannelIds.includes(channel.id)}
                      onChange={e=>{
                        setInlineChannelIds(old=>e.target.checked?[...old,channel.id]:old.filter(id=>id!==channel.id));
                        delete keysRef.current['acquisition:'+selected.id];
                      }}
                      className="h-4 w-4 accent-indigo-700"/>{channel.name}
                  </label>)}
                </div>
              </fieldset>
              {acquisitionCatalogUnavailable&&<p role="alert" className="mt-2 text-xs text-amber-800">Canais indisponíveis. Atualize o quadro para editar.</p>}
              {acquisitionChannels.length===0&&<p className="mt-2 text-xs text-slate-600">Nenhum canal cadastrado. Use “Canais + Resultados”.</p>}
              <button type="button" disabled={savingAcquisition||acquisitionCatalogUnavailable||
                [...inlineChannelIds].sort().join(',')===[...(acquisitionByLead[selected.id]||[])].sort().join(',')}
                onClick={()=>void saveAcquisition({leadId:selected.id,channelIds:inlineChannelIds})}
                className="mt-3 w-full rounded-lg bg-indigo-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">
                {savingAcquisition?'Salvando...':'Salvar canais'}
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={!callEnabled(selected,'phone')} onClick={()=>recordAttempt(selected,'phone','no_decisor')}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-3 text-xs font-bold disabled:opacity-40"><Phone size={16}/> Contabilizar operadora</button>
              <button type="button" disabled={!callEnabled(selected,'whatsapp_call')} onClick={()=>recordAttempt(selected,'whatsapp_call','no_decisor')}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-xs font-bold text-green-700 disabled:opacity-40"><MessageCircle size={16}/> Contabilizar WhatsApp</button>
            </div>
            <div><label className="block text-xs font-bold text-slate-700">Mover para a coluna</label>
              <select aria-label="Mudar etapa do lead" value={columnFor(selected)||''} disabled={Boolean(busyLead)||selected.status==='converted'}
                onChange={e=>{const col=columns.find(x=>x.id===e.target.value);if(col)moveLead(selected,col);}}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm">
                {columns.map(c=><option key={c.id} value={c.id} disabled={c.kind==='customers'}>{c.title}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">Movimentos salvos no histórico, sem atualizar a página. Cliente convertido só muda por pagamento confirmado.</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between"><h4 className="font-black">Cadência de ligações</h4><span className="text-sm font-black">{selectedCounts.phone+selectedCounts.whatsapp} ligações</span></div>
              <div role="progressbar" aria-label="Progresso das tentativas de ligação"
                aria-valuemin={0} aria-valuemax={10}
                aria-valuenow={Math.min(10,selectedCounts.phone+selectedCounts.whatsapp)}
                className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full transition-all duration-300"
                  style={{width:progressWidth(selectedCounts.phone+selectedCounts.whatsapp),
                    backgroundColor:progressColor(selectedCounts.phone+selectedCounts.whatsapp)}}/>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-blue-50 p-3"><span className="block text-blue-700">Operadora</span><b className="text-lg">{selectedCounts.phone}</b></div>
                <div className="rounded-lg bg-emerald-50 p-3"><span className="block text-emerald-700">Ligação WhatsApp</span><b className="text-lg">{selectedCounts.whatsapp}</b></div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">Os botões funcionam em todas as etapas, inclusive após contato e conversão. Horários sugeridos não bloqueiam registros reais. A preferência explícita de não contato e a exclusão do lead continuam protegidas.</p>
              {!selectedCounts.spoken&&!['lost','archived','converted'].includes(selected.status)&&historyReady&&
                <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs">
                  <h5 className="font-bold text-violet-800">Próximas ligações sugeridas — intervalo mínimo de 2 dias, sem fins de semana</h5>
                  <ol className="mt-2 grid grid-cols-2 gap-1.5 text-violet-800">
                    {nextSalesCadenceSlots(leadAttemptDates(selected.id)).map((date,i)=>(
                      <li key={date.toISOString()}>{selectedCounts.phone+selectedCounts.whatsapp+i+1}ª · {slotLabel(date)}</li>
                    ))}
                  </ol>
                  <p className="mt-2 text-[11px] text-slate-600">
                    Sugestões baseadas na alternância entre manhã e tarde e nos horários de tentativas anteriores sem resposta.
                    Não são previsão garantida de atendimento, agendamentos ou notificações. A data da ligação real
                    continua livre e só é registrada após Salvar.
                  </p>
                </div>}
              {<div className="mt-3 space-y-2">
                <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <label className="block text-xs font-bold text-emerald-800">Data e hora do contato efetivo com o decisor (Brasília)
                    <input type="datetime-local" value={spokenAtDraft}
                      onChange={e=>{setSpokenAtDraft(e.target.value);delete keysRef.current['decisor:'+selected.id+':new'];}}
                      className="mt-1 block w-full rounded-lg border border-emerald-200 bg-white p-2 text-sm"/>
                  </label>
                  <div role="group" aria-label="Origem do contato com decisor" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {([
                      {channel:'phone',label:'Ligação operadora'},
                      {channel:'whatsapp_call',label:'Ligação WhatsApp'},
                      {channel:'whatsapp_message',label:'Mensagem WhatsApp'},
                    ] as const).map(item=>
                      <button key={item.channel} type="button" aria-pressed={spokenChannel===item.channel}
                        onClick={()=>{setSpokenChannel(item.channel);delete keysRef.current['decisor:'+selected.id+':new'];}}
                        className={'rounded-lg border px-2 py-2.5 text-xs font-bold transition-colors '+(spokenChannel===item.channel
                          ? 'border-emerald-700 bg-emerald-700 text-white'
                          : 'border-emerald-200 bg-white text-emerald-900 hover:border-emerald-500')}>
                        {item.label}
                      </button>)}
                  </div>
                  {scriptSelect(selectedScriptId,id=>{setSelectedScriptId(id);delete keysRef.current['decisor:'+selected.id+':new'];})}
                  <fieldset className="rounded-lg border border-emerald-200 bg-white p-2.5">
                    <legend className="px-1 text-xs font-bold text-emerald-800">Resultado da conversa</legend>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {([{value:'interested',label:'Demonstrou interesse'},
                         {value:'not_interested',label:'Não demonstrou interesse'}] as const).map(item=>
                        <label key={item.value} className="flex items-center gap-1.5 text-xs">
                          <input type="radio" name="sales-decisor-interest" value={item.value}
                            checked={contactResult===item.value}
                            onChange={()=>{setContactResult(item.value);delete keysRef.current['decisor:'+selected.id+':new'];}}/>
                          {item.label}
                        </label>)}
                    </div>
                  </fieldset>
                  <button disabled={Boolean(busyLead)||!spokenAtDraft}
                    onClick={()=>void saveSpokenContact(selected)}
                    className="w-full rounded-lg bg-emerald-600 p-3 text-xs font-bold text-white disabled:opacity-40">
                    Salvar contato com decisor
                  </button>
                  <p className="text-[11px] text-emerald-900">
                    Marque Mensagem WhatsApp somente quando houver conversa efetiva com o decisor, não apenas envio ou leitura.
                    A mensagem não consome tentativa de ligação. O registro só é persistido em Salvar.
                  </p>
                </div>
              </div>}
              {selectedCounts.spoken&&<p className="mt-3 rounded-lg bg-green-50 p-2 text-xs font-bold text-green-700">Conversa efetiva com o decisor registrada por {selectedCounts.spokenVia==='whatsapp_message'?'mensagem WhatsApp':selectedCounts.spokenVia==='whatsapp_call'?'ligação WhatsApp':'ligação operadora'}.</p>}
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="font-black">Próximo retorno de contato</h4>
              <p className="mt-1 text-xs text-slate-600">Registre a data e a hora combinadas. Este campo não envia notificações.</p>
              {followups[selected.id]?.status==='scheduled'&&
                <p className="mt-2 rounded-lg bg-violet-50 p-2 text-xs font-bold text-violet-800">
                  Retorno agendado: {dateText(followups[selected.id].contact_due_at)}
                </p>}
              <label className="mt-3 block text-xs font-bold">Data e horário do retorno (Brasília)
                <input type="datetime-local" value={followupAtDraft}
                  onChange={e=>{setFollowupAtDraft(e.target.value);delete keysRef.current['followup:'+selected.id];}}
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm"/>
              </label>
              <div className="mt-3 flex gap-2">
                <button disabled={savingFollowup||!followupAtDraft} onClick={()=>void saveFollowup(selected)}
                  className="flex-1 rounded-lg bg-violet-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">
                  Salvar retorno
                </button>
                {followups[selected.id]?.status==='scheduled'&&
                  <button disabled={savingFollowup} onClick={()=>void saveFollowup(selected,true)}
                    className="rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold disabled:opacity-40">
                    Cancelar retorno
                  </button>}
              </div>
            </div>
            {selected.status==='lost'&&<p className="rounded-lg bg-red-50 p-3 text-xs font-bold text-red-700">Perdido em {dateText(selected.lostAt)} · {lossReasonLabel(selected)}</p>}
            {selected.status!=='converted'&&<button disabled={Boolean(busyLead)} onClick={()=>manualLost(selected)}
              className="w-full rounded-lg border border-red-200 p-3 text-xs font-bold text-red-700 disabled:opacity-40">
              {selected.status==='lost'?'Editar motivo de perda':'Marcar perdido · escolher motivo'}
            </button>}
            <button onClick={()=>{setSelectedId(null);onOpenLead(selected);}}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 p-3 text-sm font-black text-white">
              <ExternalLink size={16}/> Abrir proposta, rentabilidade e cadastro completo</button>
            <div className="border-t pt-4"><h4 className="mb-2 text-sm font-black">Histórico de ligações e mensagens</h4>
              {attempts.filter(a=>a.lead_id===selected.id).sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)).length===0&&<p className="text-xs text-slate-500">Nenhum contato registrado.</p>}
              {attempts.filter(a=>a.lead_id===selected.id).sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)).map(a=>
                <div key={a.id} className="border-b py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{a.channel==='phone'?'Ligação operadora':a.channel==='whatsapp_call'?'Ligação WhatsApp':'Mensagem WhatsApp'} · {a.contact_result==='interested'?'Interessado':a.contact_result==='not_interested'?'Sem interesse':a.outcome==='decisor_spoken'?'Decisor contatado':'Sem atendimento'}
                      <span className="block text-[11px] text-slate-500">{scriptLabel(a.script_version_id)}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <time className="text-slate-500">{dateText(a.occurred_at)}</time>
                      <button type="button" disabled={Boolean(busyLead)} onClick={()=>{
                        if(a.outcome==='decisor_spoken'){
                          setEditingSpokenId(a.id);setEditingSpokenAt(brazilLocalInput(a.occurred_at));
                        }else{
                          setAttemptDialog({leadId:selected.id,channel:a.channel as 'phone'|'whatsapp_call',
                            attemptId:a.id,localAt:brazilLocalInput(a.occurred_at),scriptVersionId:a.script_version_id||''});
                          setError(null);
                        }
                      }} className="text-xs font-semibold text-violet-700 underline disabled:opacity-40">
                        Editar horário
                      </button>
                    </div>
                  </div>
                  {editingSpokenId===a.id&&
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
                      <label className="text-xs">Data e hora (Brasília)
                        <input type="datetime-local" value={editingSpokenAt}
                          onChange={e=>{setEditingSpokenAt(e.target.value);delete keysRef.current['decisor:'+selected.id+':'+a.id];}}
                          className="mt-1 block rounded-lg border bg-white p-2"/>
                      </label>
                      <button type="button" disabled={Boolean(busyLead)||!editingSpokenAt}
                        onClick={()=>void saveSpokenContact(selected,a)}
                        className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Salvar alteração</button>
                      <button type="button" onClick={()=>setEditingSpokenId(null)}
                        className="rounded-lg border px-3 py-2 text-xs">Cancelar</button>
                    </div>}
                </div>)}
            </div>
          </div>
        </div>
      </div>}
    </section>
  );
};
