import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Activity,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  Pencil,
  Play,
  Plus,
  Save,
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
  measurementType?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number | null;
  countDelta?: number | null;
  intervalIndex?: number | null;
  intervalOccurred?: boolean | null;
  location?: string;
  severity?: number | null;
  antecedent?: string;
  consequence?: string;
  notes?: string;
  editedAt?: string;
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
  { id: 'crying', name: 'Choro', defaultMeasurement: 'duration', allowedMeasurements: ['duration'], tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  { id: 'escape', name: 'Fuga da atividade', defaultMeasurement: 'duration', allowedMeasurements: ['duration'], tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'aggression', name: 'Agressao', defaultMeasurement: 'frequency', allowedMeasurements: ['frequency'], tone: 'bg-red-50 text-red-700 border-red-100' },
  { id: 'self_injury', name: 'Autoagressao', defaultMeasurement: 'frequency', allowedMeasurements: ['frequency'], tone: 'bg-rose-50 text-rose-700 border-rose-100' },
  { id: 'refusal', name: 'Recusa', defaultMeasurement: 'frequency', allowedMeasurements: ['frequency'], tone: 'bg-violet-50 text-violet-700 border-violet-100' },
  { id: 'stereotypy', name: 'Estereotipia', defaultMeasurement: 'partial_interval', allowedMeasurements: ['partial_interval', 'duration'], tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' }
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

const promptedPromptKeys = ['visual', 'gestural', 'verbal', 'model', 'partial_physical', 'full_physical'];
const promptedPromptOptions = ABA_PROMPT_LEVEL_OPTIONS.filter((prompt) => promptedPromptKeys.includes(prompt.key));

const normalizeSyncStatus = (status: any): SyncStatus => {
  return status === 'syncing' || status === 'synced' || status === 'error' ? status : 'local';
};

const getMeasurementLabel = (measurementType: string) => {
  return behaviorMeasurementOptions.find((option) => option.key === measurementType)?.label || measurementType;
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
  const [promptLevelKey, setPromptLevelKey] = useState('verbal');
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [openDurations, setOpenDurations] = useState<OpenDurationEvent[]>([]);
  const [selectedBehaviorId, setSelectedBehaviorId] = useState('crying');
  const [behaviorMeasurementType, setBehaviorMeasurementType] = useState(behaviorPresets[0].defaultMeasurement);
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
  const [durationBlockModalOpen, setDurationBlockModalOpen] = useState(false);
  const [promptSelectionGoal, setPromptSelectionGoal] = useState<any>(null);
  const [promptWarning, setPromptWarning] = useState('');
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editingRecordTitle, setEditingRecordTitle] = useState('');
  const [editingRecordDetail, setEditingRecordDetail] = useState('');
  const [editingRecordLocation, setEditingRecordLocation] = useState('');
  const [editingRecordSeverity, setEditingRecordSeverity] = useState(2);
  const [editingRecordAntecedent, setEditingRecordAntecedent] = useState('');
  const [editingRecordConsequence, setEditingRecordConsequence] = useState('');
  const [editingRecordNotes, setEditingRecordNotes] = useState('');
  const [hydratedSessionStateKey, setHydratedSessionStateKey] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  const selectedBehavior = useMemo(
    () => behaviorPresets.find((behavior) => behavior.id === selectedBehaviorId) || behaviorPresets[0],
    [selectedBehaviorId]
  );
  const selectedBehaviorMeasurements = selectedBehavior.allowedMeasurements || [selectedBehavior.defaultMeasurement];
  const selectedBehaviorAllowsMultipleMethods = selectedBehaviorMeasurements.length > 1;
  const selectedBehaviorMethodOptions = behaviorMeasurementOptions.filter((option) => selectedBehaviorMeasurements.includes(option.key));

  useEffect(() => {
    setBehaviorMeasurementType(selectedBehavior.defaultMeasurement);
  }, [selectedBehavior.id, selectedBehavior.defaultMeasurement]);

  useEffect(() => {
    setHydratedSessionStateKey('');
    try {
      const persisted = JSON.parse(localStorage.getItem(sessionStateKey) || '{}');
      setRecords(Array.isArray(persisted.records)
        ? persisted.records.map((record: any) => ({ ...record, syncStatus: normalizeSyncStatus(record?.syncStatus) }))
        : []);
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

  useEffect(() => {
    if (!durationBlockModalOpen || openDurations.length > 0) return;
    setDurationBlockModalOpen(false);
    setShowSessionSummary(true);
  }, [durationBlockModalOpen, openDurations.length]);

  const updateRecordStatus = (id: string, syncStatus: SyncStatus) => {
    setRecords((prev) => prev.map((record) => (record.id === id ? { ...record, syncStatus } : record)));
  };

  const updateRecord = (id: string, updates: Partial<SessionRecord>) => {
    setRecords((prev) => prev.map((record) => (record.id === id ? { ...record, ...updates } : record)));
  };

  const addRecord = (record: Omit<SessionRecord, 'syncStatus'>, syncStatus: SyncStatus = 'local') => {
    setRecords((prev) => [{ ...record, syncStatus }, ...prev].slice(0, 40));
  };

  const upsertRecord = (record: Omit<SessionRecord, 'syncStatus'>, syncStatus: SyncStatus = 'local') => {
    setRecords((prev) => {
      let found = false;
      const next = prev.map((item) => {
        if (item.id !== record.id) return item;
        found = true;
        return { ...item, ...record, syncStatus };
      });
      return found ? next : [{ ...record, syncStatus }, ...next].slice(0, 40);
    });
  };

  const saveExistingBehaviorEvent = async (payload: any, record: Omit<SessionRecord, 'syncStatus'>) => {
    upsertRecord(record, 'local');
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

  const deleteBehaviorEvent = async (record: SessionRecord) => {
    updateRecordStatus(record.id, 'syncing');
    try {
      const result = await dataService.deleteAbaBehaviorEvent(record.id, {
        patient_id: patientId,
        patientId,
        session_id: sessionId,
        sessionId
      });
      if (result?.success || result?.pending || result?.offline) {
        setRecords((prev) => prev.filter((item) => item.id !== record.id));
        onSessionRecordSaved?.();
        return result;
      }
      updateRecordStatus(record.id, 'error');
      return result;
    } catch (error) {
      updateRecordStatus(record.id, 'error');
      console.error('Falha ao descartar evento ABA:', error);
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

  const handleTrialClick = async (goal: any, score: number, outcome: 'independent' | 'prompted' | 'error', promptedPromptKey?: string) => {
    const maxScore = Number(goal?.maxScore || 1);
    const timestamp = new Date().toISOString();
    const selectedPrompt = outcome === 'independent'
      ? resolveAbaPromptLevel({ promptLevelKey: 'independent' })
      : outcome === 'error'
        ? resolveAbaPromptLevel({ promptLevelKey: 'error' })
        : resolveAbaPromptLevel({ promptLevelKey: promptedPromptKey || promptLevelKey });
    if (outcome === 'prompted' && !promptedPromptKeys.includes(selectedPrompt.key)) {
      setPromptWarning('Selecione visual, gestual, verbal, modelo, fisica parcial ou fisica total antes de salvar.');
      setPromptSelectionGoal(goal);
      return;
    }
    setPromptWarning('');
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
        promptLevelSource: outcome === 'independent' ? 'independent_button' : outcome === 'error' ? 'error_button' : 'prompt_modal',
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
      timestamp: payload.timestamp,
      measurementType: 'frequency',
      countDelta,
      location: selectedLocation,
      severity: selectedSeverity
    });
  };

  const savePromptedTrial = (promptKey: string) => {
    if (!promptSelectionGoal) return;
    setPromptLevelKey(promptKey);
    const goal = promptSelectionGoal;
    setPromptSelectionGoal(null);
    void handleTrialClick(goal, 0.5, 'prompted', promptKey);
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
      ended_at: null,
      endedAt: null,
      duration_seconds: null,
      durationSeconds: null,
      count_delta: 1,
      countDelta: 1,
      location: selectedLocation,
      severity: selectedSeverity,
      timestamp: startedAt,
      raw_payload: { durationLifecycleStatus: 'open' }
    });
    void saveExistingBehaviorEvent(payload, {
      id,
      kind: 'behavior',
      title: behaviorName,
      detail: 'duracao em andamento',
      timestamp: startedAt,
      measurementType: 'duration',
      startedAt,
      durationSeconds: null,
      countDelta: 1,
      location: selectedLocation,
      severity: selectedSeverity
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
      timestamp: event.startedAt,
      raw_payload: { durationLifecycleStatus: 'completed' }
    });
    void saveExistingBehaviorEvent(payload, {
      id: event.id,
      kind: 'behavior',
      title: event.behaviorName,
      detail: `duracao ${formatElapsed(event.startedAt, new Date(endedAt).getTime())}`,
      timestamp: event.startedAt,
      measurementType: 'duration',
      startedAt: event.startedAt,
      endedAt,
      durationSeconds,
      countDelta: 1,
      location: event.location || selectedLocation,
      severity: event.severity ?? selectedSeverity
    });
  };

  const discardDuration = (eventId: string) => {
    const record = records.find((item) => item.id === eventId && item.kind === 'behavior');
    setOpenDurations((prev) => prev.filter((item) => item.id !== eventId));
    if (record) {
      void deleteBehaviorEvent(record);
      return;
    }
    setRecords((prev) => prev.filter((record) => record.id !== eventId));
  };

  const selectBehavior = (behavior: any) => {
    setSelectedBehaviorId(behavior.id);
    setBehaviorMeasurementType(behavior.defaultMeasurement);
  };

  const handleSelectedBehaviorAction = () => {
    if (behaviorMeasurementType === 'frequency') {
      registerFrequency(selectedBehavior.name, 1);
      return;
    }
    if (behaviorMeasurementType === 'duration') {
      startDuration(selectedBehavior.name);
      return;
    }
    if (behaviorMeasurementType === 'abc') {
      openAbcModal(selectedBehavior.id);
      return;
    }
    if (behaviorMeasurementType === 'partial_interval' || behaviorMeasurementType === 'whole_interval') {
      if (!intervalRun) startIntervalRun();
      return;
    }
    if (behaviorMeasurementType === 'rate') {
      if (!rateWindow) startRateWindow();
      else registerRateOccurrence();
      return;
    }
    if (behaviorMeasurementType === 'momentary_time_sampling') {
      if (!momentaryRun) startMomentary();
    }
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
      timestamp: payload.timestamp,
      measurementType: 'rate',
      countDelta: 1,
      location: selectedLocation,
      severity: selectedSeverity
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
      timestamp: payload.timestamp,
      measurementType: intervalRun.measurementType,
      intervalIndex: intervalRun.intervalIndex,
      intervalOccurred: occurred,
      location: selectedLocation,
      severity: selectedSeverity
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
      timestamp: payload.timestamp,
      measurementType: 'momentary_time_sampling',
      intervalOccurred: occurred,
      location: selectedLocation,
      severity: selectedSeverity
    });
  };

  const openAbcModal = (behaviorId = selectedBehaviorId) => {
    const behavior = behaviorPresets.find((item) => item.id === behaviorId) || selectedBehavior;
    setAbcBehaviorId(behavior.id);
    setAbcModalOpen(true);
  };

  const openAbcModalForBehaviorName = (behaviorName: string) => {
    const behavior = behaviorPresets.find((item) => item.name === behaviorName) || selectedBehavior;
    openAbcModal(behavior.id);
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
      timestamp: payload.timestamp,
      measurementType: 'abc',
      location: abcLocation,
      severity: abcSeverity,
      antecedent: abcAntecedent,
      consequence: abcConsequence,
      notes: abcNote
    });
    setAbcModalOpen(false);
    setAbcNote('');
  };

  const requestEndSession = () => {
    if (openDurations.length > 0) {
      setDurationBlockModalOpen(true);
      return;
    }
    setSessionWarning('');
    setShowSessionSummary(true);
  };

  const resolveDurationBeforeEnd = (eventId: string, action: 'end' | 'discard') => {
    const isLastOpenDuration = openDurations.length <= 1;
    if (action === 'end') endDuration(eventId);
    else discardDuration(eventId);
    if (isLastOpenDuration) {
      setDurationBlockModalOpen(false);
      setShowSessionSummary(true);
    }
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

  const startEditingRecord = (record: SessionRecord) => {
    setEditingRecordId(record.id);
    setEditingRecordTitle(record.title);
    setEditingRecordDetail(record.detail);
    setEditingRecordLocation(record.location || selectedLocation);
    setEditingRecordSeverity(Number(record.severity || selectedSeverity || 1));
    setEditingRecordAntecedent(record.antecedent || '');
    setEditingRecordConsequence(record.consequence || '');
    setEditingRecordNotes(record.notes || '');
  };

  const cancelEditingRecord = () => {
    setEditingRecordId(null);
    setEditingRecordTitle('');
    setEditingRecordDetail('');
    setEditingRecordLocation('');
    setEditingRecordSeverity(2);
    setEditingRecordAntecedent('');
    setEditingRecordConsequence('');
    setEditingRecordNotes('');
  };

  const inferRecordMeasurementType = (record: SessionRecord) => {
    if (record.measurementType) return record.measurementType;
    const detail = String(record.detail || '').toLowerCase();
    if (detail.includes('duracao')) return 'duration';
    if (detail.includes('abc')) return 'abc';
    if (detail.includes('intervalo')) return 'partial_interval';
    if (detail.includes('taxa')) return 'rate';
    if (detail.includes('amostragem')) return 'momentary_time_sampling';
    return 'frequency';
  };

  const buildPayloadFromSessionRecord = (record: SessionRecord) => {
    const measurementType = inferRecordMeasurementType(record);
    return buildBehaviorPayload(record.title, measurementType, {
      id: record.id,
      behavior_name: record.title,
      behaviorName: record.title,
      measurement_type: measurementType,
      measurementType,
      count_delta: record.countDelta ?? undefined,
      countDelta: record.countDelta ?? undefined,
      started_at: measurementType === 'duration' ? (record.startedAt || record.timestamp) : undefined,
      startedAt: measurementType === 'duration' ? (record.startedAt || record.timestamp) : undefined,
      ended_at: measurementType === 'duration' ? (record.endedAt || null) : undefined,
      endedAt: measurementType === 'duration' ? (record.endedAt || null) : undefined,
      duration_seconds: measurementType === 'duration' ? (record.durationSeconds ?? null) : undefined,
      durationSeconds: measurementType === 'duration' ? (record.durationSeconds ?? null) : undefined,
      interval_index: record.intervalIndex ?? undefined,
      intervalIndex: record.intervalIndex ?? undefined,
      interval_occurred: record.intervalOccurred ?? undefined,
      intervalOccurred: record.intervalOccurred ?? undefined,
      location: record.location,
      severity: record.severity,
      antecedent: record.antecedent,
      consequence: record.consequence,
      notes: record.notes,
      response_by_therapist: record.notes,
      responseByTherapist: record.notes,
      occurred_at: record.timestamp,
      occurredAt: record.timestamp,
      timestamp: record.timestamp,
      raw_payload: {
        editedAt: record.editedAt || null,
        displayDetail: record.detail,
        source: 'session_mode_history_edit'
      }
    });
  };

  const saveRecordEdit = () => {
    if (!editingRecordId) return;
    const original = records.find((record) => record.id === editingRecordId);
    if (!original) {
      cancelEditingRecord();
      return;
    }
    const editedRecord: SessionRecord = {
      ...original,
      title: editingRecordTitle.trim() || original.title,
      detail: editingRecordDetail.trim() || original.detail,
      location: editingRecordLocation || undefined,
      severity: editingRecordSeverity,
      antecedent: editingRecordAntecedent.trim() || undefined,
      consequence: editingRecordConsequence.trim() || undefined,
      notes: editingRecordNotes.trim() || undefined,
      syncStatus: 'local',
      editedAt: new Date().toISOString()
    };
    if (inferRecordMeasurementType(editedRecord) === 'duration') {
      setOpenDurations((prev) => prev.map((event) => (
        event.id === editedRecord.id
          ? {
              ...event,
              behaviorName: editedRecord.title,
              location: editedRecord.location,
              severity: editedRecord.severity
            }
          : event
      )));
    }
    if (editedRecord.kind === 'behavior') {
      void saveExistingBehaviorEvent(buildPayloadFromSessionRecord(editedRecord), editedRecord);
    } else {
      updateRecord(editingRecordId, editedRecord);
    }
    cancelEditingRecord();
  };

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
              Prompt se houver ajuda
              <select
                value={promptLevelKey}
                onChange={(event) => setPromptLevelKey(event.target.value)}
                className="block mt-1 bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:border-[#7a32fc]"
              >
                {promptedPromptOptions.map((prompt) => (
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
            <div className="sticky top-0 z-30 bg-white rounded-[28px] p-5 shadow-2xl shadow-blue-900/10 border border-blue-100">
              <div className="flex items-center gap-2 mb-4">
                <Timer size={18} className="text-[#7a32fc]" />
                <h2 className="text-sm font-bold text-gray-800">Eventos em andamento</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {openDurations.map((event) => (
                  <div key={event.id} className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-gray-800">{event.behaviorName}</p>
                        <p className="text-xs text-gray-500 mt-1">{event.location || 'Sem local'} - severidade {event.severity || '-'}</p>
                        <p className="text-[11px] text-gray-400 mt-1">Inicio {new Date(event.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cronometro</p>
                        <p className="text-2xl font-bold text-[#7a32fc] leading-none">{formatElapsed(event.startedAt, nowMs)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => endDuration(event.id)}
                        className="bg-[#1B254B] text-white rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest"
                      >
                        Encerrar
                      </button>
                      <button
                        onClick={() => openAbcModalForBehaviorName(event.behaviorName)}
                        className="bg-white text-[#7a32fc] border border-purple-100 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest inline-flex items-center gap-2"
                      >
                        <FileText size={14} /> ABC rapido
                      </button>
                    </div>
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
              {selectedBehaviorAllowsMultipleMethods ? (
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Metodo
                  <select
                    value={behaviorMeasurementType}
                    onChange={(event) => setBehaviorMeasurementType(event.target.value)}
                    className="block mt-1 bg-[#F4F7FE] border border-blue-100 rounded-2xl px-4 py-3 text-xs font-bold text-gray-700 outline-none focus:border-[#7a32fc]"
                  >
                    {selectedBehaviorMethodOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 px-4 py-3 text-right">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Metodo</p>
                  <p className="text-sm font-bold text-gray-800">{getMeasurementLabel(behaviorMeasurementType)}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
              {behaviorPresets.map((behavior) => {
                const isOpen = openDurations.some((event) => event.behaviorName === behavior.name);
                return (
                  <div
                    key={behavior.id}
                    className={`border rounded-2xl px-4 py-4 text-left font-bold text-sm transition-all hover:scale-[1.02] ${behavior.tone} ${selectedBehaviorId === behavior.id ? 'ring-2 ring-[#7a32fc]/40' : ''}`}
                  >
                    <button onClick={() => selectBehavior(behavior)} className="w-full text-left">
                      <span className="block">{behavior.name}</span>
                      <span className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest opacity-70">
                        {behavior.defaultMeasurement === 'duration' ? (isOpen ? <Square size={12} /> : <Play size={12} />) : behavior.defaultMeasurement === 'frequency' ? <Plus size={12} /> : <Timer size={12} />}
                        {getMeasurementLabel(behavior.defaultMeasurement)}
                      </span>
                    </button>
                    <button
                      onClick={() => openAbcModal(behavior.id)}
                      className="mt-3 inline-flex items-center gap-1 rounded-xl bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#7a32fc] border border-white/80"
                    >
                      <FileText size={13} /> ABC rapido
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Comportamento
                  <select
                    value={selectedBehaviorId}
                    onChange={(event) => {
                      const behavior = behaviorPresets.find((item) => item.id === event.target.value);
                      if (behavior) selectBehavior(behavior);
                    }}
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
                  <button onClick={handleSelectedBehaviorAction} className="px-5 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                    <Plus size={16} /> + ocorrencia
                  </button>
                  <button onClick={() => openAbcModal()} className="px-5 py-3 rounded-2xl bg-white text-[#7a32fc] border border-purple-100 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                    <FileText size={16} /> ABC rapido
                  </button>
                </div>
              )}

              {behaviorMeasurementType === 'duration' && (
                <div className="flex gap-3 flex-wrap">
                  <button onClick={handleSelectedBehaviorAction} className="px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
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
                      <span className="text-sm font-bold text-gray-700">Janela {formatElapsed(rateWindow.startedAt, nowMs)} - {rateWindow.count} ocorrencia(s)</span>
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
                    <button onClick={handleSelectedBehaviorAction} className="px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                      <Play size={16} /> Iniciar coleta por intervalo
                    </button>
                  ) : (
                    <>
                      <span className="text-sm font-bold text-gray-700">Intervalo {intervalRun.intervalIndex} - {formatElapsed(intervalRun.startedAt, nowMs)}</span>
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
                  <button onClick={handleSelectedBehaviorAction} className="px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
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
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Criterio de maestria</p>
                        <p className="text-lg font-bold text-[#7a32fc]">{Math.min(masteryCount, masteryTarget)}/{masteryTarget} dias</p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button onClick={() => handleTrialClick(goal, 1, 'independent')} className="bg-[#05CD99] text-white min-h-[96px] rounded-3xl flex flex-col items-center justify-center px-4 shadow-lg shadow-green-500/20 hover:scale-[1.01] active:scale-95 transition-all">
                      <CheckCircle2 size={26} />
                      <span className="text-2xl font-bold mt-2">Independente</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">1 = correto independente</span>
                    </button>
                    <button onClick={() => handleTrialClick(goal, 0.5, 'prompted', promptLevelKey)} className="bg-[#FFB547] text-white min-h-[96px] rounded-3xl flex flex-col items-center justify-center px-4 shadow-lg shadow-orange-500/20 hover:scale-[1.01] active:scale-95 transition-all">
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
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tentativas hoje</p>
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
                {editingRecordId === record.id ? (
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{record.kind === 'trial' ? 'Tentativa' : 'Comportamento'}</p>
                    <input
                      value={editingRecordTitle}
                      onChange={(event) => setEditingRecordTitle(event.target.value)}
                      className="w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-[#7a32fc]"
                    />
                    <textarea
                      value={editingRecordDetail}
                      onChange={(event) => setEditingRecordDetail(event.target.value)}
                      className="w-full min-h-[74px] rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs text-gray-600 outline-none resize-none focus:border-[#7a32fc]"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Local
                        <select
                          value={editingRecordLocation}
                          onChange={(event) => setEditingRecordLocation(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                        >
                          {locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}
                        </select>
                      </label>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Severidade
                        <select
                          value={editingRecordSeverity}
                          onChange={(event) => setEditingRecordSeverity(Number(event.target.value))}
                          className="mt-1 w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                        >
                          {severityOptions.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
                        </select>
                      </label>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Antecedente
                        <select
                          value={editingRecordAntecedent}
                          onChange={(event) => setEditingRecordAntecedent(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                        >
                          <option value="">Nao informado</option>
                          {antecedentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Consequencia
                        <select
                          value={editingRecordConsequence}
                          onChange={(event) => setEditingRecordConsequence(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                        >
                          <option value="">Nao informada</option>
                          {consequenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                    </div>
                    <textarea
                      value={editingRecordNotes}
                      onChange={(event) => setEditingRecordNotes(event.target.value)}
                      placeholder="Observacao opcional"
                      className="w-full min-h-[64px] rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs text-gray-600 outline-none resize-none focus:border-[#7a32fc]"
                    />
                    <p className="text-[11px] text-gray-400">Horario original: {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    <div className="flex gap-2">
                      <button onClick={cancelEditingRecord} className="flex-1 rounded-xl bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 border border-gray-100">
                        Voltar
                      </button>
                      <button onClick={saveRecordEdit} className="flex-1 rounded-xl bg-[#7a32fc] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white inline-flex items-center justify-center gap-1">
                        <Save size={12} /> Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{record.kind === 'trial' ? 'Tentativa' : 'Comportamento'}</p>
                      <h3 className="text-sm font-bold text-gray-800 mt-1 truncate">{record.title}</h3>
                      <p className="text-xs text-gray-500 mt-1">{record.detail}</p>
                      {(record.location || record.severity || record.antecedent || record.consequence || record.notes) && (
                        <div className="mt-2 space-y-1 text-[11px] text-gray-500">
                          {(record.location || record.severity) && (
                            <p>{record.location || 'Local nao informado'} - severidade {record.severity || '-'}</p>
                          )}
                          {record.antecedent && <p>Antecedente: {record.antecedent}</p>}
                          {record.consequence && <p>Consequencia: {record.consequence}</p>}
                          {record.notes && <p>Obs: {record.notes}</p>}
                        </div>
                      )}
                      <p className="text-[11px] text-gray-400 mt-2">
                        {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {record.editedAt ? ' - editado' : ''}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      {renderSyncBadge(normalizeSyncStatus(record.syncStatus))}
                      <button onClick={() => startEditingRecord(record)} className="inline-flex items-center gap-1 rounded-full bg-white border border-gray-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-[#7a32fc]">
                        <Pencil size={11} /> Editar
                      </button>
                    </div>
                  </div>
                )}
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

      {promptSelectionGoal && (
        <div className="fixed inset-0 z-[142] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-[32px] p-6 shadow-2xl max-w-lg w-full border border-orange-100">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Prompt obrigatorio</p>
                <h2 className="text-xl font-bold text-gray-800">{promptSelectionGoal.name}</h2>
              </div>
              <button onClick={() => setPromptSelectionGoal(null)} className="p-2 rounded-full hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>
            {promptWarning && (
              <div className="mb-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                {promptWarning}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {promptedPromptOptions.map((prompt) => (
                <button
                  key={prompt.key}
                  onClick={() => savePromptedTrial(prompt.key)}
                  className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-4 text-left text-sm font-bold text-orange-700 hover:border-orange-300 hover:bg-orange-100 transition-all"
                >
                  {prompt.label}
                </button>
              ))}
            </div>
            <button onClick={() => setPromptSelectionGoal(null)} className="mt-5 w-full py-3 rounded-2xl bg-gray-100 text-gray-600 font-bold">
              Voltar para sessao
            </button>
          </div>
        </div>
      )}

      {durationBlockModalOpen && (
        <div className="fixed inset-0 z-[143] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-[32px] p-6 shadow-2xl max-w-2xl w-full border border-amber-100">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Eventos em andamento</p>
                <h2 className="text-xl font-bold text-gray-800">Finalize as duracoes antes de encerrar</h2>
              </div>
              <button onClick={() => setDurationBlockModalOpen(false)} className="p-2 rounded-full hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {openDurations.map((event) => (
                <div key={event.id} className="rounded-2xl border border-blue-100 bg-[#F4F7FE] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-gray-800">{event.behaviorName}</h3>
                      <p className="text-xs text-gray-500 mt-1">{formatElapsed(event.startedAt, nowMs)} em andamento - {event.location || 'sem local'} - severidade {event.severity || '-'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => resolveDurationBeforeEnd(event.id, 'end')} className="rounded-xl bg-[#1B254B] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white">
                        Encerrar evento agora
                      </button>
                      <button onClick={() => resolveDurationBeforeEnd(event.id, 'discard')} className="rounded-xl bg-red-50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-500">
                        Descartar evento
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setDurationBlockModalOpen(false)} className="mt-5 w-full py-3 rounded-2xl bg-gray-100 text-gray-600 font-bold">
              Voltar para sessao
            </button>
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
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tentativas hoje</p>
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
