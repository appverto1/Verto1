import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Share2, Trash2 } from 'lucide-react';
import { dataService } from '../services/dataService';
import { PatientSharedChartDelegationPanel } from './PatientSharedChartDelegationPanel';
import type { ClinicalPlanShareDescriptor } from './ClinicalPlanAnalyticsShell';
import type { AbaV3ShareDescriptor } from './AbaV3ClinicalChartPanel';

export type ProfessionalChartDescriptor = ClinicalPlanShareDescriptor | AbaV3ShareDescriptor;
type NavigationDomain = 'skills' | 'behaviors' | 'mastery' | 'maintenance';
const NAVIGATION_DOMAINS: Array<{ id: NavigationDomain; label: string }> = [
  { id: 'skills', label: 'Habilidades' },
  { id: 'behaviors', label: 'Comportamentos interferentes' },
  { id: 'mastery', label: 'Maestria' },
  { id: 'maintenance', label: 'Manutenção' },
];

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
  const [selected, setSelected] = useState(false);
  const [draftDomains, setDraftDomains] = useState<NavigationDomain[]>([]);
  const [governance, setGovernance] = useState({ canPublish: false, canDelegate: false });
  const lastRequest = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++lastRequest.current;
    setLoading(true);
    setReady(false);
    setConfirmed(null);
    setGovernance({ canPublish: false, canDelegate: false });
    setError('');
    const response: any = await dataService.getPatientSharedChartSelection(patientId);
    if (lastRequest.current !== requestId) return;
    if (response?.success !== true) {
      setError('Não foi possível carregar o estado do compartilhamento.');
      setLoading(false);
      return;
    }
    setConfirmed(response.data?.descriptor || null);
    setGovernance({
      canPublish: response.governance?.canPublish === true,
      canDelegate: response.governance?.canDelegate === true,
    });
    setReady(true);
    setLoading(false);
  }, [patientId]);

  useEffect(() => { void reload(); }, [reload]);

  const activePlan = descriptor?.family === 'PLAN_PTS' ? descriptor : null;
  // Only these fields reach the clinical API. Presentation helpers are not
  // authorized references and must never be persisted.
  const candidate = descriptor?.family === 'PLAN_PTS'
    ? {
        schemaVersion: descriptor.schemaVersion,
        family: descriptor.family,
        domain: descriptor.domain,
        metricSignature: descriptor.metricSignature,
        seriesKeys: descriptor.seriesKeys,
        ...(draftDomains.length ? { allowedDomains: draftDomains } : {}),
        axis: descriptor.axis,
        comparePrevious: descriptor.comparePrevious,
      }
    : descriptor;
  const candidateBase = descriptor?.family === 'PLAN_PTS'
    ? { ...candidate, allowedDomains: undefined }
    : candidate;
  const confirmedBase = confirmed?.family === 'PLAN_PTS'
    ? { ...confirmed, allowedDomains: undefined }
    : confirmed;
  const baseMatchesCurrent = Boolean(confirmed && descriptor && JSON.stringify(confirmedBase) === JSON.stringify(candidateBase));
  const activeMatchesCurrent = Boolean(
    confirmed && candidate && JSON.stringify(confirmed) === JSON.stringify(candidate)
  );
  const descriptorSignature = JSON.stringify(descriptor);
  const confirmedSignature = JSON.stringify(confirmed);
  useEffect(() => {
    setSelected(baseMatchesCurrent);
    setDraftDomains(baseMatchesCurrent && confirmed?.family === 'PLAN_PTS'
      ? (confirmed.allowedDomains || []).filter((domain): domain is NavigationDomain =>
          NAVIGATION_DOMAINS.some((item) => item.id === domain))
      : []);
  // The draft must not reset when the user simply checks a navigation domain.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptorSignature, confirmedSignature]);
  const share = async () => {
    if (!candidate || !selected || !ready || busy || !governance.canPublish) return;
    if (confirmed && !activeMatchesCurrent &&
      !window.confirm('Substituir gráfico compartilhado?\n\nO painel do paciente passará a mostrar esta visualização no lugar da anterior.')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result: any = await dataService.setPatientSharedChartSelection(patientId, candidate);
      if (result?.success !== true) {
        setError('Este gráfico não está disponível para compartilhamento. Atualize a visualização e tente novamente.');
      } else {
        setConfirmed(result.data?.descriptor || candidate);
        setMessage(confirmed ? 'Gráfico compartilhado atualizado.' : 'Gráfico compartilhado no painel do paciente.');
      }
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (!confirmed || !ready || busy || !governance.canPublish ||
      !window.confirm('Remover gráfico do painel do paciente?\n\nO paciente deixará de ver este gráfico. Os dados clínicos não serão apagados.')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result: any = await dataService.clearPatientSharedChartSelection(patientId);
      if (result?.success !== true) {
        setError('Não foi possível remover o compartilhamento. Tente novamente.');
      } else {
        setConfirmed(null);
        setMessage('Compartilhamento removido.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!descriptor && !confirmed && !loading && !error && !governance.canDelegate) return null;
  return (
    <section aria-label="Compartilhamento de gráfico com o paciente" data-professional-shared-chart className={`rounded-2xl border px-4 py-3 ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-violet-100 bg-violet-50/40 text-slate-800'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Share2 size={18} className="shrink-0 text-violet-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Gráfico no painel do paciente</p>
          {loading
            ? <p role="status" className="text-xs opacity-75">Carregando compartilhamento…</p>
            : <p className="text-xs opacity-75">{activeMatchesCurrent ? 'Compartilhado no painel' : confirmed ? 'Há um gráfico compartilhado com este paciente' : 'Nenhum gráfico publicado'}</p>}
        </div>
        {descriptor && ready && governance.canPublish && (
          <label className="inline-flex min-h-11 items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={selected} onChange={(event) => setSelected(event.target.checked)} disabled={busy} className="h-4 w-4 accent-violet-600" />
            Exibir este gráfico no portal do paciente
          </label>
        )}
        {descriptor && ready && governance.canPublish && (
          <button type="button" disabled={busy || (selected ? activeMatchesCurrent : !baseMatchesCurrent)} onClick={() => void (selected ? share() : clear())} className="min-h-11 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        )}
        {confirmed && ready && governance.canPublish && (
          <button type="button" disabled={busy} onClick={() => void clear()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-60">
            <Trash2 size={14} /> {busy ? 'Removendo…' : 'Remover compartilhamento'}
          </button>
        )}
        {!ready && !loading && (
          <button type="button" onClick={() => void reload()} className="min-h-11 rounded-xl border border-slate-200 px-3 text-xs font-semibold">Tentar novamente</button>
        )}
      </div>
      {activePlan && ready && governance.canPublish && selected && (
        <fieldset className="mt-3 rounded-xl border border-slate-200/60 p-3 dark:border-slate-700" aria-label="Navegação permitida ao paciente">
          <legend className="px-1 text-xs font-semibold">Categorias que o paciente poderá navegar</legend>
          <p className="mb-2 text-[11px] opacity-75">Somente a categoria principal ficará visível se nenhuma opção adicional for marcada. Cada categoria adicional depende de dados autorizados no servidor.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {NAVIGATION_DOMAINS.filter((item) => item.id !== activePlan.domain).map((item) => (
              <label key={item.id} className="inline-flex min-h-9 items-center gap-2 text-xs">
                <input type="checkbox" checked={draftDomains.includes(item.id)} onChange={(event) =>
                  setDraftDomains((current) => event.target.checked
                    ? [...current.filter((value) => value !== item.id), item.id]
                    : current.filter((value) => value !== item.id))} disabled={busy} className="h-4 w-4 accent-violet-600" />
                {item.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {ready && !governance.canPublish && <p className="mt-2 text-xs opacity-75">A publicação depende da liderança do caso ou de autorização profissional ativa.</p>
      {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
      {message && <p role="status" className="mt-2 text-xs text-emerald-600">{message}</p>}
      {ready && governance.canDelegate && <PatientSharedChartDelegationPanel key={patientId} patientId={patientId} />}
    </section>
  );
}
