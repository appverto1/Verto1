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
    <section aria-label="Publicação do gráfico no painel do paciente" data-professional-shared-chart className={`rounded-2xl border px-4 py-3 ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-violet-50/40 text-slate-800'}`}>
      <div className="flex items-center gap-3">
        <Share2 size={18} className="shrink-0 text-violet-500" aria-hidden />
        <div>
          <p className="text-sm font-medium">Gráfico no painel do paciente</p>
          <p className="mt-0.5 text-xs opacity-75">{loading ? 'Carregando…' : confirmed ? (activeMatchesCurrent ? 'Este é o gráfico publicado' : 'Existe outro gráfico publicado') : 'Nenhum gráfico publicado'}</p>
        </div>
      </div>
      {ready && governance.canPublish && (
        <div className="mt-3 space-y-3">
          {descriptor && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={draftEnabled && !draftClearAll} disabled={busy} onChange={(event) => {
                setDraftEnabled(event.target.checked);
                setDraftClearAll(!event.target.checked && activeMatchesCurrent);
              }} />
              Exibir este gráfico no portal do paciente
            </label>
          )}
          {descriptor?.family === 'PLAN_PTS' && draftEnabled && !draftClearAll && (
            <fieldset className="rounded-xl border border-slate-300/40 p-3">
              <legend className="px-1 text-xs font-medium">Permitir navegação por outras abas (opcional)</legend>
              <p className="mb-2 text-[11px] opacity-75">Sem marcação, o paciente vê somente a aba selecionada neste gráfico.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {extraDomains.map((domain) => (
                  <label key={domain.id} className="flex min-h-9 items-center gap-2 text-xs">
                    <input type="checkbox" checked={draftDomains.includes(domain.id)} disabled={busy} onChange={() => toggleDomain(domain.id)} />
                    {domain.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {confirmed && (
            <button type="button" disabled={busy} onClick={() => { setDraftClearAll(true); setDraftEnabled(false); }} className="min-h-10 text-xs font-medium text-rose-600 underline underline-offset-2 dark:text-rose-300">
              Não exibir nenhum gráfico
            </button>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="min-h-11 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
            {dirty && <span className="self-center text-xs opacity-75">Alterações ainda não salvas</span>}
          </div>
        </div>
      )}
      {ready && !governance.canPublish && <p className="mt-2 text-xs opacity-75">A publicação depende da liderança do caso ou de delegação ativa.</p>}
      {!ready && !loading && <button type="button" onClick={() => void reload()} className="mt-2 min-h-11 rounded-xl border px-3 text-xs font-semibold">Tentar novamente</button>}
      {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
      {message && <p role="status" className="mt-2 text-xs text-emerald-600">{message}</p>}
      {ready && governance.canDelegate && <PatientSharedChartDelegationPanel key={patientId} patientId={patientId} />}
    </section>
  );
}
