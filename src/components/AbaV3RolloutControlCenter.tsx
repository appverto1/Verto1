import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  XCircle,
} from 'lucide-react';

type CatalogClinic = { id: string; name?: string | null };
type CatalogPatient = { id: string; name?: string | null; clinic_id?: string | null };
type CatalogProgram = { id: string; name?: string | null; status?: string | null };
type CatalogTarget = {
  id: string;
  name?: string | null;
  program_id?: string | null;
  target_type?: string | null;
  phase?: string | null;
};

type Selection = {
  clinic: CatalogClinic | null;
  patient: CatalogPatient | null;
  program: CatalogProgram | null;
  target: CatalogTarget | null;
};

const requestJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const error: any = new Error(payload?.error || payload?.message || 'Não foi possível concluir a operação.');
    error.code = payload?.code || null;
    error.status = response.status;
    throw error;
  }
  return payload?.data;
};

const RuntimeBadge = ({ label, enabled }: { label: string; enabled: boolean }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
      enabled
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-slate-50 text-slate-500'
    }`}
  >
    {enabled ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
    {label}
  </span>
);

const StatusCard = ({ title, value, tone = 'neutral' }: { title: string; value: string; tone?: 'neutral' | 'good' | 'warn' }) => {
  const toneClass = tone === 'good'
    ? 'border-emerald-200 bg-emerald-50/70'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50/70'
      : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">{title}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
};

export const AbaV3RolloutControlCenter = () => {
  const [selection, setSelection] = useState<Selection>({ clinic: null, patient: null, program: null, target: null });
  const [clinicSearch, setClinicSearch] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const [clinics, setClinics] = useState<CatalogClinic[]>([]);
  const [patients, setPatients] = useState<CatalogPatient[]>([]);
  const [programs, setPrograms] = useState<CatalogProgram[]>([]);
  const [targets, setTargets] = useState<CatalogTarget[]>([]);
  const [catalogLoading, setCatalogLoading] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<any | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadClinics = async () => {
    setCatalogLoading('clinics');
    setFeedback(null);
    try {
      const params = new URLSearchParams({ stage: 'clinics' });
      if (clinicSearch.trim()) params.set('q', clinicSearch.trim());
      const data = await requestJson(`/api/aba/v3/admin/cohort-catalog?${params.toString()}`);
      setClinics(Array.isArray(data?.items) ? data.items : []);
    } catch (error: any) {
      setFeedback(error?.message || 'Não foi possível carregar as clínicas.');
    } finally {
      setCatalogLoading(null);
    }
  };

  const loadPatients = async (clinic: CatalogClinic) => {
    setCatalogLoading('patients');
    setFeedback(null);
    try {
      const params = new URLSearchParams({ stage: 'patients', organizationId: clinic.id });
      if (patientSearch.trim()) params.set('q', patientSearch.trim());
      const data = await requestJson(`/api/aba/v3/admin/cohort-catalog?${params.toString()}`);
      setPatients(Array.isArray(data?.items) ? data.items : []);
    } catch (error: any) {
      setFeedback(error?.message || 'Não foi possível carregar os pacientes.');
    } finally {
      setCatalogLoading(null);
    }
  };

  const loadTargets = async (clinic: CatalogClinic, patient: CatalogPatient) => {
    setCatalogLoading('targets');
    setFeedback(null);
    try {
      const params = new URLSearchParams({
        stage: 'targets',
        organizationId: clinic.id,
        patientId: patient.id,
      });
      if (targetSearch.trim()) params.set('q', targetSearch.trim());
      const data = await requestJson(`/api/aba/v3/admin/cohort-catalog?${params.toString()}`);
      setPrograms(Array.isArray(data?.programs) ? data.programs : []);
      setTargets(Array.isArray(data?.targets) ? data.targets : []);
    } catch (error: any) {
      setFeedback(error?.message || 'Não foi possível carregar os alvos.');
    } finally {
      setCatalogLoading(null);
    }
  };

  const refreshSnapshot = async (nextSelection = selection) => {
    const { clinic, patient, program, target } = nextSelection;
    if (!clinic || !patient || !program || !target) return;
    setSnapshotLoading(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams({
        organizationId: clinic.id,
        patientId: patient.id,
        programId: program.id,
        targetId: target.id,
      });
      const data = await requestJson(`/api/aba/v3/admin/cohort-snapshot?${params.toString()}`);
      setSnapshot(data || null);
    } catch (error: any) {
      setSnapshot(null);
      setFeedback(error?.message || 'Não foi possível carregar o snapshot do cohort.');
    } finally {
      setSnapshotLoading(false);
    }
  };

  useEffect(() => {
    void loadClinics();
    // Initial bounded clinic catalog only; further reads are explicit and scoped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const programById = useMemo(() => new Map(programs.map((program) => [String(program.id), program])), [programs]);
  const filteredTargets = useMemo(() => {
    const query = targetSearch.trim().toLowerCase();
    if (!query) return targets;
    return targets.filter((target) => {
      const program = programById.get(String(target.program_id || ''));
      return `${target.name || ''} ${program?.name || ''}`.toLowerCase().includes(query);
    });
  }, [targets, targetSearch, programById]);

  const chooseClinic = (clinic: CatalogClinic) => {
    const next: Selection = { clinic, patient: null, program: null, target: null };
    setSelection(next);
    setPatients([]);
    setPrograms([]);
    setTargets([]);
    setSnapshot(null);
    setReason('');
    void loadPatients(clinic);
  };

  const choosePatient = (patient: CatalogPatient) => {
    if (!selection.clinic) return;
    const next: Selection = { ...selection, patient, program: null, target: null };
    setSelection(next);
    setPrograms([]);
    setTargets([]);
    setSnapshot(null);
    setReason('');
    void loadTargets(selection.clinic, patient);
  };

  const chooseTarget = (target: CatalogTarget) => {
    const program = programById.get(String(target.program_id || '')) || null;
    if (!program) {
      setFeedback('O alvo selecionado não possui programa ABA válido.');
      return;
    }
    const next: Selection = { ...selection, program, target };
    setSelection(next);
    setSnapshot(null);
    setReason('');
    void refreshSnapshot(next);
  };

  const applyCohortState = async (enabled: boolean) => {
    const { clinic, patient, program, target } = selection;
    if (!clinic || !patient || !program || !target || !snapshot) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 10) {
      setFeedback('Informe uma justificativa operacional com pelo menos 10 caracteres.');
      return;
    }
    const phrase = enabled ? 'ATIVAR V3' : 'DESATIVAR V3';
    const confirmation = window.prompt(
      `${enabled ? 'Ativar' : 'Desativar novas sessões de'} ABA V3 somente para ${patient.name || 'este paciente'} / ${target.name || 'este alvo'}?\n\nDigite ${phrase} para confirmar.`
    );
    if (confirmation !== phrase) return;

    setActionLoading(true);
    setFeedback(null);
    try {
      await requestJson('/api/aba/v3/admin/cohort-control', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: clinic.id,
          patient_id: patient.id,
          program_id: program.id,
          target_id: target.id,
          enabled,
          reason: trimmedReason,
          expected_state_versions: snapshot?.expected_state_versions || {},
        }),
      });
      setReason('');
      setFeedback(enabled
        ? 'Cohort V3 ativado. A mudança vale somente para sessões novas iniciadas após a ativação.'
        : 'Novas sessões V3 foram desativadas para este alvo. O sync permanece aberto para drenagem segura.');
      await refreshSnapshot();
    } catch (error: any) {
      setFeedback(error?.message || 'Não foi possível alterar o cohort ABA V3.');
      if (error?.status === 409) await refreshSnapshot();
    } finally {
      setActionLoading(false);
    }
  };

  const runtime = snapshot?.runtime || {};
  const readiness = snapshot?.readiness || {};
  const drain = snapshot?.drain_status || {};
  const effectiveEnabled = snapshot?.effective_enabled === true;
  const writerEnabled = runtime?.rolloutAdminEnabled === true;
  const runtimeReady = runtime?.readApiEnabled === true
    && runtime?.collectionApiEnabled === true
    && runtime?.uiBuildFlagEnabled === true;
  const canEnable = snapshot?.can_enable === true && runtimeReady && writerEnabled && !effectiveEnabled;
  const canDisable = snapshot?.can_disable_new_sessions === true && writerEnabled;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-violet-50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-sky-700">
              <ShieldCheck size={20} />
              <h2 className="text-lg font-semibold">Rollout ABA V3 controlado</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Selecione uma clínica, um paciente e um alvo. A ativação usa preflight, optimistic locking,
              auditoria e escrita atômica de CLINIC + PATIENT + TARGET. Sessões já abertas nunca mudam de modelo.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            Writer administrativo: <span className="font-semibold text-slate-800">{writerEnabled ? 'habilitado' : 'desabilitado'}</span>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-900">1. Clínica</h3>
          <div className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={clinicSearch}
                onChange={(event) => setClinicSearch(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void loadClinics()}
                placeholder="Buscar clínica"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-sky-400"
              />
            </div>
            <button onClick={() => void loadClinics()} className="rounded-xl border border-slate-200 px-3 text-slate-600 hover:bg-slate-50">
              {catalogLoading === 'clinics' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
          </div>
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {clinics.map((clinic) => (
              <button
                key={clinic.id}
                onClick={() => chooseClinic(clinic)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${selection.clinic?.id === clinic.id ? 'border-sky-300 bg-sky-50' : 'border-slate-100 hover:bg-slate-50'}`}
              >
                <span>{clinic.name || clinic.id}</span><ChevronRight size={15} className="text-slate-400" />
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-900">2. Paciente</h3>
          {!selection.clinic ? (
            <p className="mt-4 text-sm text-slate-400">Escolha uma clínica primeiro.</p>
          ) : (
            <>
              <div className="mt-4 flex gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={patientSearch}
                    onChange={(event) => setPatientSearch(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && selection.clinic && void loadPatients(selection.clinic)}
                    placeholder="Buscar paciente"
                    className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-sky-400"
                  />
                </div>
                <button onClick={() => selection.clinic && void loadPatients(selection.clinic)} className="rounded-xl border border-slate-200 px-3 text-slate-600 hover:bg-slate-50">
                  {catalogLoading === 'patients' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                </button>
              </div>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {patients.map((patient) => (
                  <button
                    key={patient.id}
                    onClick={() => choosePatient(patient)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${selection.patient?.id === patient.id ? 'border-violet-300 bg-violet-50' : 'border-slate-100 hover:bg-slate-50'}`}
                  >
                    <span>{patient.name || patient.id}</span><ChevronRight size={15} className="text-slate-400" />
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-900">3. Programa e alvo</h3>
          {!selection.patient ? (
            <p className="mt-4 text-sm text-slate-400">Escolha um paciente primeiro.</p>
          ) : (
            <>
              <div className="relative mt-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={targetSearch}
                  onChange={(event) => setTargetSearch(event.target.value)}
                  placeholder="Buscar programa ou alvo"
                  className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-sky-400"
                />
              </div>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {filteredTargets.map((target) => {
                  const program = programById.get(String(target.program_id || ''));
                  return (
                    <button
                      key={target.id}
                      onClick={() => chooseTarget(target)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${selection.target?.id === target.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-100 hover:bg-slate-50'}`}
                    >
                      <p className="text-sm font-semibold text-slate-800">{target.name || target.id}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{program?.name || 'Programa não identificado'} · {target.target_type || 'tipo não informado'} · {target.phase || 'fase não informada'}</p>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      {selection.target && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Cohort selecionado</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">{selection.patient?.name} · {selection.target.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{selection.clinic?.name} · {selection.program?.name}</p>
            </div>
            <button
              onClick={() => void refreshSnapshot()}
              disabled={snapshotLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {snapshotLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Atualizar preflight
            </button>
          </div>

          {snapshotLoading && !snapshot ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Validando cohort...</div>
          ) : snapshot ? (
            <div className="mt-6 space-y-6">
              <div className="flex flex-wrap gap-2">
                <RuntimeBadge label="Read API" enabled={runtime.readApiEnabled === true} />
                <RuntimeBadge label="Collection API" enabled={runtime.collectionApiEnabled === true} />
                <RuntimeBadge label="Preflight API" enabled={runtime.preflightApiEnabled === true} />
                <RuntimeBadge label="UI V3" enabled={runtime.uiBuildFlagEnabled === true} />
                <RuntimeBadge label="Rollout writer" enabled={runtime.rolloutAdminEnabled === true} />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                <StatusCard title="Readiness" value={readiness.ready ? 'Pronto' : 'Bloqueado'} tone={readiness.ready ? 'good' : 'warn'} />
                <StatusCard title="Sessões abertas" value={String(snapshot.open_session_count ?? 0)} tone={Number(snapshot.open_session_count || 0) === 0 ? 'good' : 'warn'} />
                <StatusCard title="Rollout efetivo" value={effectiveEnabled ? 'V3 ativo' : 'V3 desligado'} tone={effectiveEnabled ? 'good' : 'neutral'} />
                <StatusCard title="Drain" value={drain.drained ? 'Limpo' : 'Pendente'} tone={drain.drained ? 'good' : 'warn'} />
                <StatusCard title="Quarantine" value={String(readiness?.counts?.unresolved_sync_quarantine ?? 0)} tone={Number(readiness?.counts?.unresolved_sync_quarantine || 0) === 0 ? 'good' : 'warn'} />
              </div>

              {snapshot?.writer_supported === false && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Este tipo de alvo ainda não é suportado pelo writer operacional ABA V3. A ativação foi bloqueada sem alterar o rollout.
                </div>
              )}

              {Array.isArray(readiness.blockers) && readiness.blockers.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle size={16} /> Bloqueadores do preflight</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {readiness.blockers.map((blocker: string) => <span key={blocker} className="rounded-lg bg-white px-2.5 py-1 text-xs text-amber-700">{blocker}</span>)}
                  </div>
                </div>
              )}

              {!writerEnabled && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  O painel está em modo somente leitura. Para uma janela operacional de rollout, habilite <code className="rounded bg-white px-1.5 py-0.5 text-xs">FEATURE_ABA_V3_ROLLOUT_ADMIN=true</code> no runtime de Produção e faça o redeploy. Depois da operação, a flag pode voltar para <code className="rounded bg-white px-1.5 py-0.5 text-xs">false</code>.
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 p-4">
                <label className="text-sm font-semibold text-slate-800" htmlFor="aba-v3-rollout-reason">Justificativa operacional</label>
                <textarea
                  id="aba-v3-rollout-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Ex.: Ativação controlada do alvo após readiness e validação clínica."
                  className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {!effectiveEnabled ? (
                    <button
                      onClick={() => void applyCohortState(true)}
                      disabled={!canEnable || actionLoading}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <ToggleRight size={17} />}
                      Ativar novas sessões V3
                    </button>
                  ) : (
                    <button
                      onClick={() => void applyCohortState(false)}
                      disabled={!canDisable || actionLoading}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <ToggleLeft size={17} />}
                      Desativar novas sessões V3
                    </button>
                  )}
                  <span className="text-xs text-slate-400">O sync V3 permanece aberto durante a drenagem.</span>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
};
