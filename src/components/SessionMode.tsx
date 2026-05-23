import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Activity,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  MapPin,
  Minus,
  Play,
  Plus,
  Square,
  StopCircle,
  Timer,
  X,
  Zap
} from 'lucide-react';
import { sanitizeDescriptionForDisplay } from '../utils/mediaSecurity';
import { dataService } from '../services/dataService';
import { ABA_PROMPT_LEVEL_OPTIONS, resolveAbaPromptLevel } from '../utils/abaPromptLevels';

type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';

type SessionRecord = {
  id: string;
  kind: 'trial' | 'behavior';
  title: string;
  detail: string;
  timestamp: string;
  syncStatus: SyncStatus;
};

type OpenDurationEvent = {
  id: string;
  behaviorName: string;
  startedAt: string;
  location?: string;
  severity?: number | null;
};

const collectionOptions = [
  { key: 'dtt', label: 'DTT' },
  { key: 'net', label: 'NET' },
  { key: 'cold_probe', label: 'Cold Probe' },
  { key: 'baseline_probe', label: 'Baseline Probe' },
  { key: 'maintenance_probe', label: 'Maintenance Probe' }
];

const behaviorMeasurementOptions = [
  { key: 'frequency', label: 'Frequencia' },
  { key: 'duration', label: 'Duracao' },
  { key: 'rate', label: 'Taxa' },
  { key: 'partial_interval', label: 'Intervalo parcial' },
  { key: 'whole_interval', label: 'Intervalo total' },
  { key: 'momentary_time_sampling', label: 'Amostragem momentanea' },
  { key: 'abc', label: 'ABC' }
];

const behaviorPresets = [
  { id: 'crying', name: 'Choro', defaultMeasurement: 'duration', tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  { id: 'escape', name: 'Fuga da atividade', defaultMeasurement: 'duration', tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'aggression', name: 'Agressao', defaultMeasurement: 'frequency', tone: 'bg-red-50 text-red-700 border-red-100' },
  { id: 'self_injury', name: 'Autoagressao', defaultMeasurement: 'frequency', tone: 'bg-rose-50 text-rose-700 border-rose-100' },
  { id: 'refusal', name: 'Recusa', defaultMeasurement: 'frequency', tone: 'bg-violet-50 text-violet-700 border-violet-100' },
  { id: 'stereotypy', name: 'Estereotipia', defaultMeasurement: 'duration', tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' }
];

const antecedentOptions = ['Demanda apresentada', 'Transicao', 'Espera', 'Negacao de acesso', 'Barulho', 'Atencao dividida'];
const consequenceOptions = ['Redirecionamento', 'Pausa breve', 'Reforco diferencial', 'Ajuda fisica', 'Bloqueio seguro', 'Acesso removido'];
const locationOptions = ['Mesa', 'Sala de terapia', 'Brinquedoteca', 'Corredor', 'Banheiro', 'Recepcao'];
const severityOptions = [1, 2, 3, 4, 5];
const intervalSecondOptions = [10, 15, 30, 60, 120];
const momentarySecondOptions = [30, 60, 120, 300];

const formatElapsed = (start: string, nowMs = Date.now()) => {
  const elapsed = Math.max(0, Math.floor((nowMs - new Date(start).getTime()) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatRemainingUntil = (dueAt: string, nowMs = Date.now()) => {
  const remaining = Math.max(0, Math.ceil((new Date(dueAt).getTime() - nowMs) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const syncLabels: Record<SyncStatus, string> = {
  local: 'salvo localmente',
  syncing: 'sincronizando',
  synced: 'sincronizado',
  error: 'erro'
};

const syncClasses: Record<SyncStatus, string> = {
  local: 'bg-blue-50 text-blue-600 border-blue-100',
  syncing: 'bg-amber-50 text-amber-600 border-amber-100',
  synced: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  error: 'bg-red-50 text-red-600 border-red-100'
};

export const SessionMode = ({
  patient,
  onClose,
  onRecordTrial,
  activeSession,
  remainingSeconds = 0,
  formatCountdown,
  onRequestEndSession,
  onConfirmEndSession,
  onSessionRecordSaved,
  therapistId
}: any) => {
  const sessionGoals = (patient.pei?.filter((g: any) => g.isPriority || g.status === 'in_progress') || [])
    .sort((a: any, b: any) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0));

  const sessionId = String(activeSession?.id || `draft-${patient?.id || 'patient'}`);
  const patientId = String(patient?.id || '');
  const resolvedTherapistId = String(therapistId || activeSession?.therapistId || activeSession?.therapist_id || '').trim();
  const sessionStateKey = `verto.aba_session_state:${patientId}:${sessionId}`;

  const [trialCount, setTrialCount] = useState(0);
  const [activeCriteria, setActiveCriteria] = useState<string | null>(null);
  const [collectionType, setCollectionType] = useState('dtt');
  const [promptLevelKey, setPromptLevelKey] = useState('independent');
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [openDurations, setOpenDurations] = useState<OpenDurationEvent[]>([]);
  const [selectedBehaviorId, setSelectedBehaviorId] = useState('crying');
  const [behaviorMeasurementType, setBehaviorMeasurementType] = useState('frequency');
  const [selectedLocation, setSelectedLocation] = useState(locationOptions[0]);
  const [selectedSeverity, setSelectedSeverity] = useState(2);
  const [rateWindow, setRateWindow] = useState<any>(null);
  const [intervalRun, setIntervalRun] = useState<any>(null);
  const [momentaryRun, setMomentaryRun] = useState<any>(null);
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [momentarySeconds, setMomentarySeconds] = useState(60);
  const [abcModalOpen, setAbcModalOpen] = useState(false);
  const [abcBehaviorId, setAbcBehaviorId] = useState('crying');
  const [abcAntecedent, setAbcAntecedent] = useState(antecedentOptions[0]);
  const [abcConsequence, setAbcConsequence] = useState(consequenceOptions[0]);
  const [abcLocation, setAbcLocation] = useState(locationOptions[0]);
  const [abcSeverity, setAbcSeverity] = useState(2);
  const [abcNote, setAbcNote] = useState('');
  const [sessionWarning, setSessionWarning] = useState('');
  const [showSessionSummary, setShowSessionSummary] = useState(false);
  const [hydratedSessionStateKey, setHydratedSessionStateKey] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  const selectedBehavior = useMemo(
    () => behaviorPresets.find((behavior) => behavior.id === selectedBehaviorId) || behaviorPresets[0],
    [selectedBehaviorId]
  );

  useEffect(() => {
    setHydratedSessionStateKey('');
    try {
      const persisted = JSON.parse(localStorage.getItem(sessionStateKey) || '{}');
      setRecords(Array.isArray(persisted.records) ? persisted.records : []);
      setOpenDurations(Array.isArray(persisted.openDurations) ? persisted.openDurations : []);
      setRateWindow(persisted.rateWindow || null);
      setIntervalRun(persisted.intervalRun || null);
      setMomentaryRun(persisted.momentaryRun || null);
      setTrialCount(Number(persisted.trialCount || 0));
    } catch {
      setRecords([]);
      setOpenDurations([]);
      setRateWindow(null);
      setIntervalRun(null);
      setMomentaryRun(null);
      setTrialCount(0);
    } finally {
      setHydratedSessionStateKey(sessionStateKey);
    }
  }, [sessionStateKey]);

  useEffect(() => {
    if (hydratedSessionStateKey !== sessionStateKey) return;
    try {
      localStorage.setItem(
        sessionStateKey,
        JSON.stringify({
          records: records.slice(0, 40),
          openDurations,
          rateWindow,
          intervalRun,
          momentaryRun,
          trialCount
        })
      );
    } catch {
      // Local session history is a convenience layer; encrypted offline cache remains the source of truth.
    }
  }, [hydratedSessionStateKey, intervalRun, momentaryRun, openDurations, rateWindow, records, sessionStateKey, trialCount]);

  useEffect(() => {
    const hasRunningTimer = openDurations.length > 0 || rateWindow || intervalRun || momentaryRun;
    if (!hasRunningTimer) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [intervalRun, momentaryRun, openDurations.length, rateWindow]);

  useEffect(() => {
    if (!momentaryRun || momentaryRun.dueAt || !momentaryRun.startedAt) return;
    const dueAt = new Date(momentaryRun.startedAt).getTime() + Number(momentaryRun.seconds || 60) * 1000;
    setMomentaryRun({ ...momentaryRun, dueAt: new Date(dueAt).toISOString() });
  }, [momentaryRun]);

  useEffect(() => {
    if (!momentaryRun?.dueAt || momentaryRun?.due) return;
    if (nowMs >= new Date(momentaryRun.dueAt).getTime()) {
      setMomentaryRun({ ...momentaryRun, due: true });
    }
  }, [momentaryRun, nowMs]);

  const updateRecordStatus = (id: string, syncStatus: SyncStatus) => {
    setRecords((prev) => prev.map((record) => (record.id === id ? { ...record, syncStatus } : record)));
  };

  const addRecord = (record: Omit<SessionRecord, 'syncStatus'>, syncStatus: SyncStatus = 'local') => {
    setRecords((prev) => [{ ...record, syncStatus }, ...prev].slice(0, 40));
  };

  const saveBehaviorEvent = async (payload: any, record: Omit<SessionRecord, 'syncStatus'>) => {
    addRecord(record, 'local');
    setTimeout(() => updateRecordStatus(record.id, 'syncing'), 60);
    try {
      const result = await dataService.saveAbaBehaviorEvent({
        ...payload,
        patient_id: patientId,
        patientId,
        session_id: sessionId,
        sessionId,
        therapist_id: resolvedTherapistId || undefined,
        therapistId: resolvedTherapistId || undefined
      });
      updateRecordStatus(record.id, result?.success && !result?.pending && !result?.offline ? 'synced' : 'local');
      onSessionRecordSaved?.();
      return result;
    } catch (error) {
      updateRecordStatus(record.id, 'error');
      console.error('Falha ao persistir evento ABA:', error);
      return { success: false, error };
    }
  };

  const buildBehaviorPayload = (behaviorName: string, measurementType: string, overrides: any = {}) => {
    const timestamp = overrides.timestamp || new Date().toISOString();
    return {
      id: overrides.id || crypto.randomUUID(),
      behavior_name: behaviorName,
      behaviorName,
      measurement_type: measurementType,
      measurementType,
      occurred_at: timestamp,
      occurredAt: timestamp,
      timestamp,
      location: overrides.location ?? selectedLocation,
      severity: overrides.severity ?? selectedSeverity,
      notes: overrides.notes || '',
      raw_payload: {
        ...(overrides.raw_payload || {}),
        source: 'session_mode_intelligent_behavior',
        sessionReferenceDate: activeSession?.referenceDate || null,
        syncStatus: 'local'
      },
      ...overrides
    };
  };

  const handleTrialClick = async (goal: any, score: number, outcome: 'independent' | 'prompted' | 'error') => {
    const maxScore = Number(goal?.maxScore || 1);
    const timestamp = new Date().toISOString();
    const selectedPrompt = outcome === 'independent'
      ? resolveAbaPromptLevel({ promptLevelKey: 'independent' })
      : resolveAbaPromptLevel({ promptLevelKey });
    const isCorrect = outcome !== 'error' && score > 0;
    const isIndependent = outcome === 'independent';
    const trialId = `trial-ui-${crypto.randomUUID()}`;

    addRecord({
      id: trialId,
      kind: 'trial',
      title: goal.name,
      detail: `${collectionOptions.find((option) => option.key === collectionType)?.label || collectionType} - ${selectedPrompt.label} - ${score}`,
      timestamp
    });
    setTimeout(() => updateRecordStatus(trialId, 'syncing'), 60);

    try {
      await Promise.resolve(onRecordTrial(patient.id, goal.name, score, '', {
        sessionId,
        sessionStartedAt: activeSession?.startedAt || timestamp,
        sessionReferenceDate: activeSession?.referenceDate || timestamp.slice(0, 10),
        targetId: goal?.id,
        targetMaxScore: maxScore,
        protocolId: goal?.protocolId || null,
        protocolTitle: goal?.protocolTitle || null,
        domainId: goal?.domainId || null,
        domainName: goal?.domainName || null,
        collectionType,
        trialType: collectionType,
        promptLevelKey: selectedPrompt.key,
        promptLevelName: selectedPrompt.label,
        promptLevel: selectedPrompt.key,
        promptLevelSource: outcome === 'independent' ? 'independent_button' : 'prompt_dropdown',
        correct: isCorrect,
        isCorrect,
        independent: isIndependent,
        isIndependent,
        timestamp,
        therapistId: resolvedTherapistId || null
      }));
      setTrialCount((prev) => prev + 1);
      updateRecordStatus(trialId, 'synced');
      onSessionRecordSaved?.();
    } catch (error) {
      updateRecordStatus(trialId, 'error');
      console.error('Falha ao persistir tentativa ABA:', error);
    }
  };

  const registerFrequency = (behaviorName = selectedBehavior.name, countDelta = 1) => {
    const payload = buildBehaviorPayload(behaviorName, 'frequency', { count_delta: countDelta, countDelta });
    void saveBehaviorEvent(payload, {
      id: String(payload.id),
      kind: 'behavior',
      title: behaviorName,
      detail: `${countDelta > 0 ? '+' : ''}${countDelta} ocorrencia`,
      timestamp: payload.timestamp
    });
  };

  const startDuration = (behaviorName = selectedBehavior.name) => {
    const startedAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const openEvent: OpenDurationEvent = {
      id,
      behaviorName,
      startedAt,
      location: selectedLocation,
      severity: selectedSeverity
    };
    setOpenDurations((prev) => [openEvent, ...prev]);
    const payload = buildBehaviorPayload(behaviorName, 'duration', {
      id,
      started_at: startedAt,
      startedAt,
      count_delta: 1,
      countDelta: 1,
      duration_seconds: null,
      durationSeconds: null,
      timestamp: startedAt
    });
    void saveBehaviorEvent(payload, {
      id,
      kind: 'behavior',
      title: behaviorName,
      detail: 'duracao iniciada',
      timestamp: startedAt
    });
  };

  const endDuration = (eventId: string) => {
    const event = openDurations.find((item) => item.id === eventId);
    if (!event) return;
    const endedAt = new Date().toISOString();
    const durationSeconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(event.startedAt).getTime()) / 1000));
    setOpenDurations((prev) => prev.filter((item) => item.id !== eventId));
    const payload = buildBehaviorPayload(event.behaviorName, 'duration', {
      id: event.id,
      started_at: event.startedAt,
      startedAt: event.startedAt,
      ended_at: endedAt,
      endedAt,
      duration_seconds: durationSeconds,
      durationSeconds,
      count_delta: 1,
      countDelta: 1,
      location: event.location || selectedLocation,
      severity: event.severity ?? selectedSeverity,
      timestamp: event.startedAt
    });
    void saveBehaviorEvent(payload, {
      id: `${event.id}-ended-${Date.now()}`,
      kind: 'behavior',
      title: event.behaviorName,
      detail: `duracao ${formatElapsed(event.startedAt, new Date(endedAt).getTime())}`,
      timestamp: endedAt
    });
  };

  const handleQuickBehavior = (behavior: any) => {
    setSelectedBehaviorId(behavior.id);
    setBehaviorMeasurementType(behavior.defaultMeasurement);
    if (behavior.defaultMeasurement === 'duration') {
      const open = openDurations.find((event) => event.behaviorName === behavior.name);
      if (open) endDuration(open.id);
      else startDuration(behavior.name);
      return;
    }
    registerFrequency(behavior.name, 1);
  };

  const startRateWindow = () => {
    setRateWindow({
      id: crypto.randomUUID(),
      behaviorName: selectedBehavior.name,
      startedAt: new Date().toISOString(),
      count: 0
    });
  };

  const registerRateOccurrence = () => {
    if (!rateWindow) return;
    setRateWindow({ ...rateWindow, count: Number(rateWindow.count || 0) + 1 });
    const payload = buildBehaviorPayload(rateWindow.behaviorName, 'rate', {
      count_delta: 1,
      countDelta: 1,
      raw_payload: { rateWindowId: rateWindow.id, rateWindowStartedAt: rateWindow.startedAt }
    });
    void saveBehaviorEvent(payload, {
      id: String(payload.id),
      kind: 'behavior',
      title: rateWindow.behaviorName,
      detail: `taxa +1 (${Number(rateWindow.count || 0) + 1})`,
      timestamp: payload.timestamp
    });
  };

  const startIntervalRun = () => {
    setIntervalRun({
      id: crypto.randomUUID(),
      behaviorName: selectedBehavior.name,
      measurementType: behaviorMeasurementType,
      startedAt: new Date().toISOString(),
      intervalSeconds,
      intervalIndex: 1
    });
  };

  const registerInterval = (occurred: boolean) => {
    if (!intervalRun) return;
    const payload = buildBehaviorPayload(intervalRun.behaviorName, intervalRun.measurementType, {
      interval_index: intervalRun.intervalIndex,
      intervalIndex: intervalRun.intervalIndex,
      interval_occurred: occurred,
      intervalOccurred: occurred,
      raw_payload: {
        intervalRunId: intervalRun.id,
        intervalSeconds: intervalRun.intervalSeconds
      }
    });
    setIntervalRun({ ...intervalRun, intervalIndex: Number(intervalRun.intervalIndex || 1) + 1 });
    void saveBehaviorEvent(payload, {
      id: String(payload.id),
      kind: 'behavior',
      title: intervalRun.behaviorName,
      detail: `intervalo ${intervalRun.intervalIndex}: ${occurred ? 'SIM' : 'NAO'}`,
      timestamp: payload.timestamp
    });
  };

  const startMomentary = () => {
    setMomentaryRun({
      id: crypto.randomUUID(),
      behaviorName: selectedBehavior.name,
      seconds: momentarySeconds,
      startedAt: new Date().toISOString(),
      due: false
    });
  };

  const registerMomentary = (occurred: boolean) => {
    if (!momentaryRun) return;
    const payload = buildBehaviorPayload(momentaryRun.behaviorName, 'momentary_time_sampling', {
      interval_occurred: occurred,
      intervalOccurred: occurred,
      raw_payload: {
        momentaryRunId: momentaryRun.id,
        configuredSeconds: momentaryRun.seconds,
        dueAt: momentaryRun.dueAt || null
      }
    });
    setMomentaryRun(null);
    void saveBehaviorEvent(payload, {
      id: String(payload.id),
      kind: 'behavior',
      title: momentaryRun.behaviorName,
      detail: `amostragem momentanea: ${occurred ? 'SIM' : 'NAO'}`,
      timestamp: payload.timestamp
    });
  };

  const openAbcModal = (behaviorId = selectedBehaviorId) => {
    const behavior = behaviorPresets.find((item) => item.id === behaviorId) || selectedBehavior;
    setAbcBehaviorId(behavior.id);
    setAbcModalOpen(true);
  };

  const saveAbcEvent = () => {
    const behavior = behaviorPresets.find((item) => item.id === abcBehaviorId) || selectedBehavior;
    const payload = buildBehaviorPayload(behavior.name, 'abc', {
      antecedent: abcAntecedent,
      consequence: abcConsequence,
      location: abcLocation,
      severity: abcSeverity,
      notes: abcNote,
      response_by_therapist: abcNote,
      responseByTherapist: abcNote
    });
    void saveBehaviorEvent(payload, {
      id: String(payload.id),
      kind: 'behavior',
      title: behavior.name,
      detail: `ABC - severidade ${abcSeverity}`,
      timestamp: payload.timestamp
    });
    setAbcModalOpen(false);
    setAbcNote('');
  };

  const requestEndSession = () => {
    if (openDurations.length > 0) {
      setSessionWarning('Finalize os eventos de duracao em aberto antes de encerrar a sessao.');
      return;
    }
    setSessionWarning('');
    setShowSessionSummary(true);
  };

  const confirmEndSession = () => {
    setShowSessionSummary(false);
    if (typeof onConfirmEndSession === 'function') {
      onConfirmEndSession();
      return;
    }
    onRequestEndSession?.();
  };

  const sessionSummary = useMemo(() => {
    const trialTotal = records.filter((record) => record.kind === 'trial').length;
    const behaviorTotal = records.filter((record) => record.kind === 'behavior').length;
    const errorTotal = records.filter((record) => record.syncStatus === 'error').length;
    const localTotal = records.filter((record) => record.syncStatus === 'local' || record.syncStatus === 'syncing').length;
    return { trialTotal, behaviorTotal, errorTotal, localTotal };
  }, [records]);

  const renderSyncBadge = (status: SyncStatus) => (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${syncClasses[status]}`}>
      {status === 'synced' ? <CheckCircle2 size={12} /> : status === 'error' ? <AlertCircle size={12} /> : <Clock size={12} />}
      {syncLabels[status]}
    </span>
  );

  if (sessionGoals.length === 0) {
    const emptyStateContent = (
      <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-6">
        <button onClick={onClose} className="absolute top-6 left-6 p-2 hover:bg-gray-100 rounded-full transition-all">
          <ChevronLeft size={32} className="text-gray-400" />
        </button>
        {activeSession && (
          <button onClick={requestEndSession} className="absolute top-6 right-6 px-4 py-2 bg-red-50 text-red-500 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-red-100 transition-all flex items-center gap-2">
            <StopCircle size={16} /> Encerrar sessao
          </button>
        )}
        <Zap size={64} className="text-gray-200 mb-4" />
        <h2 className="text-xl font-bold text-gray-800 text-center">Nenhuma meta em treino ou prioritaria.</h2>
      </div>
    );
    if (typeof document === 'undefined') return emptyStateContent;
    return createPortal(emptyStateContent, document.body);
  }

  const sessionModeContent = (
    <div className="fixed inset-0 z-[100] bg-[#F4F7FE] flex flex-col overflow-hidden animate-fade-in">
      <div className="bg-white px-6 py-5 shadow-sm flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-5 min-w-0">
          <button onClick={onClose} className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-all">
            <ChevronLeft size={30} className="text-gray-400" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight truncate">Sessao: <span className="text-[#7a32fc]">{patient.name}</span></h1>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.18em] mt-1">Registro ABA em tempo real</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-end">
          <div className="flex items-center gap-3 rounded-2xl bg-[#F4F7FE] border border-blue-100 px-4 py-3">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Tipo da proxima tentativa
              <select
                value={collectionType}
                onChange={(event) => setCollectionType(event.target.value)}
                className="block mt-1 bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:border-[#7a32fc]"
              >
                {collectionOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Prompt da proxima tentativa
              <select
                value={promptLevelKey}
                onChange={(event) => setPromptLevelKey(event.target.value)}
                className="block mt-1 bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:border-[#7a32fc]"
              >
                {ABA_PROMPT_LEVEL_OPTIONS.map((prompt) => (
                  <option key={prompt.key} value={prompt.key}>{prompt.label}</option>
                ))}
              </select>
            </label>
          </div>
          {activeSession && (
            <div className="bg-[#7a32fc]/10 text-[#7a32fc] rounded-2xl px-5 py-3 min-w-[140px] text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest flex items-center justify-end gap-2">
                <Clock size={14} /> Restante
              </p>
              <p className="text-3xl font-bold leading-none">{formatCountdown ? formatCountdown(remainingSeconds) : '00:00'}</p>
            </div>
          )}
          {activeSession && (
            <button
              onClick={requestEndSession}
              className="bg-red-50 text-red-500 font-bold px-5 py-4 rounded-2xl text-xs uppercase tracking-widest hover:bg-red-100 transition-all flex items-center gap-2"
            >
              <StopCircle size={18} /> Encerrar
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="overflow-y-auto p-6 space-y-6 no-scrollbar">
          {sessionWarning && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-700 flex items-center gap-3">
              <AlertCircle size={18} /> {sessionWarning}
            </div>
          )}

          {openDurations.length > 0 && (
            <div className="bg-white rounded-[28px] p-5 shadow-xl shadow-blue-900/5 border border-white">
              <div className="flex items-center gap-2 mb-4">
                <Timer size={18} className="text-[#7a32fc]" />
                <h2 className="text-sm font-bold text-gray-800">Eventos em andamento</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {openDurations.map((event) => (
                  <div key={event.id} className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-gray-800">{event.behaviorName} em andamento ha {formatElapsed(event.startedAt, nowMs)}</p>
                      <p className="text-xs text-gray-500">{event.location || 'Sem local'} · severidade {event.severity || '-'}</p>
                    </div>
                    <button
                      onClick={() => endDuration(event.id)}
                      className="shrink-0 bg-[#1B254B] text-white rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest"
                    >
                      Encerrar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-[28px] p-5 shadow-xl shadow-blue-900/5 border border-white">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Evento comportamental inteligente</p>
                <h2 className="text-xl font-bold text-gray-800">Registro rapido</h2>
              </div>
              <select
                value={behaviorMeasurementType}
                onChange={(event) => setBehaviorMeasurementType(event.target.value)}
                className="bg-[#F4F7FE] border border-blue-100 rounded-2xl px-4 py-3 text-xs font-bold text-gray-700 outline-none focus:border-[#7a32fc]"
              >
                {behaviorMeasurementOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
              {behaviorPresets.map((behavior) => {
                const isOpen = openDurations.some((event) => event.behaviorName === behavior.name);
                return (
                  <button
                    key={behavior.id}
                    onClick={() => handleQuickBehavior(behavior)}
                    className={`border rounded-2xl px-4 py-4 text-left font-bold text-sm transition-all hover:scale-[1.02] ${behavior.tone} ${selectedBehaviorId === behavior.id ? 'ring-2 ring-[#7a32fc]/40' : ''}`}
                  >
                    <span className="block">{behavior.name}</span>
                    <span className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest opacity-70">
                      {behavior.defaultMeasurement === 'duration' ? (isOpen ? <Square size={12} /> : <Play size={12} />) : <Plus size={12} />}
                      {behavior.defaultMeasurement === 'duration' ? (isOpen ? 'encerrar' : 'iniciar') : '+ ocorrencia'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Comportamento
                  <select
                    value={selectedBehaviorId}
                    onChange={(event) => setSelectedBehaviorId(event.target.value)}
                    className="mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                  >
                    {behaviorPresets.map((behavior) => (
                      <option key={behavior.id} value={behavior.id}>{behavior.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Local
                  <select
                    value={selectedLocation}
                    onChange={(event) => setSelectedLocation(event.target.value)}
                    className="mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                  >
                    {locationOptions.map((location) => (
                      <option key={location} value={location}>{location}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Severidade
                  <select
                    value={selectedSeverity}
                    onChange={(event) => setSelectedSeverity(Number(event.target.value))}
                    className="mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                  >
                    {severityOptions.map((severity) => (
                      <option key={severity} value={severity}>{severity}</option>
                    ))}
                  </select>
                </label>
              </div>

              {behaviorMeasurementType === 'frequency' && (
                <div className="flex gap-3 flex-wrap">
                  <button onClick={() => registerFrequency(selectedBehavior.name, 1)} className="px-5 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                    <Plus size={16} /> +1
                  </button>
                  <button onClick={() => registerFrequency(selectedBehavior.name, -1)} className="px-5 py-3 rounded-2xl bg-slate-700 text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                    <Minus size={16} /> -1
                  </button>
                  <button onClick={() => openAbcModal()} className="px-5 py-3 rounded-2xl bg-white text-[#7a32fc] border border-purple-100 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                    <FileText size={16} /> ABC rapido
                  </button>
                </div>
              )}

              {behaviorMeasurementType === 'duration' && (
                <div className="flex gap-3 flex-wrap">
                  <button onClick={() => startDuration(selectedBehavior.name)} className="px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                    <Play size={16} /> Iniciar duracao
                  </button>
                  {openDurations.filter((event) => event.behaviorName === selectedBehavior.name).map((event) => (
                    <button key={event.id} onClick={() => endDuration(event.id)} className="px-5 py-3 rounded-2xl bg-[#1B254B] text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                      <Square size={16} /> Encerrar {formatElapsed(event.startedAt, nowMs)}
                    </button>
                  ))}
                </div>
              )}

              {behaviorMeasurementType === 'rate' && (
                <div className="flex gap-3 flex-wrap items-center">
                  {!rateWindow ? (
                    <button onClick={startRateWindow} className="px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                      <Play size={16} /> Iniciar janela
                    </button>
                  ) : (
                    <>
                      <span className="text-sm font-bold text-gray-700">Janela {formatElapsed(rateWindow.startedAt, nowMs)} · {rateWindow.count} ocorrencia(s)</span>
                      <button onClick={registerRateOccurrence} className="px-5 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                        <Plus size={16} /> Ocorrencia
                      </button>
                      <button onClick={() => setRateWindow(null)} className="px-5 py-3 rounded-2xl bg-slate-700 text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                        <Square size={16} /> Finalizar janela
                      </button>
                    </>
                  )}
                </div>
              )}

              {(behaviorMeasurementType === 'partial_interval' || behaviorMeasurementType === 'whole_interval') && (
                <div className="flex gap-3 flex-wrap items-center">
                  <select value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))} className="bg-white border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none">
                    {intervalSecondOptions.map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}
                  </select>
                  {!intervalRun ? (
                    <button onClick={startIntervalRun} className="px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                      <Play size={16} /> Iniciar timer
                    </button>
                  ) : (
                    <>
                      <span className="text-sm font-bold text-gray-700">Intervalo {intervalRun.intervalIndex} · {formatElapsed(intervalRun.startedAt, nowMs)}</span>
                      <button onClick={() => registerInterval(true)} className="px-5 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-bold uppercase tracking-widest">SIM</button>
                      <button onClick={() => registerInterval(false)} className="px-5 py-3 rounded-2xl bg-red-500 text-white text-xs font-bold uppercase tracking-widest">NAO</button>
                      <button onClick={() => setIntervalRun(null)} className="px-5 py-3 rounded-2xl bg-slate-700 text-white text-xs font-bold uppercase tracking-widest">Parar</button>
                    </>
                  )}
                </div>
              )}

              {behaviorMeasurementType === 'momentary_time_sampling' && (
                <div className="flex gap-3 flex-wrap items-center">
                  <select value={momentarySeconds} onChange={(event) => setMomentarySeconds(Number(event.target.value))} className="bg-white border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none">
                    {momentarySecondOptions.map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}
                  </select>
                  {!momentaryRun ? (
                    <button onClick={startMomentary} className="px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                      <Timer size={16} /> Iniciar alerta
                    </button>
                  ) : momentaryRun.due ? (
                    <>
                      <span className="text-sm font-bold text-[#7a32fc]">Momento de observar</span>
                      <button onClick={() => registerMomentary(true)} className="px-5 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-bold uppercase tracking-widest">SIM</button>
                      <button onClick={() => registerMomentary(false)} className="px-5 py-3 rounded-2xl bg-red-500 text-white text-xs font-bold uppercase tracking-widest">NAO</button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-bold text-gray-700">Alerta em {formatRemainingUntil(momentaryRun.dueAt || momentaryRun.startedAt, nowMs)}</span>
                      <button onClick={() => setMomentaryRun(null)} className="px-5 py-3 rounded-2xl bg-slate-700 text-white text-xs font-bold uppercase tracking-widest">Cancelar</button>
                    </>
                  )}
                </div>
              )}

              {behaviorMeasurementType === 'abc' && (
                <div className="flex gap-3 flex-wrap">
                  <button onClick={() => openAbcModal()} className="px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                    <FileText size={16} /> Abrir ABC rapido
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5">
            {sessionGoals.map((goal: any) => {
              const masteryTarget = Number(goal?.meta_sucessos ?? goal?.metaSucessos ?? goal?.masteryTarget ?? goal?.mastery_target) || 5;
              const skillHistory = (patient.history || [])
                .filter((h: any) => h.title === goal.name && h.type === 'task')
                .sort((a: any, b: any) => new Date(b.created_at || b.date || 0).getTime() - new Date(a.created_at || a.date || 0).getTime());
              let masteryCount = 0;
              for (const h of skillHistory) {
                if (h.score === 1) masteryCount += 1;
                else break;
              }
              return (
                <div key={goal.id} className="bg-white rounded-[32px] p-6 shadow-xl shadow-blue-900/5 border border-white relative overflow-hidden">
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div>
                      <span className="inline-flex bg-[#7a32fc]/10 text-[#7a32fc] text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest mb-3">
                        {goal.domainName || 'Meta'}
                      </span>
                      <h2 className="text-2xl font-bold text-gray-800 tracking-tight">{goal.name}</h2>
                    </div>
                    {patient.age <= 12 && (
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Maestria</p>
                        <p className="text-lg font-bold text-[#7a32fc]">{Math.min(masteryCount, masteryTarget)}/{masteryTarget}</p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button onClick={() => handleTrialClick(goal, 1, 'independent')} className="bg-[#05CD99] text-white min-h-[96px] rounded-3xl flex flex-col items-center justify-center px-4 shadow-lg shadow-green-500/20 hover:scale-[1.01] active:scale-95 transition-all">
                      <CheckCircle2 size={26} />
                      <span className="text-2xl font-bold mt-2">Independente</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">1 = correto independente</span>
                    </button>
                    <button onClick={() => handleTrialClick(goal, 0.5, 'prompted')} className="bg-[#FFB547] text-white min-h-[96px] rounded-3xl flex flex-col items-center justify-center px-4 shadow-lg shadow-orange-500/20 hover:scale-[1.01] active:scale-95 transition-all">
                      <Activity size={26} />
                      <span className="text-2xl font-bold mt-2">Com ajuda</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">0.5 = correto com ajuda</span>
                    </button>
                    <button onClick={() => handleTrialClick(goal, 0, 'error')} className="bg-[#EE5D50] text-white min-h-[96px] rounded-3xl flex flex-col items-center justify-center px-4 shadow-lg shadow-red-500/20 hover:scale-[1.01] active:scale-95 transition-all">
                      <X size={26} />
                      <span className="text-2xl font-bold mt-2">Erro</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">0 = erro ou sem resposta</span>
                    </button>
                  </div>

                  <div className="mt-5 text-center">
                    <button
                      onMouseDown={() => setActiveCriteria(goal.id)}
                      onMouseUp={() => setActiveCriteria(null)}
                      onMouseLeave={() => setActiveCriteria(null)}
                      onTouchStart={() => setActiveCriteria(goal.id)}
                      onTouchEnd={() => setActiveCriteria(null)}
                      className="text-[10px] font-bold text-gray-300 uppercase tracking-[0.3em] hover:text-gray-400 transition-colors"
                    >
                      Segure para ver criterios
                    </button>
                    {activeCriteria === goal.id && (
                      <div className="mt-3 mx-auto max-w-xl bg-[#1B254B] text-white p-5 rounded-3xl shadow-2xl animate-pop">
                        <p className="text-sm font-medium leading-relaxed">
                          {sanitizeDescriptionForDisplay(goal.criteria) || 'Criterios nao cadastrados para esta meta.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="bg-white border-l border-gray-100 p-5 overflow-y-auto">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Historico da sessao</p>
              <h2 className="text-lg font-bold text-gray-800">{records.length} registro(s)</h2>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tentativas</p>
              <p className="text-3xl font-bold text-[#7a32fc] leading-none">{trialCount}</p>
            </div>
          </div>

          <div className="space-y-3">
            {records.length === 0 ? (
              <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-5 text-sm text-gray-500">
                Nenhum registro nesta sessao.
              </div>
            ) : records.slice(0, 18).map((record) => (
              <div key={record.id} className="rounded-2xl border border-gray-100 bg-[#F8FAFF] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{record.kind === 'trial' ? 'Tentativa' : 'Comportamento'}</p>
                    <h3 className="text-sm font-bold text-gray-800 mt-1 truncate">{record.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{record.detail}</p>
                    <p className="text-[11px] text-gray-400 mt-2">{new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  {renderSyncBadge(record.syncStatus)}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {abcModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-[32px] p-6 shadow-2xl max-w-lg w-full border border-purple-100">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">ABC rapido</p>
                <h2 className="text-xl font-bold text-gray-800">Evento comportamental</h2>
              </div>
              <button onClick={() => setAbcModalOpen(false)} className="p-2 rounded-full hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Comportamento
                <select value={abcBehaviorId} onChange={(event) => setAbcBehaviorId(event.target.value)} className="mt-1 w-full bg-[#F4F7FE] border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none">
                  {behaviorPresets.map((behavior) => <option key={behavior.id} value={behavior.id}>{behavior.name}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Antecedente
                <select value={abcAntecedent} onChange={(event) => setAbcAntecedent(event.target.value)} className="mt-1 w-full bg-[#F4F7FE] border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none">
                  {antecedentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Consequencia
                <select value={abcConsequence} onChange={(event) => setAbcConsequence(event.target.value)} className="mt-1 w-full bg-[#F4F7FE] border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none">
                  {consequenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Local
                <select value={abcLocation} onChange={(event) => setAbcLocation(event.target.value)} className="mt-1 w-full bg-[#F4F7FE] border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none">
                  {locationOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Severidade
                <select value={abcSeverity} onChange={(event) => setAbcSeverity(Number(event.target.value))} className="mt-1 w-full bg-[#F4F7FE] border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none">
                  {severityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest sm:col-span-2">
                Observacao opcional
                <textarea value={abcNote} onChange={(event) => setAbcNote(event.target.value)} maxLength={600} className="mt-1 w-full min-h-[84px] bg-[#F4F7FE] border border-blue-100 rounded-xl px-3 py-3 text-sm text-gray-700 outline-none resize-none" />
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAbcModalOpen(false)} className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-600 font-bold">Cancelar</button>
              <button onClick={saveAbcEvent} className="flex-1 py-3 rounded-2xl bg-[#7a32fc] text-white font-bold shadow-lg shadow-purple-500/20">Salvar ABC</button>
            </div>
          </div>
        </div>
      )}

      {showSessionSummary && (
        <div className="fixed inset-0 z-[145] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-[32px] p-7 shadow-2xl max-w-md w-full border border-red-100">
            <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-5 text-red-500">
              <StopCircle size={28} />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-2">Resumo da sessao</h3>
            <div className="grid grid-cols-2 gap-3 my-5">
              <div className="rounded-2xl bg-[#F4F7FE] p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tentativas</p>
                <p className="text-3xl font-bold text-gray-900">{sessionSummary.trialTotal}</p>
              </div>
              <div className="rounded-2xl bg-[#F4F7FE] p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Comportamentos</p>
                <p className="text-3xl font-bold text-gray-900">{sessionSummary.behaviorTotal}</p>
              </div>
              <div className="rounded-2xl bg-[#F4F7FE] p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pendentes</p>
                <p className="text-3xl font-bold text-gray-900">{sessionSummary.localTotal}</p>
              </div>
              <div className="rounded-2xl bg-[#F4F7FE] p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Erros</p>
                <p className="text-3xl font-bold text-gray-900">{sessionSummary.errorTotal}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowSessionSummary(false)} className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-600 font-semibold">Continuar</button>
              <button onClick={confirmEndSession} className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-semibold shadow-lg shadow-red-500/20">Encerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document === 'undefined') return sessionModeContent;
  return createPortal(sessionModeContent, document.body);
};
