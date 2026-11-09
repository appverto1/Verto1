import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { dataService } from '../services/dataService';

type ProfessionalPermission = { id: string; name: string; delegated: boolean };

/** Loaded only by case leadership on explicit interaction, not on every chart render. */
export function PatientSharedChartDelegationPanel({ patientId }: { key?: React.Key; patientId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<ProfessionalPermission[]>([]);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const currentPatientRef = useRef(patientId);
  currentPatientRef.current = patientId;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setPeople([]);
    setDraft({});
    setError('');
    setNotice('');
    const requestedPatientId = patientId;
    void (async () => {
      const response: any = await dataService.getPatientSharedChartDelegations(requestedPatientId);
      if (!active || currentPatientRef.current !== requestedPatientId) return;
      if (response?.success !== true || !Array.isArray(response.data)) {
        setError('Não foi possível carregar as autorizações deste caso.');
      } else {
        const next: ProfessionalPermission[] = response.data;
        setPeople(next);
        setDraft(Object.fromEntries(next.map((p) => [p.id, p.delegated])));
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [open, patientId]);

  const save = async (professional: ProfessionalPermission) => {
    if (saving || loading || draft[professional.id] === professional.delegated) return;
    const requestedPatientId = patientId;
    setSaving(professional.id);
    setError('');
    setNotice('');
    const allow = draft[professional.id] === true;
    const result: any = await dataService.savePatientSharedChartDelegation(requestedPatientId, professional.id, allow);
    if (currentPatientRef.current !== requestedPatientId) return;
    if (result?.success === true) {
      setPeople((previous) => previous.map((p) =>
        p.id === professional.id ? { ...p, delegated: allow } : p
      ));
      setNotice('Autorização salva para o profissional selecionado.');
    } else {
      setError('A autorização não foi salva. Verifique o vínculo do profissional e tente novamente.');
    }
    setSaving('');
  };

  return (
    <div className="mt-2 border-t border-slate-200/80 pt-1.5 dark:border-slate-700" data-shared-chart-case-delegations>
      <button type="button" onClick={() => setOpen((value) => !value)}
        aria-expanded={open} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-xs font-medium text-slate-600 transition hover:text-violet-600 dark:text-slate-300 dark:hover:text-violet-300">
        <ShieldCheck size={16} aria-hidden />
        {open ? 'Fechar autorizações do caso' : 'Gerenciar autorizações do caso'}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs opacity-75">
            Somente a liderança do caso e os profissionais autorizados podem publicar gráficos no portal infantil.
          </p>
          {loading && <p role="status" className="text-xs">Carregando autorizações…</p>}
          {!loading && people.length === 0 && !error && (
            <p className="text-xs opacity-75">Nenhum profissional elegível vinculado a este caso.</p>
          )}
          {!loading && people.map((professional) => (
            <div key={professional.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3">
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{professional.name}</span>
              <label className="text-xs">
                <span className="sr-only">Permissão de publicação para {professional.name}</span>
                <select value={draft[professional.id] ? 'allow' : 'deny'}
                  disabled={Boolean(saving)}
                  onChange={(event) => setDraft((prev) => ({
                    ...prev, [professional.id]: event.target.value === 'allow'
                  }))}
                  className="min-h-11 rounded-lg border border-slate-200 bg-white px-2 text-slate-800">
                  <option value="deny">Sem autorização</option>
                  <option value="allow">Autorizado</option>
                </select>
              </label>
              <button type="button" onClick={() => void save(professional)}
                disabled={Boolean(saving) || draft[professional.id] === professional.delegated}
                className="min-h-11 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-50">
                {saving === professional.id ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          ))}
          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          {notice && <p role="status" className="text-xs text-emerald-600">{notice}</p>}
        </div>
      )}
    </div>
  );
}
