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
  behaviorId?: string | null;
  intervalNumber?: number | null;
  intervalIndex?: number | null;
  intervalOccurred?: boolean | null;
  intervalStartedAt?: string | null;
  intervalEndedAt?: string | null;
  intervalAggregate?: boolean;
  totalIntervals?: number | null;
  occurredCount?: number | null;
  notOccurredCount?: number | null;
  occurrencePercent?: number | null;
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
  { id: 'stereotypy', name: 'Estereotipia', defaultMeasurement: 'partial_interval', allowedMeasurements: ['partial_interval', 'whole_interval', 'momentary_time_sampling', 'duration'], tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' }
];

const antecedentOptions = ['Demanda apresentada', 'Transicao', 'Espera', 'Negacao de acesso', 'Barulho', 'Atencao dividida'];
const consequenceOptions = ['Redirecionamento', 'Pausa breve', 'Reforco diferencial', 'Ajuda fisica', 'Bloqueio seguro', 'Acesso removido'];
const locationOptions = ['Mesa', 'Sala de terapia', 'Brinquedoteca', 'Corredor', 'Banheiro', 'Recepcao'];
const severityOptions = [1, 2, 3, 4, 5];
const intervalDurationOptions = [
  { key: '10', label: '10s', seconds: 10 },
  { key: '30', label: '30s', seconds: 30 },
  { key: '60', label: '1min', seconds: 60 },
  { key: '120', label: '2min', seconds: 120 },
  { key: 'custom', label: 'Customizado', seconds: null }
];
const intervalAlertOptions = [
  { key: 'vibration', label: 'Vibracao' },
  { key: 'sound', label: 'Som' },
  { key: 'both', label: 'Ambos' },
  { key: 'silent', label: 'Silencioso' }
];

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

const isIntervalMeasurement = (measurementType: string) => (
  measurementType === 'partial_interval' ||
  measurementType === 'whole_interval' ||
  measurementType === 'momentary_time_sampling'
);

const getIntervalInstruction = (measurementType: string) => {
  if (measurementType === 'partial_interval') return 'SIM = ocorreu em qualquer momento do intervalo.';
  if (measurementType === 'whole_interval') return 'SIM = ocorreu durante o intervalo inteiro.';
  return 'SIM = estava ocorrendo exatamente no momento do alerta.';
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
  const [intervalSummary, setIntervalSummary] = useState<any>(null);
  const [intervalDurationMode, setIntervalDurationMode] = useState('30');
  const [intervalCustomSeconds, setIntervalCustomSeconds] = useState(45);
  const [intervalTotalIntervals, setIntervalTotalIntervals] = useState(10);
  const [intervalAlertType, setIntervalAlertType] = useState('both');
  const intervalSeconds = intervalDurationMode === 'custom'
    ? Math.max(1, Math.floor(Number(intervalCustomSeconds) || 1))
    : Number(intervalDurationOptions.find((option) => option.key === intervalDurationMode)?.seconds || 30);
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
      setIntervalSummary(persisted.intervalSummary || null);
      setTrialCount(Number(persisted.trialCount || 0));
    } catch {
      setRecords([]);
      setOpenDurations([]);
      setRateWindow(null);
      setIntervalRun(null);
      setIntervalSummary(null);
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
          intervalSummary,
          trialCount
        })
      );
    } catch {
      // Local session history is a convenience layer; encrypted offline cache remains the source of truth.
    }
  }, [hydratedSessionStateKey, intervalRun, intervalSummary, openDurations, rateWindow, records, sessionStateKey, trialCount]);

  useEffect(() => {
    const hasRunningTimer = openDurations.length > 0 || rateWindow || intervalRun;
    if (!hasRunningTimer) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [intervalRun, openDurations.length, rateWindow]);

  const triggerIntervalAlert = (alertType: string) => {
    if ((alertType === 'vibration' || alertType === 'both') && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate([180, 80, 180]);
      } catch {
        // Alert feedback is best-effort only.
      }
    }
    if (alertType === 'sound' || alertType === 'both') {
      try {
        const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) return;
        const context = new AudioContextCtor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.value = 0.08;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        window.setTimeout(() => {
          oscillator.stop();
          context.close?.();
        }, 180);
      } catch {
        // Some browsers block audio; visual highlighting still indicates the interval ended.
      }
    }
  };

  useEffect(() => {
    if (!intervalRun || intervalRun.awaitingResponse || intervalRun.completed || intervalRun.paused) return;
    if (!intervalRun.intervalEndsAt) return;
    if (nowMs < new Date(intervalRun.intervalEndsAt).getTime()) return;
    triggerIntervalAlert(intervalRun.alertType || 'both');
    setIntervalRun((prev: any) => {
      if (!prev || prev.id !== intervalRun.id || prev.awaitingResponse) return prev;
      return { ...prev, awaitingResponse: true, alertFiredAt: new Date().toISOString() };
    });
  }, [intervalRun, nowMs]);

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
    if (isIntervalMeasurement(behaviorMeasurementType)) {
      startIntervalRun();
      return;
    }
    if (behaviorMeasurementType === 'rate') {
      if (!rateWindow) startRateWindow();
      else registerRateOccurrence();
      return;
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
    if (intervalRun) {
      setSessionWarning(intervalRun.behaviorId === selectedBehavior.id
        ? 'Ja existe uma coleta por intervalo em andamento para este comportamento.'
        : 'Finalize, pause/cancele ou conclua a coleta por intervalo em andamento antes de iniciar outra.');
      return;
    }
    const startedAt = new Date().toISOString();
    const intervalEndsAt = new Date(new Date(startedAt).getTime() + intervalSeconds * 1000).toISOString();
    setIntervalRun({
      id: crypto.randomUUID(),
      behaviorId: selectedBehavior.id,
      behaviorName: selectedBehavior.name,
      measurementType: behaviorMeasurementType,
      method: behaviorMeasurementType,
      location: selectedLocation,
      severity: selectedSeverity,
      startedAt,
      intervalStartedAt: startedAt,
      intervalEndsAt,
      intervalSeconds,
      intervalIndex: 1,
      totalIntervals: Math.max(1, Math.floor(Number(intervalTotalIntervals) || 1)),
      alertType: intervalAlertType,
      awaitingResponse: false,
      paused: false,
      pauseRemainingMs: null,
      completedCount: 0,
      occurredCount: 0
    });
    setIntervalSummary(null);
    setSessionWarning('');
  };

  const saveIntervalAggregate = (run: any, completedTotal: number, occurredTotal: number, endedAt: string, reason = 'completed') => {
    const safeCompletedTotal = Math.max(0, Number(completedTotal || 0));
    const safeOccurredTotal = Math.min(safeCompletedTotal, Math.max(0, Number(occurredTotal || 0)));
    const notOccurredTotal = Math.max(0, safeCompletedTotal - safeOccurredTotal);
    const percent = safeCompletedTotal > 0 ? Math.round((safeOccurredTotal / safeCompletedTotal) * 100) : 0;
    const aggregateId = `${run.id}-summary`;
    const behaviorId = run.behaviorId || selectedBehavior.id;
    const payload = buildBehaviorPayload(run.behaviorName, run.measurementType, {
      id: aggregateId,
      behavior_id: behaviorId,
      behaviorId,
      method: run.measurementType,
      count_delta: safeOccurredTotal,
      countDelta: safeOccurredTotal,
      location: run.location || selectedLocation,
      severity: run.severity ?? selectedSeverity,
      notes: `Resumo da coleta por intervalo: ${safeOccurredTotal} SIM / ${notOccurredTotal} NAO (${percent}%)`,
      response_by_therapist: `Resumo da coleta por intervalo: ${safeOccurredTotal} SIM / ${notOccurredTotal} NAO (${percent}%)`,
      responseByTherapist: `Resumo da coleta por intervalo: ${safeOccurredTotal} SIM / ${notOccurredTotal} NAO (${percent}%)`,
      timestamp: endedAt,
      raw_payload: {
        intervalRunId: run.id,
        intervalAggregate: true,
        collectionStatus: reason,
        patientId,
        sessionId,
        therapistId: resolvedTherapistId || null,
        behaviorId,
        method: run.measurementType,
        totalIntervals: safeCompletedTotal,
        plannedTotalIntervals: Math.max(1, Number(run.totalIntervals || safeCompletedTotal || 1)),
        occurredCount: safeOccurredTotal,
        notOccurredCount: notOccurredTotal,
        occurrencePercent: percent,
        collectionStartedAt: run.startedAt,
        collectionEndedAt: endedAt,
        location: run.location || selectedLocation,
        severity: run.severity ?? selectedSeverity,
        syncStatus: 'local'
      }
    });
    void saveBehaviorEvent(payload, {
      id: aggregateId,
      kind: 'behavior',
      title: run.behaviorName,
      detail: `resumo da coleta: ${safeOccurredTotal} SIM / ${notOccurredTotal} NAO (${percent}%)`,
      timestamp: endedAt,
      measurementType: run.measurementType,
      behaviorId,
      intervalAggregate: true,
      totalIntervals: safeCompletedTotal,
      occurredCount: safeOccurredTotal,
      notOccurredCount: notOccurredTotal,
      occurrencePercent: percent,
      location: run.location || selectedLocation,
      severity: run.severity ?? selectedSeverity
    });
    setIntervalSummary({
      behaviorName: run.behaviorName,
      measurementType: run.measurementType,
      totalIntervals: safeCompletedTotal,
      plannedTotalIntervals: Math.max(1, Number(run.totalIntervals || safeCompletedTotal || 1)),
      occurredCount: safeOccurredTotal,
      notOccurredCount: notOccurredTotal,
      percent,
      endedAt,
      reason
    });
  };

  const pauseIntervalRun = () => {
    if (!intervalRun || intervalRun.awaitingResponse) return;
    const remainingMs = Math.max(0, new Date(intervalRun.intervalEndsAt).getTime() - nowMs);
    setIntervalRun({
      ...intervalRun,
      paused: true,
      pausedAt: new Date().toISOString(),
      pauseRemainingMs: remainingMs
    });
  };

  const resumeIntervalRun = () => {
    if (!intervalRun?.paused) return;
    const remainingMs = Math.max(1000, Number(intervalRun.pauseRemainingMs || intervalRun.intervalSeconds * 1000 || 1000));
    const resumedAt = new Date().toISOString();
    setIntervalRun({
      ...intervalRun,
      paused: false,
      resumedAt,
      intervalEndsAt: new Date(new Date(resumedAt).getTime() + remainingMs).toISOString(),
      pauseRemainingMs: null
    });
  };

  const cancelIntervalRun = () => {
    setIntervalRun(null);
    setIntervalSummary(null);
    setSessionWarning('Coleta por intervalo cancelada. Intervalos ja salvos permanecem no historico.');
  };

  const finishIntervalRunNow = () => {
    if (!intervalRun) return;
    const completedTotal = Number(intervalRun.completedCount || 0);
    const occurredTotal = Number(intervalRun.occurredCount || 0);
    const endedAt = new Date().toISOString();
    saveIntervalAggregate(intervalRun, completedTotal, occurredTotal, endedAt, 'finished_early');
    setIntervalRun(null);
    setSessionWarning('');
  };

  const registerInterval = (occurred: boolean) => {
    if (!intervalRun) return;
    const intervalNumber = Number(intervalRun.intervalIndex || 1);
    const totalIntervals = Math.max(1, Number(intervalRun.totalIntervals || 1));
    const intervalStartedAt = intervalRun.intervalStartedAt || intervalRun.startedAt || new Date().toISOString();
    const intervalEndedAt = intervalRun.intervalEndsAt || new Date().toISOString();
    const recordId = `${intervalRun.id}-interval-${intervalNumber}`;
    const payload = buildBehaviorPayload(intervalRun.behaviorName, intervalRun.measurementType, {
      id: recordId,
      behavior_id: intervalRun.behaviorId || selectedBehavior.id,
      behaviorId: intervalRun.behaviorId || selectedBehavior.id,
      method: intervalRun.measurementType,
      interval_number: intervalNumber,
      intervalNumber,
      interval_index: intervalNumber,
      intervalIndex: intervalNumber,
      interval_started_at: intervalStartedAt,
      intervalStartedAt,
      interval_ended_at: intervalEndedAt,
      intervalEndedAt,
      interval_occurred: occurred,
      intervalOccurred: occurred,
      occurred,
      location: intervalRun.location || selectedLocation,
      severity: intervalRun.severity ?? selectedSeverity,
      timestamp: intervalEndedAt,
      raw_payload: {
        intervalRunId: intervalRun.id,
        intervalAggregate: false,
        patientId,
        sessionId,
        therapistId: resolvedTherapistId || null,
        behaviorId: intervalRun.behaviorId || selectedBehavior.id,
        method: intervalRun.measurementType,
        intervalNumber,
        intervalStartedAt,
        intervalEndedAt,
        occurred,
        intervalSeconds: intervalRun.intervalSeconds,
        totalIntervals,
        alertType: intervalRun.alertType || 'both',
        location: intervalRun.location || selectedLocation,
        severity: intervalRun.severity ?? selectedSeverity,
        syncStatus: 'local'
      }
    });
    const nextCompletedCount = Number(intervalRun.completedCount || 0) + 1;
    const nextOccurredCount = Number(intervalRun.occurredCount || 0) + (occurred ? 1 : 0);
    void saveBehaviorEvent(payload, {
      id: recordId,
      kind: 'behavior',
      title: intervalRun.behaviorName,
      detail: `intervalo ${intervalNumber}: ${occurred ? 'SIM' : 'NAO'}`,
      timestamp: intervalEndedAt,
      measurementType: intervalRun.measurementType,
      behaviorId: intervalRun.behaviorId || selectedBehavior.id,
      intervalNumber,
      intervalIndex: intervalNumber,
      intervalOccurred: occurred,
      intervalStartedAt,
      intervalEndedAt,
      startedAt: intervalStartedAt,
      endedAt: intervalEndedAt,
      location: intervalRun.location || selectedLocation,
      severity: intervalRun.severity ?? selectedSeverity
    });
    if (intervalNumber >= totalIntervals) {
      saveIntervalAggregate(intervalRun, nextCompletedCount, nextOccurredCount, intervalEndedAt, 'completed');
      setIntervalRun(null);
      return;
    }
    const nextStartedAt = new Date().toISOString();
    const nextEndsAt = new Date(new Date(nextStartedAt).getTime() + Number(intervalRun.intervalSeconds || intervalSeconds) * 1000).toISOString();
    setIntervalRun({
      ...intervalRun,
      intervalIndex: intervalNumber + 1,
      intervalStartedAt: nextStartedAt,
      intervalEndsAt: nextEndsAt,
      awaitingResponse: false,
      alertFiredAt: null,
      paused: false,
      pauseRemainingMs: null,
      completedCount: nextCompletedCount,
      occurredCount: nextOccurredCount
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

  const intervalSummaryTotals = useMemo(() => {
    const total = Math.max(0, Number(intervalSummary?.totalIntervals || 0));
    const occurred = Math.min(total, Math.max(0, Number(intervalSummary?.occurredCount || 0)));
    const notOccurred = Math.max(0, total - occurred);
    const percent = total > 0 ? Math.round((occurred / total) * 100) : 0;
    return { total, occurred, notOccurred, percent };
  }, [intervalSummary]);

  const renderSyncBadge = (status: SyncStatus) => (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${syncClasses[status]}`}>
      {status === 'synced' ? <CheckCircle2 size={12} /> : status === 'error' ? <AlertCircle size={12} /> : <Clock size={12} />}
      {syncLabels[status]}
    </span>
  );

  const isIntervalHistoryRecord = (record: SessionRecord) => (
    record.kind === 'behavior' &&
    isIntervalMeasurement(inferRecordMeasurementType(record)) &&
    (record.intervalNumber !== undefined || record.intervalIndex !== undefined || record.intervalAggregate)
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
      interval_number: record.intervalNumber ?? record.intervalIndex ?? undefined,
      intervalNumber: record.intervalNumber ?? record.intervalIndex ?? undefined,
      interval_index: record.intervalIndex ?? undefined,
      intervalIndex: record.intervalIndex ?? undefined,
      interval_occurred: record.intervalOccurred ?? undefined,
      intervalOccurred: record.intervalOccurred ?? undefined,
      interval_started_at: record.intervalStartedAt ?? record.startedAt ?? undefined,
      intervalStartedAt: record.intervalStartedAt ?? record.startedAt ?? undefined,
      interval_ended_at: record.intervalEndedAt ?? record.endedAt ?? undefined,
      intervalEndedAt: record.intervalEndedAt ?? record.endedAt ?? undefined,
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
        intervalAggregate: record.intervalAggregate || undefined,
        totalIntervals: record.totalIntervals ?? undefined,
        occurredCount: record.occurredCount ?? undefined,
        notOccurredCount: record.notOccurredCount ?? undefined,
        occurrencePercent: record.occurrencePercent ?? undefined,
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
    const isLockedIntervalRecord = isIntervalHistoryRecord(original);
    const editedRecord: SessionRecord = {
      ...original,
      title: isLockedIntervalRecord ? original.title : (editingRecordTitle.trim() || original.title),
      detail: isLockedIntervalRecord ? original.detail : (editingRecordDetail.trim() || original.detail),
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

          {intervalRun && (
            <div className={`sticky top-0 z-30 rounded-[28px] p-5 shadow-2xl border transition-all ${intervalRun.awaitingResponse ? 'bg-amber-50 border-amber-300 ring-4 ring-amber-200/70' : intervalRun.paused ? 'bg-slate-50 border-slate-200 ring-2 ring-slate-200/70' : 'bg-white border-blue-100 shadow-blue-900/10'}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Timer size={18} className={intervalRun.awaitingResponse ? 'text-amber-600' : intervalRun.paused ? 'text-slate-500' : 'text-[#7a32fc]'} />
                    <h2 className="text-sm font-bold text-gray-800">Coleta por intervalo em andamento</h2>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">{intervalRun.behaviorName}</h3>
                  <p className="text-xs font-semibold text-gray-500 mt-1">
                    {getMeasurementLabel(intervalRun.measurementType)} - {intervalRun.location || 'Sem local'} - severidade {intervalRun.severity || '-'}
                  </p>
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                    {Number(intervalRun.completedCount || 0)} respondido(s) - {Number(intervalRun.occurredCount || 0)} SIM
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3 min-w-[320px]">
                  <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-3 text-center">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Intervalo</p>
                    <p className="text-2xl font-bold text-gray-900">{intervalRun.intervalIndex}</p>
                  </div>
                  <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-3 text-center">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total</p>
                    <p className="text-2xl font-bold text-gray-900">{intervalRun.totalIntervals}</p>
                  </div>
                  <div className={`rounded-2xl border p-3 text-center ${intervalRun.awaitingResponse ? 'bg-amber-100 border-amber-200' : 'bg-[#F4F7FE] border-blue-100'}`}>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Restante</p>
                    <p className={`text-2xl font-bold ${intervalRun.awaitingResponse ? 'text-amber-700' : 'text-[#7a32fc]'}`}>
                      {intervalRun.awaitingResponse ? 'Agora' : intervalRun.paused ? 'Pausado' : formatRemainingUntil(intervalRun.intervalEndsAt, nowMs)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold text-gray-500">
                  {getIntervalInstruction(intervalRun.measurementType)}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => registerInterval(true)}
                    disabled={!intervalRun.awaitingResponse}
                    className={`px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all ${intervalRun.awaitingResponse ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                  >
                    SIM
                  </button>
                  <button
                    onClick={() => registerInterval(false)}
                    disabled={!intervalRun.awaitingResponse}
                    className={`px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all ${intervalRun.awaitingResponse ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                  >
                    NAO
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-blue-100 pt-4">
                <button
                  onClick={intervalRun.paused ? resumeIntervalRun : pauseIntervalRun}
                  disabled={Boolean(intervalRun.awaitingResponse)}
                  className={`rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-widest ${intervalRun.awaitingResponse ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-[#1B254B] text-white'}`}
                >
                  {intervalRun.paused ? 'Retomar coleta' : 'Pausar coleta'}
                </button>
                <button
                  onClick={cancelIntervalRun}
                  className="rounded-xl bg-red-50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-500"
                >
                  Cancelar coleta
                </button>
                <button
                  onClick={finishIntervalRunNow}
                  className="rounded-xl bg-emerald-50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700"
                >
                  Finalizar agora
                </button>
              </div>
            </div>
          )}

          {intervalSummary && (
            <div className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-5 shadow-xl shadow-emerald-900/5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Resumo da coleta por intervalo</p>
              <h2 className="mt-1 text-xl font-bold text-emerald-900">{intervalSummary.behaviorName}</h2>
              <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="rounded-2xl bg-white/70 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Metodo</p>
                  <p className="text-sm font-bold text-emerald-950">{getMeasurementLabel(intervalSummary.measurementType)}</p>
                </div>
                <div className="rounded-2xl bg-white/70 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Total</p>
                  <p className="text-2xl font-bold text-emerald-950">{intervalSummaryTotals.total}</p>
                </div>
                <div className="rounded-2xl bg-white/70 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">SIM</p>
                  <p className="text-2xl font-bold text-emerald-700">{intervalSummaryTotals.occurred}</p>
                </div>
                <div className="rounded-2xl bg-white/70 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">NAO</p>
                  <p className="text-2xl font-bold text-emerald-700">{intervalSummaryTotals.notOccurred}</p>
                </div>
                <div className="rounded-2xl bg-white/70 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Ocorrencia</p>
                  <p className="text-2xl font-bold text-emerald-700">{intervalSummaryTotals.percent}%</p>
                </div>
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

              {isIntervalMeasurement(behaviorMeasurementType) && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Duracao do intervalo
                      <select
                        value={intervalDurationMode}
                        onChange={(event) => setIntervalDurationMode(event.target.value)}
                        disabled={Boolean(intervalRun)}
                        className="mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none disabled:opacity-60"
                      >
                        {intervalDurationOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                    </label>
                    {intervalDurationMode === 'custom' && (
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Segundos
                        <input
                          type="number"
                          min={1}
                          max={3600}
                          value={intervalCustomSeconds}
                          onChange={(event) => setIntervalCustomSeconds(Number(event.target.value))}
                          disabled={Boolean(intervalRun)}
                          className="mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none disabled:opacity-60"
                        />
                      </label>
                    )}
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Quantidade
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={intervalTotalIntervals}
                        onChange={(event) => setIntervalTotalIntervals(Math.max(1, Number(event.target.value) || 1))}
                        disabled={Boolean(intervalRun)}
                        className="mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none disabled:opacity-60"
                      />
                    </label>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Alerta
                      <select
                        value={intervalAlertType}
                        onChange={(event) => setIntervalAlertType(event.target.value)}
                        disabled={Boolean(intervalRun)}
                        className="mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-3 text-xs font-bold text-gray-700 outline-none disabled:opacity-60"
                      >
                        {intervalAlertOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <button
                    onClick={handleSelectedBehaviorAction}
                    disabled={Boolean(intervalRun)}
                    className={`px-5 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${intervalRun ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-[#7a32fc] text-white'}`}
                  >
                    <Play size={16} /> Iniciar coleta por intervalo
                  </button>
                  {intervalRun && intervalRun.behaviorId === selectedBehavior.id && (
                    <p className="text-xs font-semibold text-gray-500">
                      Ja existe uma coleta por intervalo em andamento para este comportamento.
                    </p>
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
            ) : records.slice(0, 18).map((record) => {
              const lockedIntervalRecord = isIntervalHistoryRecord(record);
              return (
              <div key={record.id} className="rounded-2xl border border-gray-100 bg-[#F8FAFF] p-4">
                {editingRecordId === record.id ? (
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{record.kind === 'trial' ? 'Tentativa' : 'Comportamento'}</p>
                    {lockedIntervalRecord ? (
                      <div className="rounded-xl border border-blue-100 bg-white px-3 py-3">
                        <p className="text-sm font-bold text-gray-800">{record.title}</p>
                        <p className="mt-1 text-xs text-gray-500">{record.detail}</p>
                        {record.intervalNumber || record.intervalIndex ? (
                          <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                            Intervalo {record.intervalNumber || record.intervalIndex} preservado
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <>
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
                      </>
                    )}
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
              );
            })}
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
