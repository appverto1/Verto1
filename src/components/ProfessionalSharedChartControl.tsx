import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import { dataService } from '../services/dataService';
import { PatientSharedChartDelegationPanel } from './PatientSharedChartDelegationPanel';
import type { ClinicalPlanShareDescriptor } from './ClinicalPlanAnalyticsShell';
import type { AbaV3ShareDescriptor } from './AbaV3ClinicalChartPanel';

export type ProfessionalChartDescriptor = ClinicalPlanShareDescriptor | AbaV3ShareDescriptor;

const AVAILABLE_DOMAINS = [
  { id: 'skills', label: 'Habilidades' },
  { id: 'behaviors', label: 'Comportamentos interferentes' },
  { id: 'mastery', label: 'Maestria' },
  { id: 'maintenance', label: 'Manutenção' },
] as const;

type ShareDomain = typeof AVAILABLE_DOMAINS[number]['id'];

// The optional navigation allowlist does not change which chart is selected.
const chartIdentity = (chart: ProfessionalChartDescriptor | null): string => {
  if (!chart) return '';
  const { allowedDomains: _ignored, ...base } = chart as ProfessionalChartDescriptor & { allowedDomains?: ShareDomain[] };
  // The server normalizes JSON fields in a different insertion order from
  // the browser descriptor. Equality must be semantic, not key-order based.
  return JSON.stringify(Object.fromEntries(
    Object.entries(base).sort(([left], [right]) => left.localeCompare(right)),
  ));
};

export function ProfessionalSharedChartControl({
  patientId,
  descriptor,
  isDark = false,
}: {
  key?: React.Key;
  patientId: string;
  descriptor: ProfessionalChartDescriptor | null;
  isDark?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<ProfessionalChartDescriptor | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [governance, setGovernance] = useState({ canPublish: false, canDelegate: false });
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftClearAll, setDraftClearAll] = useState(false);
  const [draftDomains, setDraftDomains] = useState<ShareDomain[]>([]);
  const lastRequest = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++lastRequest.current;
    setLoading(true);
    setReady(false);
    setConfirmed(null);
    setGovernance({ canPublish: false, canDelegate: false });
    setError('');
    try {
      const response: any = await dataService.getPatientSharedChartSelection(patientId);
      if (lastRequest.current !== requestId) return;
      if (response?.success !== true) {
        setError('Não foi possível carregar o estado do compartilhamento.');
        return;
      }
      setConfirmed(response.data?.descriptor || null);
      setGovernance({
        canPublish: response.governance?.canPublish === true,
        canDelegate: response.governance?.canDelegate === true,
      });
      setReady(true);
    } catch {
      if (lastRequest.current === requestId) setError('Não foi possível carregar o compartilhamento.');
    } finally {
      if (lastRequest.current === requestId) setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void reload();
    return () => { lastRequest.current += 1; };
  }, [reload]);

  const selectedChartIdentity = chartIdentity(descriptor);
  const publishedChartIdentity = chartIdentity(confirmed);
  const activeMatchesCurrent = Boolean(selectedChartIdentity && publishedChartIdentity === selectedChartIdentity);
  const publishedDomains = confirmed?.family === 'PLAN_PTS' ? (confirmed.allowedDomains || []) : [];

  // Draft changes never write to the server. Switching chart/plan discards
  // uncommitted selections, while the one confirmed chart remains untouched.
  useEffect(() => {
    setDraftEnabled(activeMatchesCurrent);
    setDraftDomains(activeMatchesCurrent ? [...publishedDomains] : []);
    setDraftClearAll(false);
    setMessage('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChartIdentity, publishedChartIdentity, JSON.stringify(publishedDomains)]);

  const extraDomains = descriptor?.family === 'PLAN_PTS'
    ? AVAILABLE_DOMAINS.filter((domain) => domain.id !== descriptor.domain)
    : [];
  const normalizedDomains = draftDomains.filter((domain) => extraDomains.some((item) => item.id === domain));
  const permittedDomains = draftEnabled && !draftClearAll ? normalizedDomains : [];
  const domainsChanged = JSON.stringify([...permittedDomains].sort()) !== JSON.stringify([...publishedDomains].sort());
  const dirty = draftClearAll
    ? Boolean(confirmed)
    : draftEnabled
      ? Boolean(descriptor && (!activeMatchesCurrent || domainsChanged))
      : activeMatchesCurrent;

  const save = async () => {
    if (!ready || !governance.canPublish || busy || !dirty) return;
    const removing = draftClearAll || (!draftEnabled && activeMatchesCurrent);
    if (removing && !window.confirm('Retirar o gráfico do painel do paciente? Os registros clínicos permanecerão intactos.')) return;
    if (!removing && confirmed && !activeMatchesCurrent
      && !window.confirm('Substituir o gráfico compartilhado? O paciente passará a visualizar este no lugar do anterior.')) return;

    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (removing) {
        const result: any = await dataService.clearPatientSharedChartSelection(patientId);
        if (result?.success !== true) {
          setError('Não foi possível remover o compartilhamento.');
          return;
        }
        setConfirmed(null);
        setDraftEnabled(false);
        setDraftDomains([]);
        setDraftClearAll(false);
        setMessage('Nenhum gráfico publicado. Os dados clínicos foram preservados.');
      } else if (descriptor) {
        const nextDescriptor: ProfessionalChartDescriptor = descriptor.family === 'PLAN_PTS'
          ? { ...descriptor, ...(permittedDomains.length ? { allowedDomains: permittedDomains } : {}) }
          : descriptor;
        const result: any = await dataService.setPatientSharedChartSelection(patientId, nextDescriptor);
        if (result?.success !== true) {
          setError('Não foi possível salvar a publicação. A seleção anterior foi preservada.');
          return;
        }
        setConfirmed(result.data?.descriptor || nextDescriptor);
        setDraftClearAll(false);
        setMessage('Publicação salva no painel do paciente.');
      }
    } catch {
      setError('Falha ao salvar. Verifique a conexão e tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const toggleDomain = (domain: ShareDomain) => {
    setDraftDomains((current) => current.includes(domain)
      ? current.filter((item) => item !== domain)
      : [...current, domain]);
  };

  if (!descriptor && !confirmed && !loading && !error && !governance.canDelegate) return null;
  return (
    <section aria-label="Publicação do gráfico no painel do paciente" data-professional-shared-chart className={`rounded-2xl border px-3 py-3 sm:px-4 ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800 shadow-sm'}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isDark ? 'bg-violet-500/15 text-violet-300' : 'bg-violet-50 text-violet-600'}`}>
            <Share2 size={17} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Gráfico no painel do paciente</p>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Controle o que aparece no portal do paciente.</p>
          </div>
        </div>
        <span aria-live="polite" className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${loading
          ? isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-500'
          : confirmed
            ? activeMatchesCurrent
              ? isDark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-700'
            : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
          {loading ? 'Carregando…' : confirmed ? (activeMatchesCurrent ? 'Este gráfico está publicado' : 'Outro gráfico está publicado') : 'Nenhum gráfico publicado'}
        </span>
      </div>

      {ready && governance.canPublish && (
        <>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {descriptor && (
              <label className={`flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${isDark
                ? 'border-slate-700 bg-slate-800/50 hover:bg-slate-800'
                : 'border-slate-200 bg-slate-50/80 hover:bg-slate-50'}`}>
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-violet-600" checked={draftEnabled && !draftClearAll} disabled={busy} onChange={(event) => {
                  setDraftEnabled(event.target.checked);
                  setDraftClearAll(!event.target.checked && activeMatchesCurrent);
                }} />
                <span className="font-medium">Exibir este gráfico no portal do paciente</span>
              </label>
            )}
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:ml-auto">
              {confirmed && (
                <button type="button" disabled={busy} onClick={() => { setDraftClearAll(true); setDraftEnabled(false); }}
                  className={`min-h-11 rounded-lg px-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 ${isDark ? 'text-rose-300 hover:bg-rose-500/10' : ''}`}>
                  Não exibir nenhum gráfico
                </button>
              )}
              <button type="button" disabled={busy || !dirty} onClick={() => void save()}
                className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
          {descriptor?.family === 'PLAN_PTS' && draftEnabled && !draftClearAll && (
            <fieldset className={`mt-3 rounded-xl border px-3 py-2.5 ${isDark ? 'border-slate-700 bg-slate-800/30' : 'border-slate-200 bg-slate-50/60'}`}>
              <legend className="px-1 text-xs font-semibold">Permitir navegação por outras abas (opcional)</legend>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Sem marcações, o paciente vê apenas a aba selecionada.</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                {extraDomains.map((domain) => (
                  <label key={domain.id} className="inline-flex min-h-10 items-center gap-2 text-xs">
                    <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={draftDomains.includes(domain.id)} disabled={busy} onChange={() => toggleDomain(domain.id)} />
                    {domain.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {dirty && <p className={`mt-2 text-xs ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>Alterações ainda não salvas. Clique em Salvar para aplicar.</p>}
        </>
      )}
      {ready && !governance.canPublish && <p className="mt-2 text-xs opacity-75">A publicação depende da liderança do caso ou de delegação ativa.</p>}
      {!ready && !loading && <button type="button" onClick={() => void reload()} className="mt-2 min-h-11 rounded-xl border px-3 text-xs font-semibold">Tentar novamente</button>}
      {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
      {message && <p role="status" className="mt-2 text-xs text-emerald-600">{message}</p>}
      {ready && governance.canDelegate && <PatientSharedChartDelegationPanel key={patientId} patientId={patientId} />}
    </section>
  );
}
