import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { CommercialDashboard } from './CommercialDashboard';
import { SALES_LEAD_STATUS_LABELS, type SalesLeadStatus } from '../constants/salesCommercial';

type Attempt = { lead_id: string; channel: 'phone' | 'whatsapp_call'; outcome: 'no_decisor' | 'decisor_spoken'; occurred_at: string };
type Lead = { id: string; name?: string; phone?: string; clinicName?: string; status: SalesLeadStatus; lostAt?: string | null; legacyReadOnly?: boolean };
type Props = {
  leads: Lead[];
  onStatusChange: (lead: Lead, status: SalesLeadStatus) => Promise<void>;
  onLeadPatch: (leadId: string, patch: Record<string, unknown>) => void;
};
const COLUMNS: { id: string; title: string; statuses: SalesLeadStatus[]; color: string }[] = [
  { id: 'prospecting', title: 'Prospecção', statuses: ['new'], color: 'border-slate-200 bg-slate-50' },
  { id: 'contact', title: 'Contato', statuses: ['contact_started'], color: 'border-blue-200 bg-blue-50' },
  { id: 'demo', title: 'Apresentações e propostas', statuses: ['demo_scheduled','demo_completed','proposal_preparing','proposal_sent','checkout_sent','checkout_opened','payment_pending'], color: 'border-green-200 bg-green-50' },
  { id: 'lost', title: 'Perdidos', statuses: ['lost','archived'], color: 'border-red-200 bg-red-50' },
  { id: 'customers', title: 'Clientes', statuses: ['converted'], color: 'border-violet-200 bg-violet-50' },
];

export const CommercialKanban = ({ leads, onStatusChange, onLeadPatch }: Props) => {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spokenChannel, setSpokenChannel] = useState<Record<string, 'phone' | 'whatsapp_call'>>({});
  const keysRef = useRef<Record<string, string>>({});
  const leadIds = useMemo(() => leads.filter((lead) => !lead.legacyReadOnly && /^[a-f0-9-]{36}$/i.test(lead.id)).map((lead) => lead.id), [leads]);
  const idsKey = leadIds.join(',');
  useEffect(() => {
    if (!idsKey) { setAttempts([]); return; }
    let live = true;
    setLoading(true);
    const load = async () => {
      try {
        const supabase = await getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch('/api/owner/sales/prospecting/attempts?leadIds=' + encodeURIComponent(idsKey), {
          headers: { Authorization: session?.access_token ? 'Bearer ' + session.access_token : '' },
        });
        const json = await response.json();
        if (!response.ok || !json.success) throw Error(json.error || 'Histórico indisponível.');
        if (live) {
          setAttempts(json.data || []);
          for (const item of json.leads || []) onLeadPatch(item.id, { lostAt: item.lost_at, status: item.status });
        }
      } catch (cause: any) {
        if (live) setError(cause?.message || 'Não foi possível carregar tentativas.');
      } finally { if (live) setLoading(false); }
    };
    void load();
    return () => { live = false; };
  }, [idsKey]);

  const summary = useMemo(() => {
    const map = new Map<string, { phone: number; whatsapp: number; spoke: boolean }>();
    for (const attempt of attempts) {
      const current = map.get(attempt.lead_id) || { phone: 0, whatsapp: 0, spoke: false };
      if (attempt.channel === 'phone') current.phone++;
      else current.whatsapp++;
      if (attempt.outcome === 'decisor_spoken') current.spoke = true;
      map.set(attempt.lead_id, current);
    }
    return map;
  }, [attempts]);

  const token = async () => {
    const client = await getSupabase();
    const { data: { session } } = await client.auth.getSession();
    return session?.access_token || '';
  };

  const saveAttempt = async (lead: Lead, channel: 'phone' | 'whatsapp_call', outcome: 'no_decisor' | 'decisor_spoken') => {
    if (busyId || lead.legacyReadOnly) return;
    const actionName = lead.id + ':' + channel + ':' + outcome;
    const key = keysRef.current[actionName] || crypto.randomUUID();
    keysRef.current[actionName] = key;
    setBusyId(lead.id);
    setError(null);
    try {
      const auth = await token();
      const response = await fetch('/api/owner/sales/leads/' + encodeURIComponent(lead.id) + '/prospecting-attempts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth ? 'Bearer ' + auth : '', 'X-Idempotency-Key': key },
        body: JSON.stringify({ channel, outcome }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw Error(json.error || 'Falha ao registrar ligação.');
      delete keysRef.current[actionName];
      // Re-read the count on the server response; no optimistic persistence and no F5.
      setAttempts((old) => json.data?.attemptId && !old.some((x: any) => x.id === json.data.attemptId)
        ? [...old, { id: json.data.attemptId, lead_id: lead.id, channel, outcome, occurred_at: json.data.occurredAt } as Attempt]
        : old);
      onLeadPatch(lead.id, { status: json.data.status, lostAt: json.data.lostAt, updatedAt: json.data.updatedAt });
    } catch (cause: any) {
      setError(cause?.message || 'Não foi possível salvar. Tente novamente.');
    } finally { setBusyId(null); }
  };

  const markLost = async (lead: Lead) => {
    if (busyId) return;
    const keyName = 'lost:' + lead.id;
    const key = keysRef.current[keyName] || crypto.randomUUID();
    keysRef.current[keyName] = key;
    setBusyId(lead.id);
    setError(null);
    try {
      const auth = await token();
      const response = await fetch('/api/owner/sales/leads/' + encodeURIComponent(lead.id) + '/mark-lost', {
        method: 'POST', headers: { Authorization: auth ? 'Bearer ' + auth : '', 'X-Idempotency-Key': key },
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw Error(json.error || 'Não foi possível marcar como perdido.');
      delete keysRef.current[keyName];
      onLeadPatch(lead.id, { status: json.data.status, lostAt: json.data.lostAt, updatedAt: json.data.updatedAt });
    } catch (cause: any) {
      setError(cause?.message || 'Falha ao salvar status.');
    } finally { setBusyId(null); }
  };

  const changeStatus = async (lead: Lead, status: SalesLeadStatus) => {
    if (status === lead.status || busyId) return;
    if (status === 'converted') { setError('A venda deve ser confirmada pelo pagamento, não pelo arrastar do card.'); return; }
    if (status === 'lost') await markLost(lead);
    else await onStatusChange(lead, status);
  };
  const selectableStatuses: { value: SalesLeadStatus; label: string }[] = [
    { value: 'new', label: 'Prospecção' }, { value: 'contact_started', label: 'Contato' },
    { value: 'demo_scheduled', label: 'Apresentação marcada' },
    { value: 'lost', label: 'Perdido' },
  ];
  return (
    <section className="space-y-3" aria-label="Kanban comercial">
      <CommercialDashboard attempts={attempts} visibleLeadCount={leadIds.length} />
      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-xs text-slate-500">Carregando histórico comercial…</p>}
      <div className="flex snap-x gap-4 overflow-x-auto pb-4" aria-label="Colunas do funil comercial">
        {COLUMNS.map((column) => (
          <div key={column.id}
            onDragOver={(e) => { if (column.id !== 'customers') e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              const lead = leads.find((x) => x.id === id);
              if (lead && column.id !== 'customers') void changeStatus(lead, column.statuses[0]);
            }}
            className={'w-[290px] shrink-0 snap-start rounded-2xl border p-3 ' + column.color}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">{column.title}</h3>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{leads.filter((x) => column.statuses.includes(x.status)).length}</span>
            </div>
            <div className="space-y-3">
              {leads.filter((x) => !x.legacyReadOnly && column.statuses.includes(x.status)).map((lead) => {
                const progress = summary.get(lead.id) || { phone: 0, whatsapp: 0, spoke: false };
                const total = progress.phone + progress.whatsapp;
                const disabled = Boolean(busyId) || progress.spoke || ['lost','converted','archived'].includes(lead.status);
                return (
                  <article key={lead.id} draggable={!busyId}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', lead.id)}
                    className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{lead.name || 'Lead sem nome'}</p>
                      <p className="mt-1 text-xs text-slate-600">{lead.clinicName || 'Clínica não informada'}</p>
                      <p className="text-xs text-slate-500">{lead.phone || 'Telefone não informado'}</p>
                    </div>
                    <label className="block text-xs text-slate-600">Status
                      <select aria-label={'Status de ' + lead.name} value={lead.status} disabled={Boolean(busyId) || lead.status === 'converted'}
                        onChange={(e) => void changeStatus(lead, e.target.value as SalesLeadStatus)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs">
                        {[...selectableStatuses, ...(selectableStatuses.some(x=>x.value===lead.status) ? [] : [{ value: lead.status, label: SALES_LEAD_STATUS_LABELS[lead.status] || lead.status }])].map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </label>
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>Tentativas {total}/10</span><span>{progress.spoke ? 'Decisor contatado' : 'Sem contato efetivo'}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" aria-label={total + ' de 10 tentativas'}>
                        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: Math.min(100,total * 10) + '%' }} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">Operadora {progress.phone}/5 · WhatsApp {progress.whatsapp}/5</p>
                    </div>
                    {!disabled && (
                      <div className="space-y-2">
                        <button disabled={progress.phone >= 5 || Boolean(busyId)}
                          onClick={() => void saveAttempt(lead, 'phone', 'no_decisor')}
                          className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs font-medium disabled:opacity-40">
                          Registrar ligação operadora sem decisor
                        </button>
                        <button disabled={progress.whatsapp >= 5 || Boolean(busyId)}
                          onClick={() => void saveAttempt(lead, 'whatsapp_call', 'no_decisor')}
                          className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs font-medium disabled:opacity-40">
                          Registrar ligação WhatsApp sem decisor
                        </button>
                        <div className="flex gap-2">
                          <select aria-label="Canal do contato com decisor"
                            value={spokenChannel[lead.id] || 'phone'}
                            onChange={(e) => setSpokenChannel((x) => ({ ...x, [lead.id]: e.target.value as 'phone' | 'whatsapp_call' }))}
                            className="w-24 rounded-lg border border-slate-200 p-1 text-xs">
                            <option value="phone">Operadora</option><option value="whatsapp_call">WhatsApp</option>
                          </select>
                          <button disabled={Boolean(busyId) || (spokenChannel[lead.id] === 'whatsapp_call' ? progress.whatsapp >= 5 : progress.phone >= 5)}
                            onClick={() => void saveAttempt(lead, spokenChannel[lead.id] || 'phone', 'decisor_spoken')}
                            className="flex-1 rounded-lg bg-emerald-600 px-2 py-2 text-xs font-semibold text-white disabled:opacity-40">
                            Falei com o decisor
                          </button>
                        </div>
                      </div>
                    )}
                    {lead.status === 'lost' && lead.lostAt &&
                      <p className="text-[11px] text-red-700">Perdido em {new Date(lead.lostAt).toLocaleString('pt-BR')}</p>}
                    <a href={'#sales-offer-' + lead.id} className="block text-center text-xs font-semibold text-violet-700 underline">Abrir proposta e detalhes</a>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
