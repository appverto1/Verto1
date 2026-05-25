import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Activity,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  Flame,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Square,
  StopCircle,
  Timer,
  X,
  Zap
} from 'lucide-react';
import { sanitizeDescriptionForDisplay } from '../utils/mediaSecurity';
import { dataService } from '../services/dataService';
import { ABA_PROMPT_LEVEL_OPTIONS, resolveAbaPromptLevel } from '../utils/abaPromptLevels';
import { buildSessionReport, calculateSessionSummary, canCloseAbaSession, canRecordInAbaSession, type SessionSummary, type SessionSummaryPendingItem } from '../utils/abaSessionSummary';
import { isAbaV2Enabled } from '../utils/featureFlags';
import { buildClinicalActionToast, buildClinicalOfflineToast, buildClinicalSaveErrorToast, type ClinicalActionToast } from '../utils/abaSessionFeedback';
import { getCrisisShortcutIds, getDockVisibleShortcuts, normalizeQuickBehaviorShortcuts } from '../utils/abaClinicalDock';
import {
  buildIntervalAggregateSummary,
  buildIntervalCancelAudit,
  getIntervalRunStatus,
  pauseIntervalRunState,
  resumeIntervalRunState,
  type AbaIntervalCollectionStatus
} from '../utils/abaIntervalLifecycle';
import { evaluateMaintenanceStatus, evaluateTargetMastery, formatAbaMasteryCriterion } from '../utils/abaMasteryEngine';

type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';
type AbcRequirement = 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL' | 'DISABLED';

type SessionRecord = {
  id: string;
  kind: 'trial' | 'behavior';
  title: string;
  detail: string;
  timestamp: string;
  syncStatus: SyncStatus;
  targetId?: string | null;
  targetName?: string | null;
  programId?: string | null;
  therapistId?: string | null;
  measurementType?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number | null;
  countDelta?: number | null;
  trialOutcome?: 'independent' | 'prompted' | 'error';
  collectionType?: string;
  promptLevelKey?: string;
  score?: number | null;
  correct?: boolean;
  independent?: boolean;
  behaviorId?: string | null;
  intervalNumber?: number | null;
  intervalIndex?: number | null;
  intervalOccurred?: boolean | null;
  intervalStartedAt?: string | null;
  intervalEndedAt?: string | null;
  intervalAggregate?: boolean;
  totalIntervals?: number | null;
  plannedIntervals?: number | null;
  answeredIntervals?: number | null;
  yesCount?: number | null;
  noCount?: number | null;
  occurredCount?: number | null;
  notOccurredCount?: number | null;
  occurrencePercent?: number | null;
  collectionStatus?: AbaIntervalCollectionStatus | string;
  status?: AbaIntervalCollectionStatus | string;
  pausedAt?: string | null;
  resumedAt?: string | null;
  endedEarlyAt?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string;
  endReason?: string;
  intervalCancelled?: boolean;
  clinicalAudit?: boolean;
  rawPayload?: Record<string, any>;
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
  { key: 'frequency', label: 'Frequência' },
  { key: 'duration', label: 'Duração' },
  { key: 'rate', label: 'Taxa' },
  { key: 'partial_interval', label: 'Intervalo parcial' },
  { key: 'whole_interval', label: 'Intervalo total' },
  { key: 'momentary_time_sampling', label: 'Amostragem momentânea' },
  { key: 'abc', label: 'ABC' }
];

const behaviorPresets = [
  { id: 'crying', name: 'Choro', defaultMeasurement: 'duration', allowedMeasurements: ['duration'], abcRequirement: 'RECOMMENDED' as AbcRequirement, tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  { id: 'escape', name: 'Fuga da atividade', defaultMeasurement: 'duration', allowedMeasurements: ['duration'], abcRequirement: 'RECOMMENDED' as AbcRequirement, tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'aggression', name: 'Agressão', defaultMeasurement: 'frequency', allowedMeasurements: ['frequency'], abcRequirement: 'REQUIRED' as AbcRequirement, tone: 'bg-red-50 text-red-700 border-red-100' },
  { id: 'self_injury', name: 'Autoagressão', defaultMeasurement: 'frequency', allowedMeasurements: ['frequency'], abcRequirement: 'REQUIRED' as AbcRequirement, tone: 'bg-rose-50 text-rose-700 border-rose-100' },
  { id: 'refusal', name: 'Recusa', defaultMeasurement: 'frequency', allowedMeasurements: ['frequency'], abcRequirement: 'RECOMMENDED' as AbcRequirement, tone: 'bg-violet-50 text-violet-700 border-violet-100' },
  { id: 'stereotypy', name: 'Estereotipia', defaultMeasurement: 'partial_interval', allowedMeasurements: ['partial_interval', 'whole_interval', 'momentary_time_sampling', 'duration'], abcRequirement: 'OPTIONAL' as AbcRequirement, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' }
];

const antecedentOptions = ['Demanda apresentada', 'Transição', 'Espera', 'Negação de acesso', 'Barulho', 'Atenção dividida'];
const consequenceOptions = ['Redirecionamento', 'Pausa breve', 'Reforço diferencial', 'Ajuda física', 'Bloqueio seguro', 'Acesso removido'];
const locationOptions = ['Mesa', 'Sala de terapia', 'Brinquedoteca', 'Corredor', 'Banheiro', 'Recepção'];
const severityOptions = [1, 2, 3, 4, 5];
const intervalDurationOptions = [
  { key: '10', label: '10s', seconds: 10 },
  { key: '30', label: '30s', seconds: 30 },
  { key: '60', label: '1min', seconds: 60 },
  { key: '120', label: '2min', seconds: 120 },
  { key: 'custom', label: 'Customizado', seconds: null }
];
const intervalAlertOptions = [
  { key: 'vibration', label: 'Vibração' },
  { key: 'sound', label: 'Som' },
  { key: 'both', label: 'Ambos' },
  { key: 'silent', label: 'Silencioso' }
];
const intervalLifecycleReasonOptions = [
  { key: '', label: 'Sem motivo informado' },
  { key: 'crise_intercorrencia', label: 'Crise/intercorrência' },
  { key: 'pausa_paciente', label: 'Pausa do paciente' },
  { key: 'erro_configuracao', label: 'Erro de configuração' },
  { key: 'mudanca_atividade', label: 'Mudança de atividade' },
  { key: 'encerramento_sessao', label: 'Encerramento da sessão' },
  { key: 'outro', label: 'Outro' }
];

const AbaSessionToast = ({ toast, compact = false }: { toast: ClinicalActionToast; compact?: boolean }) => {
  const variantClass = {
    success: 'border-emerald-100 bg-white text-emerald-700 shadow-emerald-900/10',
    warning: 'border-amber-100 bg-white text-amber-700 shadow-amber-900/10',
    error: 'border-red-100 bg-white text-red-600 shadow-red-900/10',
    info: 'border-blue-100 bg-white text-blue-700 shadow-blue-900/10'
  }[toast.variant];
  const iconClass = {
    success: 'bg-emerald-50 text-emerald-600',
    warning: 'bg-amber-50 text-amber-600',
    error: 'bg-red-50 text-red-600',
    info: 'bg-blue-50 text-blue-600'
  }[toast.variant];
  const Icon = toast.variant === 'success' ? CheckCircle2 : toast.variant === 'error' ? AlertCircle : toast.variant === 'warning' ? Clock : Zap;
  const title = compact ? (toast.compactTitle || toast.title) : toast.title;
  const subtitle = compact ? (toast.compactSubtitle || toast.subtitle) : toast.subtitle;

  return (
    <div
      role="status"
      aria-live="polite"
      data-aba-toast-compact={compact ? 'true' : 'false'}
      className={`pointer-events-none flex border shadow-2xl animate-pop ${compact ? 'w-auto max-w-[calc(100vw-2rem)] items-center gap-2 rounded-2xl px-3 py-2' : 'w-[calc(100vw-1.5rem)] max-w-sm items-start gap-3 rounded-[22px] px-4 py-3 sm:w-[360px]'} ${variantClass}`}
    >
      <span className={`inline-flex shrink-0 items-center justify-center rounded-2xl ${compact ? 'hidden' : 'mt-0.5 h-9 w-9'} ${iconClass}`}>
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className={`block font-extrabold leading-tight text-slate-900 ${compact ? 'truncate text-xs' : 'text-sm'}`}>{title}</span>
        {subtitle ? (
          <span className={`block font-semibold leading-snug text-slate-500 ${compact ? 'mt-0.5 truncate text-[11px]' : 'mt-1 text-xs'}`}>{subtitle}</span>
        ) : null}
      </span>
    </div>
  );
};

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

const formatDurationSeconds = (durationSeconds: number) => {
  const safeSeconds = Math.max(0, Math.round(Number(durationSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatSessionDuration = (durationSeconds: number) => {
  const safeSeconds = Math.max(0, Math.round(Number(durationSeconds) || 0));
  if (safeSeconds < 120) return formatDurationSeconds(safeSeconds);
  const totalMinutes = Math.round(safeSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h${minutes}min` : `${hours}h`;
};

const formatSessionTime = (value: string) => new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

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

const normalizeAbcRequirement = (value: any): AbcRequirement => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'REQUIRED' || normalized === 'RECOMMENDED' || normalized === 'OPTIONAL' || normalized === 'DISABLED') {
    return normalized;
  }
  return 'OPTIONAL';
};

const mapRecentAbaEventToSessionRecord = (event: any): SessionRecord | null => {
  const tableName = String(event?.tableName || event?.table_name || '').toLowerCase();
  const kind = String(event?.kind || '').toLowerCase();
  const isTrial = kind === 'trial' || tableName === 'aba_trials';
  const isBehavior = kind === 'behavior' || tableName === 'aba_behavior_events';
  if (!event?.id || (!isTrial && !isBehavior)) return null;

  if (isTrial) {
    const correct = Boolean(event.correct ?? event.isCorrect);
    const independent = Boolean(event.independent ?? event.isIndependent);
    const outcome: SessionRecord['trialOutcome'] = !correct ? 'error' : independent ? 'independent' : 'prompted';
    const promptLabel = event.prompt_level_name || event.promptLevelName || event.prompt_level_key || event.promptLevelKey;
    return {
      id: String(event.id),
      kind: 'trial',
      title: String(event.target_name || event.targetName || 'Tentativa'),
      detail: outcome === 'independent'
        ? 'independente'
        : outcome === 'prompted'
          ? `com ajuda${promptLabel ? ` - ${promptLabel}` : ''}`
          : 'erro',
      timestamp: String(event.occurred_at || event.occurredAt || event.created_at || event.createdAt || new Date().toISOString()),
      syncStatus: normalizeSyncStatus(event.sync_status || event.syncStatus || 'synced'),
      targetId: event.target_id || event.targetId || null,
      targetName: event.target_name || event.targetName || null,
      programId: event.program_id || event.programId || null,
      therapistId: event.therapist_id || event.therapistId || null,
      trialOutcome: outcome,
      collectionType: event.collection_type || event.collectionType,
      promptLevelKey: event.prompt_level_key || event.promptLevelKey,
      score: event.response_score ?? event.responseScore ?? event.score ?? null,
      correct,
      independent
    };
  }

  const measurementType = String(event.measurement_type || event.measurementType || 'frequency');
  const durationSeconds = event.duration_seconds ?? event.durationSeconds ?? null;
  const countDelta = event.count_delta ?? event.countDelta ?? null;
  const detail = measurementType === 'duration'
    ? durationSeconds
      ? `duração ${formatSessionDuration(Number(durationSeconds || 0))}`
      : 'duração em andamento'
    : measurementType === 'frequency'
      ? `frequência +${Number(countDelta || 1)}`
      : getMeasurementLabel(measurementType);

  return {
    id: String(event.id),
    kind: 'behavior',
    title: String(event.behavior_name || event.behaviorName || 'Comportamento'),
    detail,
    timestamp: String(event.occurred_at || event.occurredAt || event.started_at || event.startedAt || event.created_at || event.createdAt || new Date().toISOString()),
    syncStatus: normalizeSyncStatus(event.sync_status || event.syncStatus || 'synced'),
    measurementType,
    startedAt: event.started_at || event.startedAt || null,
    endedAt: event.ended_at || event.endedAt || null,
    durationSeconds,
    countDelta,
    behaviorId: event.behavior_id || event.behaviorId || null,
    intervalNumber: event.interval_number ?? event.intervalNumber ?? null,
    intervalIndex: event.interval_index ?? event.intervalIndex ?? null,
    intervalOccurred: event.interval_occurred ?? event.intervalOccurred ?? event.occurred ?? null,
    intervalStartedAt: event.interval_started_at || event.intervalStartedAt || null,
    intervalEndedAt: event.interval_ended_at || event.intervalEndedAt || null,
    location: event.location,
    severity: event.severity ?? null,
    antecedent: event.antecedent,
    consequence: event.consequence,
    notes: event.notes
  };
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

const masteryNumber = (value: any, fallback: number, min = 0, max = 100000) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const readMasteryValue = (row: any, ...keys: string[]) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return undefined;
};

const buildSessionGoalMasteryCriterion = (goal: any) => {
  const embedded = goal?.mastery_criteria || goal?.masteryCriteria || {};
  const legacyDays = masteryNumber(
    readMasteryValue(goal, 'meta_sucessos', 'metaSucessos', 'masteryTarget', 'mastery_target'),
    masteryNumber(readMasteryValue(embedded, 'min_consecutive_days', 'minConsecutiveDays'), 1, 1),
    1
  );
  return {
    id: readMasteryValue(embedded, 'id') || readMasteryValue(goal, 'masteryCriteriaId', 'criteriaId') || null,
    organization_id: readMasteryValue(goal, 'organization_id', 'organizationId', 'clinic_id', 'clinicId') || null,
    program_id: readMasteryValue(goal, 'program_id', 'programId', 'protocol_id', 'protocolId') || null,
    target_id: readMasteryValue(goal, 'id', 'target_id', 'targetId') || null,
    name: readMasteryValue(embedded, 'name') || 'Criterio da meta',
    min_accuracy_percent: masteryNumber(readMasteryValue(embedded, 'min_accuracy_percent', 'minAccuracyPercent', 'accuracyPercent'), 80, 0, 100),
    min_independence_percent: masteryNumber(readMasteryValue(embedded, 'min_independence_percent', 'minIndependencePercent', 'independencePercent'), 80, 0, 100),
    min_trials_per_session: Math.max(1, Math.round(masteryNumber(readMasteryValue(embedded, 'min_trials_per_session', 'minTrialsPerSession'), 1, 1))),
    min_consecutive_days: Math.max(1, Math.round(legacyDays)),
    require_first_trial_independent: Boolean(readMasteryValue(embedded, 'require_first_trial_independent', 'requireFirstTrialIndependent')),
    cold_probe_only: Boolean(readMasteryValue(embedded, 'cold_probe_only', 'coldProbeOnly')),
    min_distinct_therapists: Math.max(1, Math.round(masteryNumber(readMasteryValue(embedded, 'min_distinct_therapists', 'minDistinctTherapists'), 1, 1))),
    maintenance_required: Boolean(readMasteryValue(embedded, 'maintenance_required', 'maintenanceRequired')),
    maintenance_days: readMasteryValue(embedded, 'maintenance_days', 'maintenanceDays') ?? null,
    is_active: readMasteryValue(embedded, 'is_active', 'isActive') ?? true
  };
};

const masteryStatusLabel = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'READY_FOR_REVIEW') return 'Pronto para revisão do supervisor';
  if (normalized === 'MET_TODAY') return 'Critério atingido hoje';
  if (normalized === 'NOT_MET') return 'Critério não atingido';
  if (normalized === 'MASTERED_APPROVED') return 'Maestria aprovada';
  if (normalized === 'REGRESSION_RISK') return 'Risco de regressão';
  return 'Dados insuficientes';
};

const isMaintenanceLikeGoal = (goal: any) => {
  const values = [
    goal?.clinical_status,
    goal?.clinicalStatus,
    goal?.phase,
    goal?.status
  ].map((value) => String(value || '').trim().toLowerCase());
  return values.some((value) => ['completed', 'mastered', 'maintenance', 'maintained', 'ready_for_review', 'regression_risk'].includes(value));
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
  therapistId,
  clinicId
}: any) => {
  if (!isAbaV2Enabled()) return null;

  const sessionGoals = (patient.pei?.filter((g: any) => g.isPriority || g.status === 'in_progress' || isMaintenanceLikeGoal(g)) || [])
    .sort((a: any, b: any) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0));

  const sessionId = String(activeSession?.id || `draft-${patient?.id || 'patient'}`);
  const patientId = String(patient?.id || '');
  const resolvedTherapistId = String(therapistId || activeSession?.therapistId || activeSession?.therapist_id || '').trim();
  const resolvedClinicId = String(clinicId || activeSession?.clinicId || activeSession?.clinic_id || patient?.clinicId || patient?.clinic_id || patient?.organizationId || patient?.organization_id || '').trim();
  const sessionStateKey = `verto.aba_session_state:${patientId}:${sessionId}`;

  const [trialCount, setTrialCount] = useState(0);
  const [activeCriteria, setActiveCriteria] = useState<string | null>(null);
  const [collectionType, setCollectionType] = useState('dtt');
  const [promptLevelKey, setPromptLevelKey] = useState('verbal');
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [sessionLiveSummary, setSessionLiveSummary] = useState<any>(null);
  const [maintenanceOverview, setMaintenanceOverview] = useState<any>({ schedules: [], probeResults: [], alerts: [], summary: null });
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
  const [intervalOptionsOpen, setIntervalOptionsOpen] = useState(false);
  const [intervalCancelConfirmOpen, setIntervalCancelConfirmOpen] = useState(false);
  const [intervalZeroFinishConfirmOpen, setIntervalZeroFinishConfirmOpen] = useState(false);
  const [intervalEndReason, setIntervalEndReason] = useState('');
  const [intervalCancelReason, setIntervalCancelReason] = useState('');
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
  const [sessionEndPreviewAt, setSessionEndPreviewAt] = useState('');
  const [sessionNote, setSessionNote] = useState('');
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [postClosureSummary, setPostClosureSummary] = useState<SessionSummary | null>(null);
  const [showPostClosureReport, setShowPostClosureReport] = useState(false);
  const [showComplementEditor, setShowComplementEditor] = useState(false);
  const [durationBlockModalOpen, setDurationBlockModalOpen] = useState(false);
  const [promptSelectionGoal, setPromptSelectionGoal] = useState<any>(null);
  const [promptWarning, setPromptWarning] = useState('');
  const [mobileFocusMode, setMobileFocusMode] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [clinicalDockSheetOpen, setClinicalDockSheetOpen] = useState(false);
  const [crisisMode, setCrisisMode] = useState(false);
  const [actionToast, setActionToast] = useState<ClinicalActionToast | null>(null);
  const [actionLocks, setActionLocks] = useState<Record<string, boolean>>({});
  const [microFeedback, setMicroFeedback] = useState<Record<string, 'pulse' | 'check' | 'plus'>>({});
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
  const [clinicalDockHeight, setClinicalDockHeight] = useState(0);
  const actionToastTimerRef = useRef<number | null>(null);
  const actionLocksRef = useRef<Record<string, boolean>>({});
  const actionLockTimersRef = useRef<Record<string, number>>({});
  const microFeedbackTimersRef = useRef<Record<string, number>>({});
  const sessionScrollRef = useRef<HTMLDivElement | null>(null);
  const clinicalDockRef = useRef<HTMLDivElement | null>(null);
  const intervalPausedControlsRef = useRef<HTMLDivElement | null>(null);

  const selectedBehavior = useMemo(
    () => behaviorPresets.find((behavior) => behavior.id === selectedBehaviorId) || behaviorPresets[0],
    [selectedBehaviorId]
  );
  const selectedBehaviorMeasurements = selectedBehavior.allowedMeasurements || [selectedBehavior.defaultMeasurement];
  const selectedBehaviorAllowsMultipleMethods = selectedBehaviorMeasurements.length > 1;
  const selectedBehaviorMethodOptions = behaviorMeasurementOptions.filter((option) => selectedBehaviorMeasurements.includes(option.key));
  const quickBehaviorShortcuts = useMemo(() => normalizeQuickBehaviorShortcuts(
    patient?.quickBehaviorShortcuts ||
    patient?.quick_behavior_shortcuts ||
    patient?.abaSettings?.quickBehaviorShortcuts ||
    patient?.clinicSettings?.quickBehaviorShortcuts ||
    patient?.clinicSettings?.abaQuickBehaviorShortcuts,
    behaviorPresets
  ), [patient?.abaSettings?.quickBehaviorShortcuts, patient?.clinicSettings?.abaQuickBehaviorShortcuts, patient?.clinicSettings?.quickBehaviorShortcuts, patient?.quickBehaviorShortcuts, patient?.quick_behavior_shortcuts]);
  const dockShortcuts = useMemo(() => getDockVisibleShortcuts(quickBehaviorShortcuts, { crisisMode, limit: 3 }), [crisisMode, quickBehaviorShortcuts]);
  const crisisShortcutIdSet = useMemo(() => new Set(getCrisisShortcutIds()), []);
  const recentBehaviorRecords = useMemo(() => records.filter((record) => record.kind === 'behavior' && !isCancelledIntervalClinicalRecord(record)).slice(0, 5), [records]);
  const intervalRunStatus = getIntervalRunStatus(intervalRun);
  const intervalRunPaused = intervalRunStatus === 'PAUSED';
  const intervalRunAwaitingResponse = intervalRunStatus === 'AWAITING_RESPONSE';
  const intervalResponseActive = Boolean((intervalRunAwaitingResponse || intervalRun?.awaitingResponse) && !intervalRun?.paused && !intervalRun?.completed);
  const intervalToastCompact = Boolean(intervalRun && intervalRunStatus !== 'PAUSED' && intervalRunStatus !== 'COMPLETED' && intervalRunStatus !== 'PARTIALLY_COMPLETED' && intervalRunStatus !== 'CANCELLED');
  const vibrateClinicalAction = (pattern: number | number[]) => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Vibration is best-effort and should never block clinical recording.
    }
  };

  const showClinicalToast = (toast: ClinicalActionToast, vibration: 'success' | 'error' | 'none' = 'success') => {
    if (actionToastTimerRef.current) window.clearTimeout(actionToastTimerRef.current);
    setActionToast({ ...toast, id: toast.id || crypto.randomUUID() });
    if (vibration === 'success') vibrateClinicalAction(30);
    if (vibration === 'error') vibrateClinicalAction([30, 60, 30]);
    actionToastTimerRef.current = window.setTimeout(() => {
      setActionToast(null);
      actionToastTimerRef.current = null;
    }, intervalToastCompact ? 1500 : 2000);
  };

  const showPersistResultToast = (result: any) => {
    if (!result) return;
    if (result?.success === false && !result?.pending && !result?.offline) {
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      return;
    }
    if (result?.pending || result?.offline) {
      showClinicalToast(buildClinicalOfflineToast(), 'none');
    }
  };

  const releaseActionLock = (key: string) => {
    const nextLocks = { ...actionLocksRef.current };
    delete nextLocks[key];
    actionLocksRef.current = nextLocks;
    if (actionLockTimersRef.current[key]) {
      window.clearTimeout(actionLockTimersRef.current[key]);
      delete actionLockTimersRef.current[key];
    }
    setActionLocks((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const lockAction = (key: string, debounceMs: number) => {
    if (actionLocksRef.current[key]) return false;
    actionLocksRef.current = { ...actionLocksRef.current, [key]: true };
    setActionLocks((prev) => ({ ...prev, [key]: true }));
    if (debounceMs > 0) {
      actionLockTimersRef.current[key] = window.setTimeout(() => releaseActionLock(key), debounceMs);
    }
    return true;
  };

  const triggerMicroFeedback = (key: string, kind: 'pulse' | 'check' | 'plus') => {
    if (microFeedbackTimersRef.current[key]) window.clearTimeout(microFeedbackTimersRef.current[key]);
    setMicroFeedback((prev) => ({ ...prev, [key]: kind }));
    microFeedbackTimersRef.current[key] = window.setTimeout(() => {
      setMicroFeedback((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      delete microFeedbackTimersRef.current[key];
    }, 650);
  };

  useEffect(() => () => {
    if (actionToastTimerRef.current) window.clearTimeout(actionToastTimerRef.current);
    Object.values(actionLockTimersRef.current).forEach((timer) => window.clearTimeout(Number(timer)));
    Object.values(microFeedbackTimersRef.current).forEach((timer) => window.clearTimeout(Number(timer)));
  }, []);

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
      setSessionNote(String(persisted.sessionNote || ''));
      setSessionCompleted(Boolean(persisted.sessionCompleted || String(activeSession?.status || '').toLowerCase() === 'completed'));
      setPostClosureSummary(persisted.postClosureSummary || null);
      setTrialCount(Number(persisted.trialCount || 0));
    } catch {
      setRecords([]);
      setOpenDurations([]);
      setRateWindow(null);
      setIntervalRun(null);
      setIntervalSummary(null);
      setSessionNote('');
      setSessionCompleted(String(activeSession?.status || '').toLowerCase() === 'completed');
      setPostClosureSummary(null);
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
          sessionNote,
          sessionCompleted,
          postClosureSummary,
          trialCount
        })
      );
    } catch {
      // Local session history is a convenience layer; encrypted offline cache remains the source of truth.
    }
  }, [hydratedSessionStateKey, intervalRun, intervalSummary, openDurations, postClosureSummary, rateWindow, records, sessionCompleted, sessionNote, sessionStateKey, trialCount]);

  useEffect(() => {
    let cancelled = false;
    const loadLiveSummary = async () => {
      if (!sessionId || sessionId.startsWith('draft-') || sessionCompleted) {
        setSessionLiveSummary(null);
        return;
      }
      try {
        const result = await dataService.getSessionLiveSummary(sessionId);
        if (!cancelled) setSessionLiveSummary(result?.data || null);
      } catch {
        if (!cancelled) setSessionLiveSummary(null);
      }
    };
    void loadLiveSummary();
    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionCompleted]);

  useEffect(() => {
    let cancelled = false;
    const loadRecentSessionEvents = async () => {
      if (hydratedSessionStateKey !== sessionStateKey) return;
      if (!sessionId || sessionId.startsWith('draft-') || sessionCompleted) return;
      try {
        const result = await dataService.getRecentSessionEvents(sessionId, 20);
        if (cancelled || !Array.isArray(result?.data)) return;
        const recentRecords = result.data
          .map(mapRecentAbaEventToSessionRecord)
          .filter(Boolean) as SessionRecord[];
        if (recentRecords.length === 0) return;
        setRecords((prev) => {
          const existingIds = new Set(prev.map((record) => record.id));
          const next = [
            ...prev,
            ...recentRecords.filter((record) => !existingIds.has(record.id))
          ];
          return next
            .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
            .slice(0, 40);
        });
      } catch {
        // Recent events are an egress-limited convenience read; local session state remains usable.
      }
    };
    void loadRecentSessionEvents();
    return () => {
      cancelled = true;
    };
  }, [hydratedSessionStateKey, sessionId, sessionCompleted, sessionStateKey]);

  useEffect(() => {
    let cancelled = false;
    const loadMaintenanceOverview = async () => {
      if (!patientId) {
        setMaintenanceOverview({ schedules: [], probeResults: [], alerts: [], summary: null });
        return;
      }
      try {
        const result = await dataService.getAbaMaintenanceOverview(patientId, { page: 1, pageSize: 20 });
        if (!cancelled) setMaintenanceOverview(result?.data || { schedules: [], probeResults: [], alerts: [], summary: null });
      } catch {
        if (!cancelled) setMaintenanceOverview({ schedules: [], probeResults: [], alerts: [], summary: null });
      }
    };
    void loadMaintenanceOverview();
    return () => {
      cancelled = true;
    };
  }, [patientId, sessionId, sessionCompleted]);

  useEffect(() => {
    const hasRunningTimer = openDurations.length > 0 || rateWindow || intervalRun;
    if (!hasRunningTimer) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [intervalRun, openDurations.length, rateWindow]);

  useEffect(() => {
    if (intervalRunAwaitingResponse) setClinicalDockSheetOpen(false);
  }, [intervalRunAwaitingResponse]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateDockHeight = () => {
      const nextHeight = clinicalDockRef.current?.getBoundingClientRect().height || 0;
      setClinicalDockHeight(Math.ceil(nextHeight));
    };
    updateDockHeight();
    window.addEventListener('resize', updateDockHeight);
    let resizeObserver: ResizeObserver | null = null;
    if (clinicalDockRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateDockHeight);
      resizeObserver.observe(clinicalDockRef.current);
    }
    return () => {
      window.removeEventListener('resize', updateDockHeight);
      resizeObserver?.disconnect();
    };
  }, [clinicalDockSheetOpen, crisisMode, dockShortcuts.length, intervalResponseActive, intervalRunPaused, openDurations.length]);

  useEffect(() => {
    if (!intervalRunPaused) return;
    const animationFrame = window.requestAnimationFrame(() => {
      const scrollContainer = sessionScrollRef.current;
      const controls = intervalPausedControlsRef.current;
      if (!scrollContainer || !controls) return;
      const containerRect = scrollContainer.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      const dockGuard = clinicalDockHeight + 24;
      const visibleBottom = containerRect.bottom - dockGuard;
      const bottomOverflow = controlsRect.bottom - visibleBottom;
      const topOverflow = controlsRect.top - containerRect.top;
      if (bottomOverflow > 0) {
        scrollContainer.scrollBy({ top: bottomOverflow + 16, behavior: 'smooth' });
      } else if (topOverflow < 0) {
        scrollContainer.scrollBy({ top: topOverflow - 16, behavior: 'smooth' });
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [clinicalDockHeight, intervalRun?.id, intervalRun?.intervalIndex, intervalRunPaused]);

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
    const status = getIntervalRunStatus(intervalRun);
    if (!intervalRun || status !== 'RUNNING') return;
    if (!intervalRun.intervalEndsAt) return;
    if (nowMs < new Date(intervalRun.intervalEndsAt).getTime()) return;
    triggerIntervalAlert(intervalRun.alertType || 'both');
    setIntervalRun((prev: any) => {
      if (!prev || prev.id !== intervalRun.id || getIntervalRunStatus(prev) !== 'RUNNING') return prev;
      return { ...prev, status: 'AWAITING_RESPONSE', collectionStatus: 'AWAITING_RESPONSE', awaitingResponse: true, alertFiredAt: new Date().toISOString() };
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

  const ensureSessionCanRecord = () => {
    if (canRecordInAbaSession({ sessionCompleted, status: activeSession?.status })) return true;
    setSessionWarning('Sessão já encerrada. O histórico permanece editável apenas para complementos permitidos.');
    return false;
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
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        therapist_id: resolvedTherapistId || undefined,
        therapistId: resolvedTherapistId || undefined,
        source: 'verto_web'
      });
      updateRecordStatus(record.id, result?.success && !result?.pending && !result?.offline ? 'synced' : 'local');
      showPersistResultToast(result);
      onSessionRecordSaved?.();
      return result;
    } catch (error) {
      updateRecordStatus(record.id, 'error');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
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
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        therapist_id: resolvedTherapistId || undefined,
        therapistId: resolvedTherapistId || undefined,
        source: 'verto_web'
      });
      updateRecordStatus(record.id, result?.success && !result?.pending && !result?.offline ? 'synced' : 'local');
      showPersistResultToast(result);
      onSessionRecordSaved?.();
      return result;
    } catch (error) {
      updateRecordStatus(record.id, 'error');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      console.error('Falha ao persistir evento ABA:', error);
      return { success: false, error };
    }
  };

  const saveIntervalRecord = async (payload: any, record: Omit<SessionRecord, 'syncStatus'>) => {
    addRecord(record, 'local');
    setTimeout(() => updateRecordStatus(record.id, 'syncing'), 60);
    try {
      const result = await dataService.saveAbaIntervalRecord({
        ...payload,
        patient_id: patientId,
        patientId,
        session_id: sessionId,
        sessionId,
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        therapist_id: resolvedTherapistId || undefined,
        therapistId: resolvedTherapistId || undefined,
        source: 'verto_web'
      });
      updateRecordStatus(record.id, result?.success && !result?.pending && !result?.offline ? 'synced' : 'local');
      showPersistResultToast(result);
      onSessionRecordSaved?.();
      return result;
    } catch (error) {
      updateRecordStatus(record.id, 'error');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      console.error('Falha ao persistir intervalo ABA:', error);
      return { success: false, error };
    }
  };

  const saveIntervalSummaryRecord = async (payload: any, record: Omit<SessionRecord, 'syncStatus'>) => {
    addRecord(record, 'local');
    setTimeout(() => updateRecordStatus(record.id, 'syncing'), 60);
    try {
      const result = await dataService.saveAbaIntervalSummary({
        ...payload,
        patient_id: patientId,
        patientId,
        session_id: sessionId,
        sessionId,
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        therapist_id: resolvedTherapistId || undefined,
        therapistId: resolvedTherapistId || undefined,
        source: 'verto_web'
      });
      updateRecordStatus(record.id, result?.success && !result?.pending && !result?.offline ? 'synced' : 'local');
      showPersistResultToast(result);
      onSessionRecordSaved?.();
      return result;
    } catch (error) {
      updateRecordStatus(record.id, 'error');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      console.error('Falha ao persistir resumo de intervalo ABA:', error);
      return { success: false, error };
    }
  };

  const saveAbcClinicalEvent = async (payload: any, record: Omit<SessionRecord, 'syncStatus'>, mode: 'add' | 'upsert' = 'add') => {
    if (mode === 'upsert') upsertRecord(record, 'local');
    else addRecord(record, 'local');
    setTimeout(() => updateRecordStatus(record.id, 'syncing'), 60);
    try {
      const result = await dataService.saveAbaAbcEvent({
        ...payload,
        patient_id: patientId,
        patientId,
        session_id: sessionId,
        sessionId,
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        therapist_id: resolvedTherapistId || undefined,
        therapistId: resolvedTherapistId || undefined,
        source: 'verto_web'
      });
      updateRecordStatus(record.id, result?.success && !result?.pending && !result?.offline ? 'synced' : 'local');
      showPersistResultToast(result);
      onSessionRecordSaved?.();
      return result;
    } catch (error) {
      updateRecordStatus(record.id, 'error');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      console.error('Falha ao persistir ABC ABA:', error);
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
      clinic_id: resolvedClinicId || undefined,
      clinicId: resolvedClinicId || undefined,
      patient_id: patientId,
      patientId,
      session_id: sessionId,
      sessionId,
      therapist_id: resolvedTherapistId || undefined,
      therapistId: resolvedTherapistId || undefined,
      source: 'verto_web',
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
        clinicId: resolvedClinicId || undefined,
        patientId,
        sessionId,
        therapistId: resolvedTherapistId || null,
        source: 'session_mode_intelligent_behavior',
        clientSource: 'verto_web',
        sessionReferenceDate: activeSession?.referenceDate || null,
        syncStatus: 'local'
      },
      ...overrides
    };
  };

  const handleTrialClick = async (goal: any, score: number, outcome: 'independent' | 'prompted' | 'error', promptedPromptKey?: string) => {
    if (!ensureSessionCanRecord()) return;
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
    const trialLockKey = `trial:${String(goal?.id || goal?.name || 'goal')}:${outcome}:${selectedPrompt.key}`;
    if (!lockAction(trialLockKey, 600)) return;
    setPromptWarning('');
    const isCorrect = outcome !== 'error' && score > 0;
    const isIndependent = outcome === 'independent';
    const trialId = `trial-ui-${crypto.randomUUID()}`;
    const collectionLabel = collectionOptions.find((option) => option.key === collectionType)?.label || collectionType;

    addRecord({
      id: trialId,
      kind: 'trial',
      title: goal.name,
      detail: `${collectionLabel} - ${selectedPrompt.label} - ${score}`,
      timestamp,
      targetId: goal?.id || null,
      targetName: goal?.name || null,
      programId: goal?.programId || goal?.program_id || goal?.protocolId || null,
      therapistId: resolvedTherapistId || null,
      trialOutcome: outcome,
      collectionType,
      promptLevelKey: selectedPrompt.key,
      score,
      correct: isCorrect,
      independent: isIndependent
    });
    triggerMicroFeedback(trialLockKey, 'check');
    showClinicalToast(buildClinicalActionToast({
      action: 'trial',
      outcome,
      collectionLabel,
      promptLabel: selectedPrompt.label,
      score
    }));
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
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      console.error('Falha ao persistir tentativa ABA:', error);
    }
  };

  const registerFrequency = (behaviorName = selectedBehavior.name, countDelta = 1) => {
    if (!ensureSessionCanRecord()) return;
    const behavior = behaviorPresets.find((item) => item.name === behaviorName) || selectedBehavior;
    const frequencyLockKey = `frequency:${behavior.id}:${behaviorName}`;
    if (!lockAction(frequencyLockKey, 300)) return;
    const payload = buildBehaviorPayload(behaviorName, 'frequency', { count_delta: countDelta, countDelta });
    triggerMicroFeedback(`behavior:${behavior.id}`, 'plus');
    showClinicalToast(buildClinicalActionToast({
      action: 'frequency',
      behaviorName,
      countDelta,
      location: selectedLocation,
      severity: selectedSeverity
    }));
    void saveBehaviorEvent(payload, {
      id: String(payload.id),
      kind: 'behavior',
      title: behaviorName,
      detail: `${countDelta > 0 ? '+' : ''}${countDelta} ocorrência`,
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
    if (!ensureSessionCanRecord()) return;
    if (openDurations.some((event) => event.behaviorName === behaviorName)) {
      showClinicalToast({
        variant: 'info',
        title: 'Duração já em andamento',
        subtitle: `${behaviorName} está sendo cronometrado.`
      }, 'none');
      return;
    }
    const behavior = behaviorPresets.find((item) => item.name === behaviorName) || selectedBehavior;
    if (!lockAction(`duration:start:${behavior.id}`, 300)) return;
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
    triggerMicroFeedback(`behavior:${behavior.id}`, 'pulse');
    showClinicalToast(buildClinicalActionToast({
      action: 'duration_start',
      behaviorName,
      location: selectedLocation,
      severity: selectedSeverity
    }));
    const payload = buildBehaviorPayload(behaviorName, 'duration', {
      id,
      started_at: startedAt,
      startedAt,
      ended_at: null,
      endedAt: null,
      duration_seconds: null,
      durationSeconds: null,
      status: 'IN_PROGRESS',
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
      detail: 'duração em andamento',
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
    const durationEndLockKey = `duration:end:${eventId}`;
    if (!lockAction(durationEndLockKey, 0)) return;
    const endedAt = new Date().toISOString();
    const durationSeconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(event.startedAt).getTime()) / 1000));
    setOpenDurations((prev) => prev.filter((item) => item.id !== eventId));
    showClinicalToast(buildClinicalActionToast({
      action: 'duration_end',
      behaviorName: event.behaviorName,
      durationSeconds
    }));
    const payload = buildBehaviorPayload(event.behaviorName, 'duration', {
      id: event.id,
      started_at: event.startedAt,
      startedAt: event.startedAt,
      ended_at: endedAt,
      endedAt,
      duration_seconds: durationSeconds,
      durationSeconds,
      status: 'COMPLETED',
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
      detail: `duração ${formatElapsed(event.startedAt, new Date(endedAt).getTime())}`,
      timestamp: event.startedAt,
      measurementType: 'duration',
      startedAt: event.startedAt,
      endedAt,
      durationSeconds,
      countDelta: 1,
      location: event.location || selectedLocation,
      severity: event.severity ?? selectedSeverity
    }).finally(() => releaseActionLock(durationEndLockKey));
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
    if (!ensureSessionCanRecord()) return;
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
    if (!ensureSessionCanRecord()) return;
    setRateWindow({
      id: crypto.randomUUID(),
      behaviorName: selectedBehavior.name,
      startedAt: new Date().toISOString(),
      count: 0
    });
  };

  const registerRateOccurrence = () => {
    if (!ensureSessionCanRecord()) return;
    if (!rateWindow) return;
    if (!lockAction(`rate:${rateWindow.id}`, 300)) return;
    setRateWindow({ ...rateWindow, count: Number(rateWindow.count || 0) + 1 });
    const payload = buildBehaviorPayload(rateWindow.behaviorName, 'rate', {
      count_delta: 1,
      countDelta: 1,
      raw_payload: { rateWindowId: rateWindow.id, rateWindowStartedAt: rateWindow.startedAt }
    });
    showClinicalToast(buildClinicalActionToast({
      action: 'frequency',
      behaviorName: rateWindow.behaviorName,
      countDelta: 1,
      location: selectedLocation,
      severity: selectedSeverity
    }));
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

  const persistIntervalLifecycleRecord = (run: any, status: AbaIntervalCollectionStatus, occurredAt = new Date().toISOString(), extra: any = {}) => {
    const behaviorId = run.behaviorId || selectedBehavior.id;
    const intervalNumber = Math.max(1, Number(run.intervalIndex || 1));
    const intervalStartedAt = run.intervalStartedAt || run.startedAt || occurredAt;
    const intervalDurationSeconds = Math.max(1, Number(run.intervalSeconds || intervalSeconds || 1));
    const lifecycleId = `${run.id}-lifecycle-${String(status).toLowerCase()}-${Date.parse(occurredAt) || Date.now()}`;
    void dataService.saveAbaIntervalRecord({
      id: lifecycleId,
      clinic_id: resolvedClinicId || undefined,
      clinicId: resolvedClinicId || undefined,
      patient_id: patientId,
      patientId,
      session_id: sessionId,
      sessionId,
      behavior_id: behaviorId,
      behaviorId,
      behavior_name: run.behaviorName,
      behaviorName: run.behaviorName,
      method: run.measurementType || run.method || 'partial_interval',
      measurement_type: run.measurementType || run.method || 'partial_interval',
      measurementType: run.measurementType || run.method || 'partial_interval',
      interval_number: intervalNumber,
      intervalNumber,
      interval_duration_seconds: intervalDurationSeconds,
      intervalDurationSeconds,
      interval_started_at: intervalStartedAt,
      intervalStartedAt,
      interval_ended_at: occurredAt,
      intervalEndedAt: occurredAt,
      occurred: false,
      collection_status: status,
      collectionStatus: status,
      location: run.location || selectedLocation,
      severity: run.severity ?? selectedSeverity,
      therapist_id: resolvedTherapistId || undefined,
      therapistId: resolvedTherapistId || undefined,
      sync_status: 'local',
      syncStatus: 'local',
      source: 'verto_web',
      raw_payload: {
        intervalRunId: run.id,
        intervalLifecycle: true,
        lifecycleStatus: status,
        lifecycleAction: String(status).toLowerCase(),
        patientId,
        sessionId,
        therapistId: resolvedTherapistId || null,
        clinicId: resolvedClinicId || undefined,
        behaviorId,
        source: 'verto_web',
        syncStatus: 'local',
        ...extra
      }
    }).then((result) => {
      if (result?.success || result?.pending || result?.offline) onSessionRecordSaved?.();
    }).catch((error) => {
      console.error('Falha ao persistir ciclo de vida do intervalo ABA:', error);
    });
  };

  const startIntervalRun = (behaviorOverride = selectedBehavior, measurementOverride = behaviorMeasurementType) => {
    if (!ensureSessionCanRecord()) return;
    if (intervalRun) {
      setSessionWarning(intervalRun.behaviorId === behaviorOverride.id
        ? 'Já existe uma coleta por intervalo em andamento para este comportamento.'
        : 'Finalize, pause/cancele ou conclua a coleta por intervalo em andamento antes de iniciar outra.');
      return;
    }
    const startedAt = new Date().toISOString();
    const intervalEndsAt = new Date(new Date(startedAt).getTime() + intervalSeconds * 1000).toISOString();
    const nextRun = {
      id: crypto.randomUUID(),
      behaviorId: behaviorOverride.id,
      behaviorName: behaviorOverride.name,
      measurementType: measurementOverride,
      method: measurementOverride,
      location: selectedLocation,
      severity: selectedSeverity,
      startedAt,
      intervalStartedAt: startedAt,
      intervalEndsAt,
      intervalSeconds,
      intervalIndex: 1,
      totalIntervals: Math.max(1, Math.floor(Number(intervalTotalIntervals) || 1)),
      plannedIntervals: Math.max(1, Math.floor(Number(intervalTotalIntervals) || 1)),
      alertType: intervalAlertType,
      status: 'RUNNING',
      collectionStatus: 'RUNNING',
      awaitingResponse: false,
      paused: false,
      pauseRemainingMs: null,
      completedCount: 0,
      answeredIntervals: 0,
      occurredCount: 0,
      yesCount: 0,
      noCount: 0
    };
    setIntervalRun(nextRun);
    persistIntervalLifecycleRecord(nextRun, 'RUNNING', startedAt, { lifecycleAction: 'start' });
    setIntervalOptionsOpen(false);
    setIntervalCancelConfirmOpen(false);
    setIntervalZeroFinishConfirmOpen(false);
    setIntervalEndReason('');
    setIntervalCancelReason('');
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
      total_intervals: safeCompletedTotal,
      totalIntervals: safeCompletedTotal,
      yes_count: safeOccurredTotal,
      yesCount: safeOccurredTotal,
      no_count: notOccurredTotal,
      noCount: notOccurredTotal,
      occurrence_percent: percent,
      occurrencePercent: percent,
      started_at: run.startedAt,
      startedAt: run.startedAt,
      ended_at: endedAt,
      endedAt,
      count_delta: safeOccurredTotal,
      countDelta: safeOccurredTotal,
      location: run.location || selectedLocation,
      severity: run.severity ?? selectedSeverity,
      notes: `Resumo da coleta por intervalo: ${safeOccurredTotal} SIM / ${notOccurredTotal} NÃO (${percent}%)`,
      response_by_therapist: `Resumo da coleta por intervalo: ${safeOccurredTotal} SIM / ${notOccurredTotal} NÃO (${percent}%)`,
      responseByTherapist: `Resumo da coleta por intervalo: ${safeOccurredTotal} SIM / ${notOccurredTotal} NÃO (${percent}%)`,
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
    void saveIntervalSummaryRecord(payload, {
      id: aggregateId,
      kind: 'behavior',
      title: run.behaviorName,
      detail: `resumo da coleta: ${safeOccurredTotal} SIM / ${notOccurredTotal} NÃO (${percent}%)`,
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

  const saveIntervalAggregateV2 = (run: any, completedTotal: number, occurredTotal: number, endedAt: string, statusOverride?: AbaIntervalCollectionStatus, endReason = '') => {
    const aggregate = buildIntervalAggregateSummary(run, {
      answeredIntervals: completedTotal,
      yesCount: occurredTotal,
      endedAt,
      status: statusOverride,
      endReason
    });
    const safeCompletedTotal = aggregate.answeredIntervals;
    const safeOccurredTotal = aggregate.yesCount;
    const notOccurredTotal = aggregate.noCount;
    const percent = aggregate.occurrencePercent;
    const collectionStatus = aggregate.collectionStatus;
    const aggregateId = `${run.id}-summary`;
    const behaviorId = run.behaviorId || selectedBehavior.id;
    const payload = buildBehaviorPayload(run.behaviorName, run.measurementType, {
      id: aggregateId,
      behavior_id: behaviorId,
      behaviorId,
      method: run.measurementType,
      total_intervals: safeCompletedTotal,
      totalIntervals: safeCompletedTotal,
      planned_intervals: aggregate.plannedIntervals,
      plannedIntervals: aggregate.plannedIntervals,
      answered_intervals: safeCompletedTotal,
      answeredIntervals: safeCompletedTotal,
      yes_count: safeOccurredTotal,
      yesCount: safeOccurredTotal,
      no_count: notOccurredTotal,
      noCount: notOccurredTotal,
      occurrence_percent: percent,
      occurrencePercent: percent,
      collection_status: collectionStatus,
      collectionStatus,
      started_at: run.startedAt,
      startedAt: run.startedAt,
      ended_at: endedAt,
      endedAt,
      paused_at: run.pausedAt || null,
      pausedAt: run.pausedAt || null,
      resumed_at: run.resumedAt || null,
      resumedAt: run.resumedAt || null,
      ended_early_at: aggregate.endedEarlyAt || null,
      endedEarlyAt: aggregate.endedEarlyAt || null,
      end_reason: endReason || undefined,
      endReason: endReason || undefined,
      count_delta: safeOccurredTotal,
      countDelta: safeOccurredTotal,
      location: run.location || selectedLocation,
      severity: run.severity ?? selectedSeverity,
      notes: `Resumo da coleta por intervalo: ${safeOccurredTotal} SIM / ${notOccurredTotal} NÃO (${percent}%)`,
      response_by_therapist: `Resumo da coleta por intervalo: ${safeOccurredTotal} SIM / ${notOccurredTotal} NÃO (${percent}%)`,
      responseByTherapist: `Resumo da coleta por intervalo: ${safeOccurredTotal} SIM / ${notOccurredTotal} NÃO (${percent}%)`,
      timestamp: endedAt,
      raw_payload: {
        intervalRunId: run.id,
        intervalAggregate: true,
        collectionStatus,
        patientId,
        sessionId,
        therapistId: resolvedTherapistId || null,
        behaviorId,
        method: run.measurementType,
        totalIntervals: safeCompletedTotal,
        plannedIntervals: aggregate.plannedIntervals,
        plannedTotalIntervals: aggregate.plannedIntervals,
        answeredIntervals: safeCompletedTotal,
        occurredCount: safeOccurredTotal,
        yesCount: safeOccurredTotal,
        notOccurredCount: notOccurredTotal,
        noCount: notOccurredTotal,
        occurrencePercent: percent,
        collectionStartedAt: run.startedAt,
        collectionEndedAt: endedAt,
        pausedAt: run.pausedAt || undefined,
        resumedAt: run.resumedAt || undefined,
        endedEarlyAt: aggregate.endedEarlyAt || undefined,
        endReason: endReason || undefined,
        location: run.location || selectedLocation,
        severity: run.severity ?? selectedSeverity,
        syncStatus: 'local'
      }
    });
    void saveIntervalSummaryRecord(payload, {
      id: aggregateId,
      kind: 'behavior',
      title: run.behaviorName,
      detail: collectionStatus === 'PARTIALLY_COMPLETED'
        ? `${getMeasurementLabel(run.measurementType)}: ${safeCompletedTotal}/${aggregate.plannedIntervals} respondidos`
        : `resumo da coleta: ${safeOccurredTotal} SIM / ${notOccurredTotal} NÃO (${percent}%)`,
      timestamp: endedAt,
      measurementType: run.measurementType,
      behaviorId,
      intervalAggregate: true,
      totalIntervals: safeCompletedTotal,
      plannedIntervals: aggregate.plannedIntervals,
      answeredIntervals: safeCompletedTotal,
      yesCount: safeOccurredTotal,
      noCount: notOccurredTotal,
      occurredCount: safeOccurredTotal,
      notOccurredCount: notOccurredTotal,
      occurrencePercent: percent,
      collectionStatus,
      status: collectionStatus,
      pausedAt: run.pausedAt || null,
      resumedAt: run.resumedAt || null,
      endedEarlyAt: aggregate.endedEarlyAt || null,
      endReason: endReason || undefined,
      notes: collectionStatus === 'PARTIALLY_COMPLETED'
        ? `${safeOccurredTotal} SIM • ${notOccurredTotal} NÃO • ${percent}% • finalizada antecipadamente`
        : `${safeOccurredTotal} SIM • ${notOccurredTotal} NÃO • ${percent}%`,
      location: run.location || selectedLocation,
      severity: run.severity ?? selectedSeverity
    });
    setIntervalSummary({
      behaviorName: run.behaviorName,
      measurementType: run.measurementType,
      totalIntervals: safeCompletedTotal,
      plannedTotalIntervals: aggregate.plannedIntervals,
      plannedIntervals: aggregate.plannedIntervals,
      answeredIntervals: safeCompletedTotal,
      occurredCount: safeOccurredTotal,
      notOccurredCount: notOccurredTotal,
      percent,
      endedAt,
      status: collectionStatus,
      reason: collectionStatus,
      endReason
    });
    return aggregate;
  };

  const pauseIntervalRun = () => {
    if (!intervalRun) return;
    const pausedAt = new Date(nowMs).toISOString();
    const pausedRun = pauseIntervalRunState(intervalRun, { nowMs, pausedAt });
    setIntervalRun(pausedRun);
    persistIntervalLifecycleRecord(pausedRun, 'PAUSED', pausedAt, {
      lifecycleAction: 'pause',
      pausedAt,
      pauseRemainingMs: pausedRun.pauseRemainingMs ?? null,
      pausedFromStatus: pausedRun.pausedFromStatus || getIntervalRunStatus(intervalRun)
    });
    setIntervalOptionsOpen(false);
    showClinicalToast({
      id: crypto.randomUUID(),
      title: '⏸ Coleta pausada',
      subtitle: `${intervalRun.behaviorName} • intervalo ${Number(intervalRun.intervalIndex || 1)}/${Number(intervalRun.totalIntervals || 1)}`,
      variant: 'warning'
    }, 'none');
  };

  const resumeIntervalRun = () => {
    if (!intervalRun) return;
    const resumedAt = new Date().toISOString();
    const resumedRun = resumeIntervalRunState(intervalRun, { resumedAt });
    setIntervalRun(resumedRun);
    persistIntervalLifecycleRecord(resumedRun, 'RUNNING', resumedAt, {
      lifecycleAction: 'resume',
      resumedAt,
      resumedFromStatus: 'PAUSED',
      nextIntervalEndsAt: resumedRun.intervalEndsAt
    });
    setIntervalOptionsOpen(false);
    showClinicalToast({
      id: crypto.randomUUID(),
      title: '▶ Coleta retomada',
      subtitle: `${intervalRun.behaviorName} • intervalo ${Number(intervalRun.intervalIndex || 1)}/${Number(intervalRun.totalIntervals || 1)}`,
      variant: 'info'
    }, 'none');
  };

  const requestCancelIntervalRun = () => {
    if (!intervalRun) return;
    setIntervalOptionsOpen(false);
    setIntervalZeroFinishConfirmOpen(false);
    setIntervalCancelConfirmOpen(true);
  };

  const confirmCancelIntervalRun = () => {
    if (!intervalRun) return;
    const audit = buildIntervalCancelAudit(intervalRun, {
      cancelledAt: new Date().toISOString(),
      cancelledBy: resolvedTherapistId || null,
      cancelReason: intervalCancelReason
    });
    const behaviorId = intervalRun.behaviorId || selectedBehavior.id;
    const cancelledRecordIds = new Set(records
      .filter((record) => {
        const rawPayload = record.rawPayload || {};
        return rawPayload.intervalRunId === intervalRun.id || record.id.startsWith(`${intervalRun.id}-interval-`);
      })
      .map((record) => record.id));
    setRecords((prev) => prev.map((record) => {
      const rawPayload = record.rawPayload || {};
      const belongsToRun = rawPayload.intervalRunId === intervalRun.id || record.id.startsWith(`${intervalRun.id}-interval-`);
      if (!belongsToRun) return record;
      return {
        ...record,
        intervalCancelled: true,
        collectionStatus: 'CANCELLED',
        status: 'CANCELLED',
        cancelledAt: audit.cancelledAt,
        cancelledBy: audit.cancelledBy,
        cancelReason: audit.cancelReason,
        syncStatus: record.syncStatus === 'synced' ? 'local' : record.syncStatus
      };
    }));
    const auditPayload = buildBehaviorPayload(intervalRun.behaviorName, intervalRun.measurementType, {
      id: `${intervalRun.id}-cancel-audit`,
      behavior_id: behaviorId,
      behaviorId,
      method: intervalRun.measurementType,
      total_intervals: audit.totalIntervals,
      totalIntervals: audit.totalIntervals,
      planned_intervals: audit.plannedIntervals,
      plannedIntervals: audit.plannedIntervals,
      answered_intervals: audit.answeredIntervals,
      answeredIntervals: audit.answeredIntervals,
      yes_count: audit.yesCount,
      yesCount: audit.yesCount,
      no_count: audit.noCount,
      noCount: audit.noCount,
      occurrence_percent: audit.occurrencePercent,
      occurrencePercent: audit.occurrencePercent,
      collection_status: 'CANCELLED',
      collectionStatus: 'CANCELLED',
      cancelled_at: audit.cancelledAt,
      cancelledAt: audit.cancelledAt,
      cancelled_by: audit.cancelledBy,
      cancelledBy: audit.cancelledBy,
      cancel_reason: audit.cancelReason || undefined,
      cancelReason: audit.cancelReason || undefined,
      started_at: intervalRun.startedAt,
      startedAt: intervalRun.startedAt,
      ended_at: audit.cancelledAt,
      endedAt: audit.cancelledAt,
      location: intervalRun.location || selectedLocation,
      severity: intervalRun.severity ?? selectedSeverity,
      notes: 'Coleta por intervalo cancelada. Não entrou no resumo clínico.',
      response_by_therapist: 'Coleta por intervalo cancelada. Não entrou no resumo clínico.',
      responseByTherapist: 'Coleta por intervalo cancelada. Não entrou no resumo clínico.',
      timestamp: audit.cancelledAt,
      raw_payload: {
        intervalRunId: intervalRun.id,
        intervalAggregate: true,
        intervalCancelled: true,
        clinicalAudit: true,
        collectionStatus: 'CANCELLED',
        cancelledRecordIds: Array.from(cancelledRecordIds),
        cancelReason: audit.cancelReason || undefined,
        cancelledAt: audit.cancelledAt,
        cancelledBy: audit.cancelledBy,
        patientId,
        sessionId,
        therapistId: resolvedTherapistId || null,
        behaviorId,
        method: intervalRun.measurementType,
        plannedIntervals: audit.plannedIntervals,
        answeredIntervals: audit.answeredIntervals,
        totalIntervals: audit.totalIntervals,
        yesCount: audit.yesCount,
        noCount: audit.noCount,
        occurredCount: audit.occurredCount,
        notOccurredCount: audit.notOccurredCount,
        occurrencePercent: audit.occurrencePercent,
        syncStatus: 'local'
      }
    });
    void saveIntervalSummaryRecord(auditPayload, {
      id: `${intervalRun.id}-cancel-audit`,
      kind: 'behavior',
      title: intervalRun.behaviorName,
      detail: `Coleta cancelada às ${formatSessionTime(audit.cancelledAt)}`,
      timestamp: audit.cancelledAt,
      measurementType: intervalRun.measurementType,
      behaviorId,
      intervalAggregate: true,
      intervalCancelled: true,
      clinicalAudit: true,
      totalIntervals: audit.totalIntervals,
      plannedIntervals: audit.plannedIntervals,
      answeredIntervals: audit.answeredIntervals,
      yesCount: audit.yesCount,
      noCount: audit.noCount,
      occurredCount: audit.occurredCount,
      notOccurredCount: audit.notOccurredCount,
      occurrencePercent: audit.occurrencePercent,
      collectionStatus: 'CANCELLED',
      status: 'CANCELLED',
      cancelledAt: audit.cancelledAt,
      cancelledBy: audit.cancelledBy,
      cancelReason: audit.cancelReason,
      notes: 'Não entrou no resumo clínico',
      location: intervalRun.location || selectedLocation,
      severity: intervalRun.severity ?? selectedSeverity
    });
    setIntervalRun(null);
    setIntervalSummary(null);
    setIntervalCancelConfirmOpen(false);
    setIntervalZeroFinishConfirmOpen(false);
    setIntervalCancelReason('');
    setSessionWarning('');
    showClinicalToast({
      id: crypto.randomUUID(),
      title: 'Coleta cancelada',
      subtitle: 'Não entrou no resumo clínico',
      variant: 'warning'
    }, 'none');
  };

  const finishIntervalRunNow = () => {
    if (!intervalRun) return;
    const completedTotal = Number(intervalRun.completedCount || 0);
    const occurredTotal = Number(intervalRun.occurredCount || 0);
    if (completedTotal <= 0) {
      setIntervalOptionsOpen(false);
      setIntervalCancelConfirmOpen(false);
      setIntervalZeroFinishConfirmOpen(true);
      return;
    }
    const endedAt = new Date().toISOString();
    const aggregate = saveIntervalAggregateV2(intervalRun, completedTotal, occurredTotal, endedAt, completedTotal >= Number(intervalRun.totalIntervals || 1) ? 'COMPLETED' : 'PARTIALLY_COMPLETED', intervalEndReason);
    setIntervalRun(null);
    setIntervalOptionsOpen(false);
    setIntervalCancelConfirmOpen(false);
    setIntervalZeroFinishConfirmOpen(false);
    setIntervalEndReason('');
    setSessionWarning('');
    showClinicalToast({
      id: crypto.randomUUID(),
      title: '✓ Coleta finalizada',
      subtitle: `${aggregate.answeredIntervals}/${aggregate.plannedIntervals} intervalos • ${aggregate.occurrencePercent}% ocorrência`,
      variant: 'success'
    });
  };

  const registerInterval = (occurred: boolean) => {
    if (!ensureSessionCanRecord()) return;
    if (!intervalRun) return;
    if (getIntervalRunStatus(intervalRun) !== 'AWAITING_RESPONSE') return;
    const intervalNumber = Number(intervalRun.intervalIndex || 1);
    const intervalLockKey = `interval:${intervalRun.id}:${intervalNumber}`;
    if (!lockAction(intervalLockKey, 0)) return;
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
      interval_duration_seconds: Number(intervalRun.intervalSeconds || intervalSeconds),
      intervalDurationSeconds: Number(intervalRun.intervalSeconds || intervalSeconds),
      interval_occurred: occurred,
      intervalOccurred: occurred,
      occurred,
      collection_status: 'COMPLETED',
      collectionStatus: 'COMPLETED',
      location: intervalRun.location || selectedLocation,
      severity: intervalRun.severity ?? selectedSeverity,
      timestamp: intervalEndedAt,
      raw_payload: {
        intervalRunId: intervalRun.id,
        intervalAggregate: false,
        collectionStatus: 'COMPLETED',
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
    showClinicalToast(buildClinicalActionToast({
      action: 'interval',
      behaviorName: intervalRun.behaviorName,
      intervalNumber,
      occurred
    }));
    void saveIntervalRecord(payload, {
      id: recordId,
      kind: 'behavior',
      title: intervalRun.behaviorName,
      detail: `intervalo ${intervalNumber}: ${occurred ? 'SIM' : 'NÃO'}`,
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
      collectionStatus: 'COMPLETED',
      status: 'COMPLETED',
      rawPayload: {
        intervalRunId: intervalRun.id,
        intervalAggregate: false,
        collectionStatus: 'COMPLETED'
      },
      location: intervalRun.location || selectedLocation,
      severity: intervalRun.severity ?? selectedSeverity
    });
    if (intervalNumber >= totalIntervals) {
      saveIntervalAggregateV2(intervalRun, nextCompletedCount, nextOccurredCount, intervalEndedAt, 'COMPLETED');
      setIntervalRun(null);
      setIntervalOptionsOpen(false);
      setIntervalCancelConfirmOpen(false);
      setIntervalZeroFinishConfirmOpen(false);
      return;
    }
    const nextStartedAt = new Date().toISOString();
    const nextEndsAt = new Date(new Date(nextStartedAt).getTime() + Number(intervalRun.intervalSeconds || intervalSeconds) * 1000).toISOString();
    setIntervalRun({
      ...intervalRun,
      intervalIndex: intervalNumber + 1,
      intervalStartedAt: nextStartedAt,
      intervalEndsAt: nextEndsAt,
      status: 'RUNNING',
      collectionStatus: 'RUNNING',
      awaitingResponse: false,
      alertFiredAt: null,
      paused: false,
      pauseRemainingMs: null,
      completedCount: nextCompletedCount,
      answeredIntervals: nextCompletedCount,
      occurredCount: nextOccurredCount,
      yesCount: nextOccurredCount,
      noCount: Math.max(0, nextCompletedCount - nextOccurredCount)
    });
    setIntervalOptionsOpen(false);
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

  const resolveShortcutBehavior = (shortcut: any) => (
    behaviorPresets.find((behavior) => behavior.id === shortcut?.behaviorId) || selectedBehavior
  );

  const findOpenDurationForBehavior = (behaviorName: string) => (
    openDurations.find((event) => event.behaviorName === behaviorName)
  );

  const executeBehaviorShortcut = (shortcut: any) => {
    const behavior = resolveShortcutBehavior(shortcut);
    const method = String(shortcut?.method || behavior.defaultMeasurement || 'frequency');
    if (shortcut?.behaviorId === 'abc' || method === 'abc') {
      openAbcModal(behavior.id);
      return;
    }
    if (method === 'frequency' || method === 'rate') {
      registerFrequency(behavior.name, 1);
      return;
    }
    if (method === 'duration') {
      const openEvent = findOpenDurationForBehavior(behavior.name);
      if (openEvent) endDuration(openEvent.id);
      else startDuration(behavior.name);
      return;
    }
    if (isIntervalMeasurement(method)) {
      startIntervalRun(behavior, method);
    }
  };

  const saveAbcEvent = () => {
    if (!ensureSessionCanRecord()) return;
    if (!lockAction('abc:save', 600)) return;
    const behavior = behaviorPresets.find((item) => item.id === abcBehaviorId) || selectedBehavior;
    const payload = buildBehaviorPayload(behavior.name, 'abc', {
      behavior_id: behavior.id,
      behaviorId: behavior.id,
      antecedent: abcAntecedent,
      consequence: abcConsequence,
      location: abcLocation,
      severity: abcSeverity,
      notes: abcNote,
      response: abcNote,
      response_by_therapist: abcNote,
      responseByTherapist: abcNote
    });
    void saveAbcClinicalEvent(payload, {
      id: String(payload.id),
      kind: 'behavior',
      title: behavior.name,
      detail: `ABC - severidade ${abcSeverity}`,
      timestamp: payload.timestamp,
      measurementType: 'abc',
      behaviorId: behavior.id,
      location: abcLocation,
      severity: abcSeverity,
      antecedent: abcAntecedent,
      consequence: abcConsequence,
      notes: abcNote
    });
    showClinicalToast(buildClinicalActionToast({ action: 'abc' }));
    setAbcModalOpen(false);
    setAbcNote('');
  };

  const requestEndSession = () => {
    setSessionWarning('');
    setSessionEndPreviewAt(new Date().toISOString());
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

  const getRecordAbcRequirement = (record: SessionRecord): AbcRequirement => {
    const behavior = behaviorPresets.find((item) => item.id === record.behaviorId || item.name === record.title);
    const configuredRequirements =
      patient?.abaBehaviorSettings ||
      patient?.clinicSettings?.abaBehaviorSettings ||
      patient?.clinicSettings?.behaviorAbcRequirements ||
      patient?.clinicSettings?.behaviorSettings ||
      {};
    const configured =
      configuredRequirements?.[String(record.behaviorId || '')]?.abcRequirement ||
      configuredRequirements?.[String(behavior?.id || '')]?.abcRequirement ||
      configuredRequirements?.[String(record.title || '')]?.abcRequirement ||
      configuredRequirements?.[String(behavior?.name || '')]?.abcRequirement;
    return normalizeAbcRequirement(configured || behavior?.abcRequirement || 'OPTIONAL');
  };

  const buildSessionClosureIssues = (): { blockers: SessionSummaryPendingItem[]; warnings: SessionSummaryPendingItem[] } => {
    const behaviorRecords = records.filter((record) => record.kind === 'behavior' && !record.intervalAggregate && !isCancelledIntervalClinicalRecord(record));
    const savingLocally = records.filter((record) => record.syncStatus === 'syncing');
    const notSyncedWithServer = records.filter((record) => record.syncStatus === 'local' || record.syncStatus === 'error');
    const abcMissingCounts: Record<AbcRequirement, number> = {
      REQUIRED: 0,
      RECOMMENDED: 0,
      OPTIONAL: 0,
      DISABLED: 0
    };
    behaviorRecords.filter((record) => (
      inferRecordMeasurementType(record) !== 'abc' &&
      !record.antecedent &&
      !record.consequence
    )).forEach((record) => {
      abcMissingCounts[getRecordAbcRequirement(record)] += 1;
    });

    const closure = canCloseAbaSession({
      openDurations,
      intervalRun,
      unsavedLocalCount: savingLocally.length,
      incompleteTrial: Boolean(promptSelectionGoal)
    });
    const warnings: SessionSummaryPendingItem[] = [];
    if (abcMissingCounts.RECOMMENDED > 0) warnings.push({ key: 'recommended_abc_missing', label: `ABC recomendado pendente em ${abcMissingCounts.RECOMMENDED} evento(s)`, category: 'warning', count: abcMissingCounts.RECOMMENDED });
    if (abcMissingCounts.OPTIONAL > 0) warnings.push({ key: 'optional_abc_missing', label: `ABC opcional ausente em ${abcMissingCounts.OPTIONAL} evento(s)`, category: 'warning', count: abcMissingCounts.OPTIONAL });
    warnings.push({ key: 'guardian_signature_pending', label: 'Assinatura do responsável pendente', category: 'warning', count: 1 });
    if (!sessionNote.trim()) warnings.push({ key: 'session_note_pending', label: 'Observação da sessão pendente', category: 'warning', count: 1 });
    if (notSyncedWithServer.length > 0) warnings.push({ key: 'server_sync_pending', label: `${notSyncedWithServer.length} dado(s) ainda não sincronizado(s)`, category: 'warning', count: notSyncedWithServer.length });
    return { blockers: closure.blockers, warnings };
  };

  const confirmEndSession = async () => {
    const closureIssues = buildSessionClosureIssues();
    if (closureIssues.blockers.length > 0) {
      setSessionWarning('Resolva os bloqueios antes de encerrar a sessão.');
      return;
    }
    const endedAt = new Date().toISOString();
    const finalSummary = calculateSessionSummary(sessionId, {
      id: `summary-${sessionId}`,
      sessionId,
      patientId,
      patientName: patient?.name || 'Paciente',
      therapistId: resolvedTherapistId || null,
      startedAt: activeSession?.startedAt || endedAt,
      endedAt,
      trials: records.filter((record) => record.kind === 'trial'),
      behaviorEvents: records.filter((record) => record.kind === 'behavior' && !isCancelledIntervalClinicalRecord(record)),
      masterySummary: teachingMasteryRows,
      blockingItems: closureIssues.blockers,
      warningItems: closureIssues.warnings,
      sessionNote,
      syncStatus: records.some((record) => record.syncStatus === 'error') ? 'error' : records.some((record) => record.syncStatus !== 'synced') ? 'local' : 'synced'
    });
    const finalMaintenanceSummary = maintenanceProbeRows;
    setSessionEndPreviewAt(endedAt);
    setSessionCompleted(true);
    setShowPostClosureReport(false);
    setShowComplementEditor(false);
    try {
      const summarySaveResult = await dataService.saveAbaSessionSummary({
        ...finalSummary,
        session_id: finalSummary.sessionId,
        patient_id: finalSummary.patientId,
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        therapist_id: finalSummary.therapistId || undefined,
        source: 'verto_web',
        started_at: finalSummary.startedAt,
        ended_at: finalSummary.endedAt,
        duration_seconds: finalSummary.durationSeconds,
        total_trials: finalSummary.totalTrials,
        independent_trials: finalSummary.independentTrials,
        prompted_trials: finalSummary.promptedTrials,
        error_trials: finalSummary.errorTrials,
        accuracy_percent: finalSummary.accuracyPercent,
        independence_percent: finalSummary.independencePercent,
        trial_types_used: finalSummary.trialTypesUsed,
        total_behavior_events: finalSummary.totalBehaviorEvents,
        frequency_summary: finalSummary.frequencySummary,
        duration_summary: finalSummary.durationSummary,
        interval_summary: finalSummary.intervalSummary,
        abc_summary: finalSummary.abcSummary,
        mastery_summary: finalSummary.masterySummary,
        maintenance_summary: finalMaintenanceSummary,
        blocking_items: finalSummary.blockingItems,
        warning_items: finalSummary.warningItems,
        pending_items: finalSummary.pendingItems,
        pending_warnings: finalSummary.pendingWarnings,
        session_note: finalSummary.sessionNote,
        summary_payload: {
          source: 'verto_web',
          clinicId: resolvedClinicId || undefined,
          patientName: finalSummary.patientName,
          teachingSummary: finalSummary.teachingSummary,
          trialTypesUsed: finalSummary.trialTypesUsed,
          abcSummary: finalSummary.abcSummary,
          masterySummary: finalSummary.masterySummary,
          maintenanceSummary: finalMaintenanceSummary,
          blockingItems: finalSummary.blockingItems,
          warningItems: finalSummary.warningItems,
          pendingWarnings: finalSummary.pendingWarnings,
          sessionNote
        }
      });
      setPostClosureSummary({
        ...finalSummary,
        maintenanceSummary: finalMaintenanceSummary,
        id: String(summarySaveResult?.data?.id || finalSummary.id),
        syncStatus: summarySaveResult?.success && !summarySaveResult?.pending && !summarySaveResult?.offline ? 'synced' : finalSummary.syncStatus,
        createdAt: summarySaveResult?.data?.created_at || summarySaveResult?.data?.createdAt || finalSummary.createdAt
      });
      await dataService.updateAbaSession(sessionId, {
        status: 'COMPLETED',
        ended_at: endedAt,
        duration_seconds: finalSummary.durationSeconds,
        duration_minutes: Math.ceil(finalSummary.durationSeconds / 60),
        record_count: finalSummary.totalTrials + finalSummary.totalBehaviorEvents,
        notes: sessionNote
      });
      showClinicalToast(buildClinicalActionToast({ action: 'session_end' }));
    } catch (error) {
      console.error('Falha ao persistir encerramento da sessão ABA:', error);
      setPostClosureSummary({ ...finalSummary, syncStatus: 'error' });
      setSessionWarning('A sessão foi marcada como encerrada localmente, mas houve falha de sincronização.');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
    }
    setShowSessionSummary(false);
  };

  const sessionSummary = useMemo(() => {
    const trialTotal = records.filter((record) => record.kind === 'trial').length;
    const behaviorTotal = records.filter((record) => record.kind === 'behavior' && !isCancelledIntervalClinicalRecord(record)).length;
    const errorTotal = records.filter((record) => record.syncStatus === 'error').length;
    const localTotal = records.filter((record) => record.syncStatus === 'local' || record.syncStatus === 'syncing').length;
    return { trialTotal, behaviorTotal, errorTotal, localTotal };
  }, [records]);

  const sessionClosureIssues = useMemo(() => buildSessionClosureIssues(), [records, openDurations, intervalRun, promptSelectionGoal, sessionNote, patient?.abaBehaviorSettings, patient?.abaSettings, patient?.clinicSettings]);

  const sessionClosureSummary: SessionSummary = useMemo(() => {
    const endedAt = sessionEndPreviewAt || new Date().toISOString();
    const syncStatus = records.some((record) => record.syncStatus === 'error')
      ? 'error'
      : records.some((record) => record.syncStatus !== 'synced')
        ? 'local'
        : 'synced';
    return calculateSessionSummary(sessionId, {
      id: `summary-${sessionId}`,
      sessionId,
      patientId,
      patientName: patient?.name || 'Paciente',
      therapistId: resolvedTherapistId || null,
      startedAt: activeSession?.startedAt || endedAt,
      endedAt,
      trials: records.filter((record) => record.kind === 'trial'),
      behaviorEvents: records.filter((record) => record.kind === 'behavior' && !isCancelledIntervalClinicalRecord(record)),
      blockingItems: sessionClosureIssues.blockers,
      warningItems: sessionClosureIssues.warnings,
      sessionNote,
      syncStatus
    });
  }, [activeSession?.startedAt, patient?.name, patientId, records, resolvedTherapistId, sessionClosureIssues, sessionEndPreviewAt, sessionId, sessionNote]);

  const maintenanceSchedules = Array.isArray(maintenanceOverview?.schedules) ? maintenanceOverview.schedules : [];
  const maintenanceProbeResults = Array.isArray(maintenanceOverview?.probeResults) ? maintenanceOverview.probeResults : [];
  const regressionAlerts = Array.isArray(maintenanceOverview?.alerts) ? maintenanceOverview.alerts : [];

  const targetMatchesGoal = (row: any, goalId: string, goalName: string) => {
    const rowTargetId = String(row?.target_id || row?.targetId || '').trim();
    const rowTargetName = String(row?.target_name || row?.targetName || row?.raw_payload?.targetName || row?.rawPayload?.targetName || '').trim();
    if (goalId && rowTargetId && rowTargetId === goalId) return true;
    return Boolean(goalName && rowTargetName && rowTargetName === goalName);
  };

  const formatMaintenanceDueLabel = (scheduledFor: any) => {
    const scheduledAt = new Date(scheduledFor || 0);
    if (Number.isNaN(scheduledAt.getTime())) return 'Sem maintenance probe agendado';
    const diffDays = Math.ceil((scheduledAt.getTime() - Date.now()) / 86_400_000);
    if (diffDays > 1) return `Proxima manutencao em ${diffDays} dias`;
    if (diffDays === 1) return 'Proxima manutencao em 1 dia';
    if (diffDays === 0) return 'Proxima manutencao hoje';
    return `Manutencao pendente ha ${Math.abs(diffDays)} dia(s)`;
  };

  const maintenanceStatusLabel = (status: any) => {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'MAINTAINED') return 'Mantido';
    if (normalized === 'REGRESSION_RISK') return 'Risco de regressao';
    if (normalized === 'WATCH') return 'Observar';
    return 'Sem probe recente';
  };

  const getGoalMaintenanceInfo = (goal: any) => {
    const goalId = String(goal?.id || goal?.target_id || goal?.targetId || '').trim();
    const goalName = String(goal?.name || goal?.target_name || goal?.targetName || 'Meta').trim();
    const schedules = maintenanceSchedules
      .filter((schedule: any) => targetMatchesGoal(schedule, goalId, goalName))
      .sort((a: any, b: any) => new Date(a?.scheduled_for || a?.scheduledFor || 0).getTime() - new Date(b?.scheduled_for || b?.scheduledFor || 0).getTime());
    const probeResults = maintenanceProbeResults
      .filter((result: any) => targetMatchesGoal(result, goalId, goalName))
      .sort((a: any, b: any) => new Date(b?.occurred_at || b?.occurredAt || 0).getTime() - new Date(a?.occurred_at || a?.occurredAt || 0).getTime());
    const alerts = regressionAlerts
      .filter((alert: any) => targetMatchesGoal(alert, goalId, goalName))
      .sort((a: any, b: any) => new Date(b?.created_at || b?.createdAt || 0).getTime() - new Date(a?.created_at || a?.createdAt || 0).getTime());
    let consecutiveFailures = 0;
    for (const result of probeResults) {
      const status = String(result?.status || '').toUpperCase();
      if (status !== 'WATCH' && status !== 'REGRESSION_RISK') break;
      consecutiveFailures += 1;
    }
    return {
      isMaintenanceTarget: isMaintenanceLikeGoal(goal) || schedules.length > 0 || probeResults.length > 0 || alerts.length > 0,
      nextSchedule: schedules.find((schedule: any) => String(schedule?.status || '').toUpperCase() === 'PENDING') || schedules[0] || null,
      lastResult: probeResults[0] || null,
      activeAlert: alerts[0] || null,
      probeResults,
      consecutiveFailures
    };
  };

  const teachingMasteryRows = useMemo(() => sessionGoals.map((goal: any) => {
    const goalId = String(goal?.id || goal?.target_id || goal?.targetId || '').trim();
    const goalName = String(goal?.name || goal?.target_name || goal?.targetName || 'Meta').trim();
    const goalTrials = records.filter((record) => {
      if (record.kind !== 'trial') return false;
      if (String(record.collectionType || '').toLowerCase() === 'maintenance_probe') return false;
      const recordTargetId = String(record.targetId || '').trim();
      if (goalId && recordTargetId && recordTargetId === goalId) return true;
      return String(record.title || record.targetName || '').trim() === goalName;
    });
    const criterion = buildSessionGoalMasteryCriterion(goal);
    const evaluation = evaluateTargetMastery({
      organizationId: resolvedClinicId || 'local',
      patientId,
      targetId: goalId || goalName,
      targetName: goalName,
      sessionId,
      criteria: criterion,
      trials: goalTrials.map((record) => ({
        ...record,
        target_id: record.targetId || goalId || null,
        target_name: record.targetName || record.title,
        program_id: record.programId || goal?.programId || goal?.program_id || goal?.protocolId || null,
        response_score: record.score,
        correct: Boolean(record.correct),
        independent: Boolean(record.independent),
        collection_type: record.collectionType,
        prompt_level_key: record.promptLevelKey,
        trial_outcome: record.trialOutcome,
        therapist_id: record.therapistId || resolvedTherapistId || null,
        occurred_at: record.timestamp
      })),
      previousEvaluations: [],
      evaluatedAt: sessionEndPreviewAt || new Date().toISOString()
    });
    return {
      id: goal.id || goalId || goalName,
      targetId: goalId || null,
      name: goalName,
      criterion: evaluation.criterionLabel || formatAbaMasteryCriterion(criterion as any),
      performanceText: evaluation.performanceText,
      contributes: evaluation.status === 'MET_TODAY' || evaluation.status === 'READY_FOR_REVIEW',
      status: masteryStatusLabel(evaluation.status),
      statusCode: evaluation.status,
      totalTrials: evaluation.totalTrials,
      independentTrials: evaluation.independentTrials,
      promptedTrials: evaluation.promptedTrials,
      errorTrials: evaluation.errorTrials,
      accuracyPercent: evaluation.accuracyPercent,
      independencePercent: evaluation.independencePercent,
      consecutiveSuccessfulDays: evaluation.consecutiveSuccessfulDays,
      reasons: evaluation.reasons
    };
  }), [patientId, records, resolvedClinicId, resolvedTherapistId, sessionEndPreviewAt, sessionGoals, sessionId]);

  const maintenanceProbeRows = useMemo(() => sessionGoals
    .map((goal: any) => {
      const goalId = String(goal?.id || goal?.target_id || goal?.targetId || '').trim();
      const goalName = String(goal?.name || goal?.target_name || goal?.targetName || 'Meta').trim();
      const goalTrials = records.filter((record) => {
        if (record.kind !== 'trial') return false;
        if (String(record.collectionType || '').toLowerCase() !== 'maintenance_probe') return false;
        const recordTargetId = String(record.targetId || '').trim();
        if (goalId && recordTargetId && recordTargetId === goalId) return true;
        return String(record.title || record.targetName || '').trim() === goalName;
      });
      const info = getGoalMaintenanceInfo(goal);
      if (goalTrials.length === 0 && !info.isMaintenanceTarget) return null;
      const criterion = buildSessionGoalMasteryCriterion(goal);
      const evaluation = evaluateMaintenanceStatus({
        organizationId: resolvedClinicId || 'local',
        patientId,
        targetId: goalId || goalName,
        targetName: goalName,
        sessionId,
        maintenanceScheduleId: info.nextSchedule?.id || null,
        criteria: criterion,
        trials: goalTrials.map((record) => ({
          ...record,
          target_id: record.targetId || goalId || null,
          target_name: record.targetName || record.title,
          response_score: record.score,
          correct: Boolean(record.correct),
          independent: Boolean(record.independent),
          collection_type: record.collectionType,
          prompt_level_key: record.promptLevelKey,
          trial_outcome: record.trialOutcome,
          therapist_id: record.therapistId || resolvedTherapistId || null,
          occurred_at: record.timestamp
        })),
        previousProbeResults: info.probeResults,
        occurredAt: sessionEndPreviewAt || new Date().toISOString()
      });
      return {
        id: `maintenance-${goalId || goalName}`,
        targetId: goalId || null,
        name: goalName,
        nextSchedule: info.nextSchedule,
        activeAlert: info.activeAlert,
        lastResult: info.lastResult,
        currentStatus: evaluation.status,
        status: maintenanceStatusLabel(goalTrials.length > 0 ? evaluation.status : info.lastResult?.status),
        totalTrials: evaluation.totalTrials,
        accuracyPercent: evaluation.accuracyPercent,
        independencePercent: evaluation.independencePercent,
        consecutiveFailureCount: Math.max(evaluation.consecutiveFailureCount, info.consecutiveFailures),
        performanceText: evaluation.performanceText,
        reasons: evaluation.reasons
      };
    })
    .filter((row): row is any => Boolean(row)), [patientId, records, resolvedClinicId, resolvedTherapistId, sessionEndPreviewAt, sessionGoals, sessionId, maintenanceOverview]);

  const intervalSummaryTotals = useMemo(() => {
    const total = Math.max(0, Number(intervalSummary?.totalIntervals || 0));
    const occurred = Math.min(total, Math.max(0, Number(intervalSummary?.occurredCount || 0)));
    const notOccurred = Math.max(0, total - occurred);
    const percent = total > 0 ? Math.round((occurred / total) * 100) : 0;
    return { total, occurred, notOccurred, percent };
  }, [intervalSummary]);
  function isCancelledIntervalClinicalRecord(record: SessionRecord) {
    const rawPayload = record.rawPayload || (record as any).raw_payload || {};
    return Boolean(
      record.intervalCancelled ||
      record.cancelledAt ||
      record.collectionStatus === 'CANCELLED' ||
      record.status === 'CANCELLED' ||
      rawPayload.intervalCancelled ||
      rawPayload.collectionStatus === 'CANCELLED' ||
      rawPayload.cancelledAt
    );
  }
  const clinicalHistoryRecords = records.filter((record) => !isCancelledIntervalClinicalRecord(record));
  const visibleHistoryRecords = historyExpanded ? clinicalHistoryRecords : clinicalHistoryRecords.slice(0, 20);
  const liveSummaryTotals = useMemo(() => {
    const totalTrials = Number(sessionLiveSummary?.total_trials ?? sessionLiveSummary?.totalTrials ?? 0) || 0;
    const totalBehaviors = Number(sessionLiveSummary?.total_behavior_events ?? sessionLiveSummary?.totalBehaviorEvents ?? 0) || 0;
    return {
      trialTotal: Math.max(trialCount, totalTrials),
      recordTotal: Math.max(clinicalHistoryRecords.length, totalTrials + totalBehaviors)
    };
  }, [clinicalHistoryRecords.length, sessionLiveSummary, trialCount]);

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

  function inferRecordMeasurementType(record: SessionRecord) {
    if (record.measurementType) return record.measurementType;
    const detail = String(record.detail || '').toLowerCase();
    if (detail.includes('duracao') || detail.includes('duração')) return 'duration';
    if (detail.includes('abc')) return 'abc';
    if (detail.includes('intervalo')) return 'partial_interval';
    if (detail.includes('taxa')) return 'rate';
    if (detail.includes('amostragem')) return 'momentary_time_sampling';
    return 'frequency';
  }

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
      total_intervals: record.totalIntervals ?? undefined,
      totalIntervals: record.totalIntervals ?? undefined,
      planned_intervals: record.plannedIntervals ?? undefined,
      plannedIntervals: record.plannedIntervals ?? undefined,
      answered_intervals: record.answeredIntervals ?? undefined,
      answeredIntervals: record.answeredIntervals ?? undefined,
      yes_count: record.yesCount ?? record.occurredCount ?? undefined,
      yesCount: record.yesCount ?? record.occurredCount ?? undefined,
      no_count: record.noCount ?? record.notOccurredCount ?? undefined,
      noCount: record.noCount ?? record.notOccurredCount ?? undefined,
      occurrence_percent: record.occurrencePercent ?? undefined,
      occurrencePercent: record.occurrencePercent ?? undefined,
      collection_status: record.collectionStatus ?? record.status ?? undefined,
      collectionStatus: record.collectionStatus ?? record.status ?? undefined,
      paused_at: record.pausedAt ?? undefined,
      pausedAt: record.pausedAt ?? undefined,
      resumed_at: record.resumedAt ?? undefined,
      resumedAt: record.resumedAt ?? undefined,
      ended_early_at: record.endedEarlyAt ?? undefined,
      endedEarlyAt: record.endedEarlyAt ?? undefined,
      cancelled_at: record.cancelledAt ?? undefined,
      cancelledAt: record.cancelledAt ?? undefined,
      cancelled_by: record.cancelledBy ?? undefined,
      cancelledBy: record.cancelledBy ?? undefined,
      cancel_reason: record.cancelReason ?? undefined,
      cancelReason: record.cancelReason ?? undefined,
      end_reason: record.endReason ?? undefined,
      endReason: record.endReason ?? undefined,
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
        plannedIntervals: record.plannedIntervals ?? undefined,
        answeredIntervals: record.answeredIntervals ?? undefined,
        yesCount: record.yesCount ?? undefined,
        noCount: record.noCount ?? undefined,
        collectionStatus: record.collectionStatus ?? record.status ?? undefined,
        pausedAt: record.pausedAt ?? undefined,
        resumedAt: record.resumedAt ?? undefined,
        endedEarlyAt: record.endedEarlyAt ?? undefined,
        cancelledAt: record.cancelledAt ?? undefined,
        cancelledBy: record.cancelledBy ?? undefined,
        cancelReason: record.cancelReason ?? undefined,
        endReason: record.endReason ?? undefined,
        intervalCancelled: record.intervalCancelled || undefined,
        clinicalAudit: record.clinicalAudit || undefined,
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
      const editedPayload = buildPayloadFromSessionRecord(editedRecord);
      if (sessionCompleted && (editedRecord.antecedent || editedRecord.consequence)) {
        void saveAbcClinicalEvent({
          ...editedPayload,
          behavior_event_id: editedRecord.id,
          behaviorEventId: editedRecord.id,
          behavior_id: editedRecord.behaviorId || editedRecord.id,
          behaviorId: editedRecord.behaviorId || editedRecord.id,
          response: editedRecord.notes,
          clinical_complement: true,
          clinicalComplement: true,
          complement_type: 'abc',
          complementType: 'abc'
        }, editedRecord, 'upsert');
      } else {
        void saveExistingBehaviorEvent(editedPayload, editedRecord);
      }
    } else {
      updateRecord(editingRecordId, editedRecord);
    }
    showClinicalToast(buildClinicalActionToast({ action: 'edit' }));
    cancelEditingRecord();
  };

  const saveSessionNoteComplement = async () => {
    if (!postClosureSummary) return;
    const updatedSummary = { ...postClosureSummary, sessionNote };
    setPostClosureSummary(updatedSummary);
    try {
      await dataService.saveAbaSessionSummary({
        ...updatedSummary,
        session_id: updatedSummary.sessionId,
        patient_id: updatedSummary.patientId,
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        therapist_id: updatedSummary.therapistId || undefined,
        source: 'verto_web',
        started_at: updatedSummary.startedAt,
        ended_at: updatedSummary.endedAt,
        duration_seconds: updatedSummary.durationSeconds,
        total_trials: updatedSummary.totalTrials,
        independent_trials: updatedSummary.independentTrials,
        prompted_trials: updatedSummary.promptedTrials,
        error_trials: updatedSummary.errorTrials,
        accuracy_percent: updatedSummary.accuracyPercent,
        independence_percent: updatedSummary.independencePercent,
        trial_types_used: updatedSummary.trialTypesUsed,
        total_behavior_events: updatedSummary.totalBehaviorEvents,
        frequency_summary: updatedSummary.frequencySummary,
        duration_summary: updatedSummary.durationSummary,
        interval_summary: updatedSummary.intervalSummary,
        abc_summary: updatedSummary.abcSummary,
        mastery_summary: updatedSummary.masterySummary,
        maintenance_summary: (updatedSummary as any).maintenanceSummary || [],
        blocking_items: updatedSummary.blockingItems,
        warning_items: updatedSummary.warningItems,
        pending_items: updatedSummary.pendingItems,
        pending_warnings: updatedSummary.pendingWarnings,
        session_note: sessionNote,
        summary_payload: {
          source: 'verto_web',
          clinicId: resolvedClinicId || undefined,
          patientName: updatedSummary.patientName,
          teachingSummary: updatedSummary.teachingSummary,
          trialTypesUsed: updatedSummary.trialTypesUsed,
          abcSummary: updatedSummary.abcSummary,
          masterySummary: updatedSummary.masterySummary,
          maintenanceSummary: (updatedSummary as any).maintenanceSummary || [],
          blockingItems: updatedSummary.blockingItems,
          warningItems: updatedSummary.warningItems,
          pendingWarnings: updatedSummary.pendingWarnings,
          sessionNote
        }
      });
      await dataService.updateAbaSession(sessionId, { notes: sessionNote });
      showClinicalToast(buildClinicalActionToast({ action: 'edit' }));
    } catch (error) {
      console.error('Falha ao persistir complemento da sessão:', error);
      setSessionWarning('Complemento salvo na tela, mas ainda não sincronizado com o servidor.');
      showClinicalToast(buildClinicalOfflineToast(), 'none');
    }
  };

  const pendingAbcRecords = useMemo(() => records.filter((record) => (
    record.kind === 'behavior' &&
    !record.intervalAggregate &&
    !isCancelledIntervalClinicalRecord(record) &&
    inferRecordMeasurementType(record) !== 'abc' &&
    !record.antecedent &&
    !record.consequence
  )), [records]);

  const postClosureReport = useMemo(() => {
    if (!postClosureSummary) return null;
    return buildSessionReport({
      ...postClosureSummary,
      therapistName: resolvedTherapistId || null,
      sessionNote: sessionNote || postClosureSummary.sessionNote || '',
      sourceRecords: records
    });
  }, [postClosureSummary, records, resolvedTherapistId, sessionNote]);

  const parsePersistedSummaryPayload = (value: any) => {
    if (!value) return {};
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) || {};
      } catch {
        return {};
      }
    }
    return typeof value === 'object' ? value : {};
  };

  const normalizePersistedSessionSummary = (row: any): SessionSummary | null => {
    if (!row) return null;
    const payload = parsePersistedSummaryPayload(row.summary_payload || row.summaryPayload);
    const fallback = postClosureSummary || sessionClosureSummary;
    const trialTypesUsed = Array.isArray(row.trial_types_used)
      ? row.trial_types_used
      : Array.isArray(payload.trialTypesUsed)
        ? payload.trialTypesUsed
        : fallback.trialTypesUsed || [];
    const totalTrials = Number(row.total_trials ?? row.totalTrials ?? fallback.totalTrials ?? 0) || 0;
    const independentTrials = Number(row.independent_trials ?? row.independentTrials ?? fallback.independentTrials ?? 0) || 0;
    const promptedTrials = Number(row.prompted_trials ?? row.promptedTrials ?? fallback.promptedTrials ?? 0) || 0;
    const errorTrials = Number(row.error_trials ?? row.errorTrials ?? fallback.errorTrials ?? 0) || 0;
    const accuracyPercent = Number(row.accuracy_percent ?? row.accuracyPercent ?? fallback.accuracyPercent ?? 0) || 0;
    const independencePercent = Number(row.independence_percent ?? row.independencePercent ?? fallback.independencePercent ?? 0) || 0;
    const syncStatusValue = String(row.sync_status || row.syncStatus || fallback.syncStatus || 'synced');
    const syncStatus = ['local', 'syncing', 'synced', 'error'].includes(syncStatusValue)
      ? syncStatusValue as SessionSummary['syncStatus']
      : 'synced';
    return {
      ...fallback,
      id: String(row.id || fallback.id || `summary-${sessionId}`),
      sessionId: String(row.session_id || row.sessionId || fallback.sessionId || sessionId),
      patientId: String(row.patient_id || row.patientId || fallback.patientId || patientId),
      therapistId: row.therapist_id ?? row.therapistId ?? fallback.therapistId ?? resolvedTherapistId ?? null,
      patientName: payload.patientName || fallback.patientName || patient?.name || 'Paciente',
      startedAt: row.started_at || row.startedAt || fallback.startedAt,
      endedAt: row.ended_at || row.endedAt || fallback.endedAt,
      durationSeconds: Number(row.duration_seconds ?? row.durationSeconds ?? fallback.durationSeconds ?? 0) || 0,
      totalTrials,
      independentTrials,
      promptedTrials,
      errorTrials,
      accuracyPercent,
      independencePercent,
      trialTypesUsed,
      totalBehaviorEvents: Number(row.total_behavior_events ?? row.totalBehaviorEvents ?? fallback.totalBehaviorEvents ?? 0) || 0,
      frequencySummary: Array.isArray(row.frequency_summary) ? row.frequency_summary : fallback.frequencySummary || [],
      durationSummary: Array.isArray(row.duration_summary) ? row.duration_summary : fallback.durationSummary || [],
      intervalSummary: Array.isArray(row.interval_summary) ? row.interval_summary : fallback.intervalSummary || [],
      abcSummary: Array.isArray(row.abc_summary) ? row.abc_summary : Array.isArray(payload.abcSummary) ? payload.abcSummary : fallback.abcSummary || [],
      masterySummary: Array.isArray(row.mastery_summary) ? row.mastery_summary : Array.isArray(payload.masterySummary) ? payload.masterySummary : fallback.masterySummary || [],
      maintenanceSummary: Array.isArray(row.maintenance_summary) ? row.maintenance_summary : Array.isArray(payload.maintenanceSummary) ? payload.maintenanceSummary : (fallback as any).maintenanceSummary || [],
      teachingSummary: payload.teachingSummary || fallback.teachingSummary || {
        totalTrials,
        independentTrials,
        promptedTrials,
        errorTrials,
        accuracyPercent,
        independencePercent,
        typesUsed: trialTypesUsed
      },
      syncStatus,
      blockingItems: Array.isArray(row.blocking_items) ? row.blocking_items : Array.isArray(payload.blockingItems) ? payload.blockingItems : fallback.blockingItems || [],
      warningItems: Array.isArray(row.warning_items) ? row.warning_items : Array.isArray(payload.warningItems) ? payload.warningItems : fallback.warningItems || [],
      pendingItems: Array.isArray(row.pending_items) ? row.pending_items : fallback.pendingItems || [],
      pendingWarnings: Array.isArray(row.pending_warnings) ? row.pending_warnings : Array.isArray(payload.pendingWarnings) ? payload.pendingWarnings : fallback.pendingWarnings || [],
      sessionNote: row.session_note ?? payload.sessionNote ?? fallback.sessionNote ?? '',
      createdAt: row.created_at || row.createdAt || fallback.createdAt || new Date().toISOString(),
      sourceRecords: fallback.sourceRecords
    };
  };

  const openPersistedPostClosureReport = async () => {
    try {
      const result = await dataService.getSessionReport(sessionId);
      const persistedSummary = result?.success ? normalizePersistedSessionSummary(result.data) : null;
      if (persistedSummary) setPostClosureSummary(persistedSummary);
    } catch (error) {
      console.warn('Relatorio ABA persistido indisponivel; usando resumo local.', error);
    } finally {
      setShowPostClosureReport(true);
    }
  };

  const closureBlockers = sessionClosureSummary.blockingItems;
  const closureWarnings = sessionClosureSummary.warningItems;
  const hasClosureBlockers = closureBlockers.length > 0;
  const hasClosureWarnings = closureWarnings.length > 0;
  const scrollBottomPaddingPx = Math.max(24, clinicalDockHeight + 24);
  const scrollBottomPaddingStyle: React.CSSProperties = {
    paddingBottom: `calc(${scrollBottomPaddingPx}px + env(safe-area-inset-bottom))`,
    scrollPaddingBottom: `calc(${scrollBottomPaddingPx}px + env(safe-area-inset-bottom))`
  };
  const actionToastPositionClass = intervalRun
    ? 'top-[calc(5rem+env(safe-area-inset-top))] bottom-auto'
    : intervalToastCompact
      ? 'top-[calc(4.75rem+env(safe-area-inset-top))] bottom-auto'
    : 'bottom-[calc(6.75rem+env(safe-area-inset-bottom))]';
  const closeCompletedSession = () => {
    if (typeof onConfirmEndSession === 'function') {
      onConfirmEndSession({ alreadyPersisted: true, summary: postClosureSummary });
      return;
    }
    onClose?.();
  };
  const actionToastPortal = actionToast && typeof document !== 'undefined'
    ? createPortal(
        <div className={`pointer-events-none fixed inset-x-0 z-[220] flex justify-center px-3 xl:inset-x-auto xl:right-4 xl:bottom-4 xl:top-auto xl:justify-end ${actionToastPositionClass}`}>
          <AbaSessionToast toast={actionToast} compact={intervalToastCompact} />
        </div>,
        document.body
      )
    : null;

  if (sessionGoals.length === 0 && !(sessionCompleted && postClosureSummary && !showSessionSummary)) {
    const emptyStateContent = (
      <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-6">
        <button onClick={onClose} className="absolute top-6 left-6 p-2 hover:bg-gray-100 rounded-full transition-all">
          <ChevronLeft size={32} className="text-gray-400" />
        </button>
        {activeSession && (
          <button onClick={requestEndSession} className="absolute top-6 right-6 px-4 py-2 bg-red-50 text-red-500 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-red-100 transition-all flex items-center gap-2">
            <StopCircle size={16} /> Encerrar sessão
          </button>
        )}
        <Zap size={64} className="text-gray-200 mb-4" />
        <h2 className="text-xl font-bold text-gray-800 text-center">Nenhuma meta em treino ou prioritaria.</h2>
        {actionToastPortal}
      </div>
    );
    if (typeof document === 'undefined') return emptyStateContent;
    return createPortal(emptyStateContent, document.body);
  }

  if (sessionCompleted && postClosureSummary && !showSessionSummary) {
    const postClosureContent = (
      <div className="fixed inset-0 z-[100] bg-[#F4F7FE] flex flex-col overflow-y-auto animate-fade-in">
        <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col justify-center p-6">
          <div className="rounded-[32px] bg-white border border-blue-100 p-8 shadow-2xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Sessão concluída</p>
                <h2 className="mt-2 text-3xl font-bold text-gray-900">{showPostClosureReport ? 'Relatório da sessão' : 'Sessão encerrada com sucesso'}</h2>
                <p className="mt-2 text-sm text-gray-500">
                  {showPostClosureReport
                    ? 'Relatório clínico estruturado, somente leitura para os dados principais da sessão.'
                    : 'Os registros clínicos foram bloqueados para novas coletas. Apenas complementos autorizados permanecem disponíveis.'}
                </p>
              </div>
              <CheckCircle2 size={44} className="text-emerald-500" />
            </div>

            <section className="mt-6 rounded-[24px] bg-[#F8FAFF] border border-blue-100 p-5">
              <h3 className="text-lg font-bold text-gray-900">Resumo geral</h3>
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-2xl bg-white border border-gray-100 p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Paciente</p>
                  <p className="text-lg font-bold text-gray-900">{postClosureSummary.patientName || patient.name}</p>
                </div>
                <div className="rounded-2xl bg-white border border-gray-100 p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Início</p>
                  <p className="text-lg font-bold text-gray-900">{formatSessionTime(postClosureSummary.startedAt)}</p>
                </div>
                <div className="rounded-2xl bg-white border border-gray-100 p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fim</p>
                  <p className="text-lg font-bold text-gray-900">{formatSessionTime(postClosureSummary.endedAt)}</p>
                </div>
                <div className="rounded-2xl bg-white border border-gray-100 p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Duração</p>
                  <p className="text-lg font-bold text-gray-900">{formatSessionDuration(postClosureSummary.durationSeconds)}</p>
                </div>
                <div className="rounded-2xl bg-white border border-gray-100 p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tentativas</p>
                  <p className="text-2xl font-bold text-gray-900">{postClosureSummary.totalTrials}</p>
                </div>
                <div className="rounded-2xl bg-white border border-gray-100 p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Registros comportamentais</p>
                  <p className="text-2xl font-bold text-gray-900">{postClosureSummary.totalBehaviorEvents}</p>
                </div>
                <div className="rounded-2xl bg-white border border-gray-100 p-4 md:col-span-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sincronização</p>
                  <p className="text-sm font-bold text-gray-900 uppercase">{postClosureSummary.syncStatus === 'synced' ? 'sincronizado' : postClosureSummary.syncStatus === 'error' ? 'erro de sincronização' : 'pendente de sincronização'}</p>
                </div>
              </div>
            </section>

            {showPostClosureReport && postClosureReport && (
              <div className="mt-5 space-y-5">
                <section className="rounded-[24px] bg-white border border-blue-100 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <h3 className="text-lg font-bold text-gray-900">Dados da sessão</h3>
                    <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${syncClasses[postClosureReport.header.syncStatus]}`}>
                      {postClosureReport.header.syncStatus === 'synced' ? 'sincronizado' : postClosureReport.header.syncStatus === 'error' ? 'erro de sincronização' : 'pendente de sincronização'}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                    {[
                      ['Paciente', postClosureReport.header.patient],
                      ['Terapeuta', postClosureReport.header.therapist],
                      ['Data', postClosureReport.header.date],
                      ['Início', postClosureReport.header.startedAt],
                      ['Fim', postClosureReport.header.endedAt],
                      ['Duração total', postClosureReport.header.duration],
                      ['Status', 'concluída']
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
                        <p className="mt-1 text-base font-bold text-gray-900">{value}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[24px] bg-white border border-blue-100 p-5">
                  <h3 className="text-lg font-bold text-gray-900">Resumo geral</h3>
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      ['Tentativas de ensino', postClosureReport.generalSummary.totalTeachingTrials],
                      ['Registros comportamentais', postClosureReport.generalSummary.totalBehaviorRecords],
                      ['Eventos de frequência', postClosureReport.generalSummary.totalFrequencyEvents],
                      ['Eventos de duração', postClosureReport.generalSummary.totalDurationEvents],
                      ['Coletas por intervalo', postClosureReport.generalSummary.totalIntervalCollections]
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
                        <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
                      </div>
                    ))}
                  </div>
                  {postClosureReport.generalSummary.sessionNote ? (
                    <div className="mt-4 rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Observação da sessão</p>
                      <p className="mt-1 text-sm text-emerald-900 whitespace-pre-wrap">{postClosureReport.generalSummary.sessionNote}</p>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 p-4 text-sm font-semibold text-amber-700">Observação da sessão pendente.</p>
                  )}
                </section>

                <section className="rounded-[24px] bg-white border border-blue-100 p-5">
                  <h3 className="text-lg font-bold text-gray-900">Tentativas de ensino</h3>
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3">
                    {[
                      ['Total', postClosureReport.teachingSummary.totalTrials],
                      ['Independentes', postClosureReport.teachingSummary.independentTrials],
                      ['Com ajuda', postClosureReport.teachingSummary.promptedTrials],
                      ['Erros', postClosureReport.teachingSummary.errorTrials],
                      ['% acerto', `${postClosureReport.teachingSummary.accuracyPercent}%`],
                      ['% independência', `${postClosureReport.teachingSummary.independencePercent}%`]
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
                        <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tipos usados</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {postClosureReport.teachingSummary.typesUsed.length > 0 ? postClosureReport.teachingSummary.typesUsed.map((item) => (
                          <span key={item.key} className="rounded-full bg-white border border-blue-100 px-3 py-1 text-xs font-bold text-gray-700">{item.label} ({item.count})</span>
                        )) : <span className="text-sm text-gray-400">Nenhum tipo registrado.</span>}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Prompts usados</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {postClosureReport.teachingSummary.promptsUsed.length > 0 ? postClosureReport.teachingSummary.promptsUsed.map((item) => (
                          <span key={item.key} className="rounded-full bg-white border border-blue-100 px-3 py-1 text-xs font-bold text-gray-700">{item.label} ({item.count})</span>
                        )) : <span className="text-sm text-gray-400">Nenhum prompt de ajuda registrado.</span>}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-[24px] bg-white border border-blue-100 p-5">
                  <h3 className="text-lg font-bold text-gray-900">Metas trabalhadas</h3>
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {postClosureReport.targetSummaries.length > 0 ? postClosureReport.targetSummaries.map((target) => (
                      <div key={`${target.targetId || target.targetName}`} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-gray-900">{target.targetName}</p>
                            <p className="text-xs text-gray-500 mt-1">{target.program}</p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${target.masteryStatus === 'critério atingido hoje' ? 'bg-emerald-50 text-emerald-600' : target.masteryStatus === 'dados insuficientes' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                            {target.masteryStatus}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600">
                          <p><b>{target.totalTrials}</b> tentativas</p>
                          <p><b>{target.independentCorrect}</b> independentes</p>
                          <p><b>{target.promptedCorrect}</b> com ajuda</p>
                          <p><b>{target.errors}</b> erros</p>
                          <p><b>{target.accuracyPercent}%</b> acurácia</p>
                          <p><b>{target.independencePercent}%</b> independência</p>
                          <p className="md:col-span-2">Tipo mais usado: <b>{target.mostUsedTrialType}</b></p>
                        </div>
                      </div>
                    )) : <p className="text-sm text-gray-500">Nenhuma meta trabalhada nesta sessão.</p>}
                  </div>
                </section>

                {Array.isArray((postClosureSummary as any).maintenanceSummary) && (postClosureSummary as any).maintenanceSummary.length > 0 && (
                  <section className="rounded-[24px] bg-white border border-amber-100 p-5">
                    <h3 className="text-lg font-bold text-amber-700">Manutencao e regressao</h3>
                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {(postClosureSummary as any).maintenanceSummary.map((row: any) => (
                        <div key={row.id || row.name} className="rounded-2xl bg-[#FFFDF7] border border-amber-100 p-4">
                          <p className="text-sm font-bold text-gray-900">{row.name}</p>
                          <p className="mt-1 text-xs font-semibold text-gray-500">Status: {row.status}</p>
                          <p className="mt-2 text-xs text-gray-600">Probes: {row.totalTrials ?? 0} - acuracia {row.accuracyPercent ?? 0}% - independencia {row.independencePercent ?? 0}%</p>
                          {Number(row.consecutiveFailureCount || 0) >= 2 && <p className="mt-2 text-xs font-bold text-red-600">{row.consecutiveFailureCount} probes consecutivos abaixo do criterio</p>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="rounded-[24px] bg-white border border-blue-100 p-5">
                  <h3 className="text-lg font-bold text-gray-900">Comportamentos registrados</h3>
                  <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-3">
                    <div className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                      <p className="text-sm font-bold text-gray-900">Frequência</p>
                      <div className="mt-3 space-y-3">
                        {postClosureReport.behaviorSummaries.frequency.length > 0 ? postClosureReport.behaviorSummaries.frequency.map((item) => (
                          <div key={item.behavior} className="rounded-xl bg-white border border-gray-100 p-3 text-xs text-gray-600">
                            <p className="font-bold text-gray-900">{item.behavior}</p>
                            <p>Total: {item.totalOccurrences}</p>
                            <p>Locais: {item.locations.join(', ') || 'Não informado'}</p>
                            <p>Severidade média: {item.averageSeverity ?? '-'}</p>
                            <p>Horários: {item.occurrenceTimes.join(', ') || '-'}</p>
                          </div>
                        )) : <p className="text-sm text-gray-400">Sem frequência registrada.</p>}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                      <p className="text-sm font-bold text-gray-900">Duração</p>
                      <div className="mt-3 space-y-3">
                        {postClosureReport.behaviorSummaries.duration.length > 0 ? postClosureReport.behaviorSummaries.duration.map((item) => (
                          <div key={item.behavior} className="rounded-xl bg-white border border-gray-100 p-3 text-xs text-gray-600">
                            <p className="font-bold text-gray-900">{item.behavior}</p>
                            <p>Episódios: {item.episodes}</p>
                            <p>Duração total: {formatDurationSeconds(item.totalSeconds)}</p>
                            <p>Duração média: {formatDurationSeconds(item.averageSeconds)}</p>
                            <p>Maior episódio: {formatDurationSeconds(item.maxSeconds)}</p>
                            <p>Locais: {item.locations.join(', ') || 'Não informado'}</p>
                            <p>Severidade média: {item.averageSeverity ?? '-'}</p>
                          </div>
                        )) : <p className="text-sm text-gray-400">Sem duração registrada.</p>}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                      <p className="text-sm font-bold text-gray-900">Intervalo</p>
                      <div className="mt-3 space-y-3">
                        {postClosureReport.behaviorSummaries.interval.length > 0 ? postClosureReport.behaviorSummaries.interval.map((item) => (
                          <div key={`${item.behavior}-${item.method}`} className="rounded-xl bg-white border border-gray-100 p-3 text-xs text-gray-600">
                            <p className="font-bold text-gray-900">{item.behavior}</p>
                            <p>Método: {getMeasurementLabel(item.method)}</p>
                            <p>Respondidos: {item.totalIntervals}/{item.plannedIntervals || item.totalIntervals} | SIM: {item.yes} | NÃO: {item.no}</p>
                            <p>Ocorrência: {item.occurrencePercent}%</p>
                            <p>Status: {item.status === 'PARTIALLY_COMPLETED' ? 'finalizada antecipadamente' : 'completa'}</p>
                            <p>Duração do intervalo: {item.intervalSeconds ? `${item.intervalSeconds}s` : '-'}</p>
                            <p>Local: {item.location}</p>
                            <p>Severidade média: {item.averageSeverity ?? '-'}</p>
                          </div>
                        )) : <p className="text-sm text-gray-400">Sem intervalo registrado.</p>}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-[24px] bg-white border border-blue-100 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <h3 className="text-lg font-bold text-gray-900">ABC</h3>
                    {postClosureReport.pendingComplements.abcPendingCount > 0 && (
                      <button
                        onClick={() => {
                          setShowComplementEditor(true);
                          if (pendingAbcRecords[0]) startEditingRecord(pendingAbcRecords[0]);
                        }}
                        className="rounded-2xl bg-amber-50 px-4 py-2 text-xs font-bold uppercase tracking-widest text-amber-700 border border-amber-100"
                      >
                        Completar ABC
                      </button>
                    )}
                  </div>
                  <div className="mt-4 space-y-3">
                    {postClosureReport.abcEvents.length > 0 ? postClosureReport.abcEvents.map((event, index) => (
                      <div key={`${event.behavior}-${index}`} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4 text-sm text-gray-600">
                        <p className="font-bold text-gray-900">{event.behavior}</p>
                        <p>Antecedente: {event.antecedent || '-'}</p>
                        <p>Consequência: {event.consequence || '-'}</p>
                        <p>Local: {event.location || '-'} | Severidade: {event.severity ?? '-'}</p>
                        {event.note && <p>Observação: {event.note}</p>}
                      </div>
                    )) : <p className="text-sm text-gray-500">Nenhum ABC preenchido nesta sessão.</p>}
                    {postClosureReport.pendingComplements.abcPendingCount > 0 && (
                      <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 text-sm font-semibold text-amber-700">
                        Existem eventos sem ABC preenchido.
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-[24px] bg-white border border-blue-100 p-5">
                  <h3 className="text-lg font-bold text-gray-900">Pendências e complementos</h3>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                    {[
                      ['Assinatura do responsável', postClosureReport.pendingComplements.guardianSignature === 'completed' ? 'concluída' : 'pendente'],
                      ['Observação da sessão', postClosureReport.pendingComplements.sessionNote === 'completed' ? 'concluída' : 'pendente'],
                      ['ABCs pendentes', postClosureReport.pendingComplements.abcPendingCount],
                      ['Dados não sincronizados', postClosureReport.pendingComplements.unsyncedCount]
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
                        <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {showComplementEditor && (
                  <section className="rounded-[24px] bg-slate-900 text-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold text-violet-200 uppercase tracking-widest">Complementos autorizados</p>
                        <h3 className="text-xl font-bold">Editar observação e ABC pendente</h3>
                      </div>
                      <button onClick={() => { setShowComplementEditor(false); cancelEditingRecord(); }} className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                        <X size={18} />
                      </button>
                    </div>
                    <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-slate-300">
                      Observação da sessão
                      <textarea
                        value={sessionNote}
                        onChange={(event) => setSessionNote(event.target.value)}
                        className="mt-2 w-full min-h-[96px] rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400"
                        placeholder="Registre complementos administrativos da sessão."
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={saveSessionNoteComplement} className="rounded-2xl bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-900">
                        Salvar observação
                      </button>
                      {pendingAbcRecords.length > 0 && (
                        <button onClick={() => startEditingRecord(pendingAbcRecords[0])} className="rounded-2xl bg-amber-400 px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-900">
                          Completar próximo ABC
                        </button>
                      )}
                    </div>
                    {editingRecordId && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-4">
                        <p className="text-sm font-bold">ABC de {editingRecordTitle}</p>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <select value={editingRecordAntecedent} onChange={(event) => setEditingRecordAntecedent(event.target.value)} className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none">
                            <option value="">Antecedente</option>
                            {antecedentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          <select value={editingRecordConsequence} onChange={(event) => setEditingRecordConsequence(event.target.value)} className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none">
                            <option value="">Consequência</option>
                            {consequenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          <select value={editingRecordLocation} onChange={(event) => setEditingRecordLocation(event.target.value)} className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none">
                            {locationOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          <select value={editingRecordSeverity} onChange={(event) => setEditingRecordSeverity(Number(event.target.value))} className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none">
                            {severityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </div>
                        <textarea value={editingRecordNotes} onChange={(event) => setEditingRecordNotes(event.target.value)} className="mt-3 w-full min-h-[72px] rounded-xl bg-white px-3 py-2 text-sm text-slate-700 outline-none" placeholder="Observação do ABC" />
                        <div className="mt-3 flex gap-2">
                          <button onClick={cancelEditingRecord} className="flex-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white">Cancelar</button>
                          <button onClick={saveRecordEdit} className="flex-1 rounded-xl bg-emerald-400 px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-900">Salvar ABC</button>
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              {!showPostClosureReport && (
                <button onClick={openPersistedPostClosureReport} className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 font-semibold text-white shadow-lg shadow-purple-500/20">
                  <FileText size={18} /> Ver relatório
                </button>
              )}
              {showPostClosureReport && (
                <button onClick={() => setShowComplementEditor((value) => !value)} className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1B254B] px-5 py-3 font-semibold text-white">
                  <Pencil size={18} /> Editar complementos autorizados
                </button>
              )}
              {showPostClosureReport && (
                <button disabled title="Exportação em PDF será implementada em breve." className="flex-1 inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-gray-100 px-5 py-3 font-semibold text-gray-400">
                  <FileText size={18} /> Gerar PDF
                </button>
              )}
              {showPostClosureReport && (
                <button onClick={() => { setShowPostClosureReport(false); setShowComplementEditor(false); cancelEditingRecord(); }} className="flex-1 rounded-2xl bg-white border border-blue-100 px-5 py-3 font-semibold text-gray-700">
                  Voltar ao resumo
                </button>
              )}
              <button onClick={closeCompletedSession} className="flex-1 rounded-2xl bg-white border border-blue-100 px-5 py-3 font-semibold text-gray-700">
                Voltar ao paciente
              </button>
            </div>
          </div>
        </div>
        {actionToastPortal}
      </div>
    );
    if (typeof document === 'undefined') return postClosureContent;
    return createPortal(postClosureContent, document.body);
  }

  const openDurationsPanel = openDurations.length > 0 ? (
    <div className="bg-white rounded-[24px] sm:rounded-[28px] p-3 sm:p-5 shadow-2xl shadow-blue-900/10 border border-blue-100">
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <Timer size={18} className="text-[#7a32fc]" />
        <h2 className="text-sm font-bold text-gray-800">Eventos em andamento</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {openDurations.map((event) => (
          <div key={event.id} className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-3 sm:p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800 truncate">{event.behaviorName}</p>
                <p className="text-xs text-gray-500 mt-1">{event.location || 'Sem local'} - severidade {event.severity || '-'}</p>
                <p className="text-[11px] text-gray-400 mt-1">Inicio {new Date(event.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cronometro</p>
                <p className="text-3xl sm:text-2xl font-bold text-[#7a32fc] leading-none">{formatElapsed(event.startedAt, nowMs)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => endDuration(event.id)}
                disabled={Boolean(actionLocks[`duration:end:${event.id}`])}
                className="min-h-[48px] bg-[#1B254B] text-white rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all active:scale-95 disabled:opacity-60"
              >
                Encerrar
              </button>
              <button
                onClick={() => openAbcModalForBehaviorName(event.behaviorName)}
                className="min-h-[48px] bg-white text-[#7a32fc] border border-purple-100 rounded-xl px-3 py-2 text-[11px] sm:text-xs font-bold uppercase tracking-widest inline-flex items-center justify-center gap-2"
              >
                <FileText size={14} /> ABC rapido
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const getDockButtonClass = (color: string, active = false) => {
    const palette: Record<string, string> = {
      red: active ? 'bg-red-600 text-white border-red-500 shadow-red-900/25' : 'bg-red-50 text-red-700 border-red-100',
      rose: active ? 'bg-rose-600 text-white border-rose-500 shadow-rose-900/25' : 'bg-rose-50 text-rose-700 border-rose-100',
      amber: active ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-amber-900/25' : 'bg-amber-50 text-amber-700 border-amber-100',
      violet: active ? 'bg-violet-600 text-white border-violet-500 shadow-violet-900/25' : 'bg-violet-50 text-violet-700 border-violet-100',
      sky: active ? 'bg-sky-600 text-white border-sky-500 shadow-sky-900/25' : 'bg-sky-50 text-sky-700 border-sky-100',
      emerald: active ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-900/25' : 'bg-emerald-50 text-emerald-700 border-emerald-100',
      slate: active ? 'bg-[#1B254B] text-white border-[#1B254B] shadow-slate-900/25' : 'bg-slate-50 text-slate-700 border-slate-100'
    };
    return palette[color] || palette.slate;
  };

  const renderDockShortcutButton = (shortcut: any, compact = false, closeAfterAction = false) => {
    const behavior = resolveShortcutBehavior(shortcut);
    const method = String(shortcut?.method || behavior.defaultMeasurement || 'frequency');
    const openDuration = method === 'duration' ? findOpenDurationForBehavior(behavior.name) : null;
    const isActive = Boolean(openDuration);
    const elapsed = openDuration ? formatElapsed(openDuration.startedAt, nowMs) : '';
    const lockKey = method === 'duration' && openDuration
      ? `duration:end:${openDuration.id}`
      : method === 'duration'
        ? `duration:start:${behavior.id}`
        : `frequency:${behavior.id}:${behavior.name}`;
    const disabled = Boolean(actionLocks[lockKey]);
    const feedbackKey = `behavior:${behavior.id}`;
    const label = method === 'duration'
      ? (openDuration ? behavior.name : String(shortcut?.label || `${behavior.name} iniciar`))
      : String(shortcut?.label || behavior.name);
    const isFrequencyLike = method === 'frequency' || method === 'rate';

    return (
      <button
        key={shortcut.behaviorId}
        type="button"
        onClick={() => {
          executeBehaviorShortcut(shortcut);
          if (closeAfterAction) setClinicalDockSheetOpen(false);
        }}
        disabled={disabled}
        data-aba-dock-shortcut={shortcut.behaviorId}
        data-aba-dock-duration-active={isActive ? 'true' : 'false'}
        className={`relative min-h-[48px] overflow-visible rounded-[18px] border px-3 py-2 text-left shadow-lg transition-all active:scale-[0.98] disabled:opacity-60 ${getDockButtonClass(shortcut.color, isActive || crisisMode)} ${isActive ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-white animate-pulse' : ''} ${microFeedback[feedbackKey] ? 'scale-[0.98] ring-4 ring-white/70' : ''} ${compact ? 'min-h-[56px]' : ''}`}
      >
        {isFrequencyLike && microFeedback[feedbackKey] === 'plus' && (
          <span className="pointer-events-none absolute -top-3 right-2 z-20 animate-pop rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-white shadow-lg shadow-emerald-900/20">+1</span>
        )}
        {microFeedback[feedbackKey] === 'pulse' && (
          <span className="pointer-events-none absolute -top-3 right-2 z-20 animate-pop rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-[#1B254B] shadow-lg">ON</span>
        )}
        <span className="flex items-center justify-between gap-1.5 text-[11px] font-black uppercase tracking-widest">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {method === 'duration' ? (openDuration ? <Square size={13} /> : <Play size={13} />) : <Plus size={13} />}
            <span className="truncate">{label}</span>
          </span>
          {openDuration && <span className="ml-1 shrink-0 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px]">{elapsed}</span>}
        </span>
        <span className={`${(mobileFocusMode || compact) && !openDuration ? 'hidden' : 'block'} mt-1 text-[10px] font-semibold opacity-75`}>
          {openDuration ? 'encerrar agora' : method === 'duration' ? 'iniciar duração' : '+1 ocorrência'}
        </span>
      </button>
    );
  };

  const clinicalDockCompact = Boolean(intervalRun && !intervalResponseActive);
  const clinicalDockPausedCompact = Boolean(intervalRunPaused && !intervalResponseActive);
  const clinicalDock = !sessionCompleted && !intervalResponseActive ? (
    <div
      ref={clinicalDockRef}
      data-aba-clinical-dock
      data-aba-clinical-dock-compact={clinicalDockCompact ? 'true' : 'false'}
      className={`xl:hidden fixed inset-x-0 bottom-0 z-[130] px-2 pb-[calc(0.55rem+env(safe-area-inset-bottom))] pt-2 ${clinicalDockSheetOpen ? 'pointer-events-none' : 'pointer-events-auto'}`}
    >
      <div className={`mx-auto max-w-3xl rounded-[24px] border p-1.5 shadow-xl backdrop-blur-xl ${clinicalDockCompact ? 'opacity-95' : 'p-2 shadow-2xl'} ${crisisMode ? 'border-red-300 bg-slate-950/95 shadow-red-950/30' : 'border-blue-100 bg-white/95 shadow-blue-950/15'}`}>
        {!clinicalDockPausedCompact && openDurations.length > 0 && (
          <div className={`mb-1.5 flex items-center justify-between rounded-2xl px-3 py-2 text-xs font-black ${crisisMode ? 'bg-white/10 text-white' : 'bg-amber-50 text-amber-800'}`} data-aba-dock-open-duration-badge>
            <span>{openDurations.length} duração em andamento</span>
            <span>{openDurations[0].behaviorName} {formatElapsed(openDurations[0].startedAt, nowMs)} ■</span>
          </div>
        )}
        {clinicalDockPausedCompact ? (
          <div className="grid grid-cols-2 gap-2" data-aba-clinical-dock-paused-compact>
            <button
              type="button"
              onClick={() => {
                setCrisisMode(true);
                setClinicalDockSheetOpen(true);
              }}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[18px] border border-red-100 bg-red-50 px-3 text-[11px] font-black uppercase tracking-widest text-red-600 shadow-sm transition-all active:scale-[0.98]"
            >
              <Plus size={15} /> + Crise
            </button>
            <button
              type="button"
              onClick={() => {
                setCrisisMode(false);
                setClinicalDockSheetOpen(true);
              }}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[18px] border border-slate-100 bg-[#1B254B] px-3 text-[11px] font-black uppercase tracking-widest text-white shadow-sm transition-all active:scale-[0.98]"
            >
              <MoreHorizontal size={15} /> Mais
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_64px] gap-2">
            {dockShortcuts.map((shortcut) => renderDockShortcutButton(shortcut, crisisMode))}
            <button
              type="button"
              onClick={() => {
                if (crisisMode) openAbcModal();
                else setClinicalDockSheetOpen(true);
              }}
              className={`min-h-[48px] rounded-[18px] border px-2 text-[11px] font-black uppercase tracking-widest shadow-lg transition-all active:scale-[0.98] ${crisisMode ? 'border-white/15 bg-white text-slate-950' : 'border-slate-100 bg-[#1B254B] text-white'}`}
            >
              {crisisMode ? 'ABC' : 'Mais'}
            </button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  const clinicalDockSheet = clinicalDockSheetOpen && !intervalResponseActive ? (
    <div className="fixed inset-0 z-[210] xl:hidden" data-aba-clinical-dock-sheet>
      <button
        type="button"
        aria-label="Fechar dock clínico"
        onClick={() => setClinicalDockSheetOpen(false)}
        className="absolute inset-0 h-full w-full bg-slate-950/35 backdrop-blur-[2px]"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[32px] border border-blue-100 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#7a32fc]">Dock clínico</p>
            <h2 className="text-xl font-black text-slate-900">Registro sem sair da meta</h2>
          </div>
          <button
            type="button"
            onClick={() => setCrisisMode((value) => !value)}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-3 text-[10px] font-black uppercase tracking-widest ${crisisMode ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600'}`}
          >
            <ShieldAlert size={15} /> Modo crise
          </button>
        </div>

        {crisisMode ? (
          <section className="mt-4 rounded-[24px] border border-red-100 bg-red-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Crise / alta prioridade</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {quickBehaviorShortcuts.filter((shortcut) => crisisShortcutIdSet.has(shortcut.behaviorId)).map((shortcut) => renderDockShortcutButton(shortcut, true, true))}
              <button onClick={() => { setClinicalDockSheetOpen(false); openAbcModal(); }} className="min-h-[56px] rounded-[18px] border border-slate-900 bg-slate-950 px-3 text-left text-[11px] font-black uppercase tracking-widest text-white">
                <FileText size={14} className="mb-1" /> ABC rápido
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="mt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Crise / alta prioridade</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {quickBehaviorShortcuts.filter((shortcut) => ['aggression', 'self_injury', 'escape', 'refusal'].includes(shortcut.behaviorId)).map((shortcut) => renderDockShortcutButton(shortcut, false, true))}
              </div>
            </section>

            <section className="mt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#7a32fc]">Duração</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {behaviorPresets.filter((behavior) => behavior.defaultMeasurement === 'duration' || behavior.allowedMeasurements?.includes('duration')).slice(0, 4).map((behavior) => renderDockShortcutButton({
                  behaviorId: behavior.id,
                  label: `${behavior.name} iniciar`,
                  method: 'duration',
                  color: behavior.id === 'crying' ? 'sky' : behavior.id === 'escape' ? 'amber' : 'emerald'
                }, false, true))}
              </div>
            </section>

          </>
        )}

        <section className="mt-4 rounded-[24px] border border-blue-100 bg-[#F4F7FE] p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">ABC rápido</p>
          <button onClick={() => { setClinicalDockSheetOpen(false); openAbcModal(); }} className="mt-2 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#1B254B] px-4 text-xs font-black uppercase tracking-widest text-white">
            <FileText size={16} /> Abrir ABC rápido
          </button>
        </section>

        <section className="mt-4 rounded-[24px] border border-blue-100 bg-white p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Contexto atual</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Local atual
              <select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)} className="mt-1 w-full rounded-2xl border border-blue-100 bg-[#F4F7FE] px-3 py-3 text-xs font-bold text-slate-700 outline-none">
                {locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Severidade atual
              <select value={selectedSeverity} onChange={(event) => setSelectedSeverity(Number(event.target.value))} className="mt-1 w-full rounded-2xl border border-blue-100 bg-[#F4F7FE] px-3 py-3 text-xs font-bold text-slate-700 outline-none">
                {severityOptions.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
              </select>
            </label>
          </div>
        </section>

        {openDurations.length > 0 && (
          <section className="mt-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Eventos em andamento</p>
            <div className="mt-2 space-y-2">
              {openDurations.map((event) => (
                <button key={event.id} onClick={() => { endDuration(event.id); setClinicalDockSheetOpen(false); }} disabled={Boolean(actionLocks[`duration:end:${event.id}`])} className="flex min-h-[52px] w-full items-center justify-between rounded-2xl border border-blue-100 bg-[#F4F7FE] px-4 text-left text-xs font-black text-slate-800 disabled:opacity-60">
                  <span>{event.behaviorName}</span>
                  <span>{formatElapsed(event.startedAt, nowMs)} ■</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mt-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Últimos registros</p>
          <div className="mt-2 space-y-2">
            {recentBehaviorRecords.length === 0 ? (
              <p className="rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3 text-xs font-semibold text-slate-500">Nenhum comportamento registrado nesta sessão.</p>
            ) : recentBehaviorRecords.map((record) => (
              <div key={record.id} className="rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3">
                <p className="text-xs font-black text-slate-800">{record.title}</p>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">{record.detail} • {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  ) : null;

  const sessionModeContent = (
    <div className="fixed inset-0 z-[100] bg-[#F4F7FE] flex flex-col overflow-hidden overflow-x-hidden animate-fade-in pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="sticky top-0 z-50 bg-white/95 backdrop-blur px-3 py-2 sm:px-4 sm:py-3 lg:px-6 lg:py-5 shadow-sm shrink-0 lg:flex lg:items-center lg:justify-between lg:gap-4">
        <div className="flex items-center gap-2 sm:gap-5 min-w-0">
          <button onClick={onClose} className="p-2 -ml-1 sm:-ml-2 hover:bg-gray-100 rounded-full transition-all shrink-0">
            <ChevronLeft size={24} className="text-gray-400" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base sm:text-2xl font-bold text-gray-800 tracking-tight truncate">Sessão: <span className="text-[#7a32fc]">{patient.name}</span></h1>
            <p className={`${mobileFocusMode ? 'hidden sm:block' : 'block'} text-[10px] font-bold text-gray-400 uppercase tracking-[0.18em] mt-0.5 sm:mt-1`}>Registro ABA em tempo real</p>
          </div>
          <button
            onClick={() => setMobileFocusMode((value) => !value)}
            className="md:hidden ml-auto shrink-0 rounded-full bg-[#1B254B] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white"
          >
            {mobileFocusMode ? 'Foco' : 'Completo'}
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:mt-0 lg:flex lg:items-center lg:justify-end lg:gap-3">
          <div className="contents lg:flex lg:items-center lg:gap-3 lg:rounded-2xl lg:bg-[#F4F7FE] lg:border lg:border-blue-100 lg:px-4 lg:py-3">
            <label className="min-h-[52px] rounded-2xl bg-[#F4F7FE] border border-blue-100 px-3 py-2 text-[9px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-widest lg:min-h-0 lg:border-0 lg:bg-transparent lg:p-0">
              Tipo da próxima tentativa
              <select
                value={collectionType}
                onChange={(event) => setCollectionType(event.target.value)}
                className="block mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:border-[#7a32fc]"
              >
                {collectionOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="min-h-[52px] rounded-2xl bg-[#F4F7FE] border border-blue-100 px-3 py-2 text-[9px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-widest lg:min-h-0 lg:border-0 lg:bg-transparent lg:p-0">
              Prompt se houver ajuda
              <select
                value={promptLevelKey}
                onChange={(event) => setPromptLevelKey(event.target.value)}
                className="block mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:border-[#7a32fc]"
              >
                {promptedPromptOptions.map((prompt) => (
                  <option key={prompt.key} value={prompt.key}>{prompt.label}</option>
                ))}
              </select>
            </label>
          </div>
          {activeSession && (
            <div className="min-h-[52px] bg-[#7a32fc]/10 text-[#7a32fc] rounded-2xl px-3 py-2 sm:px-5 sm:py-3 text-right">
              <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest flex items-center justify-end gap-2">
                <Clock size={14} /> Restante
              </p>
              <p className="text-2xl sm:text-3xl font-bold leading-none">{formatCountdown ? formatCountdown(remainingSeconds) : '00:00'}</p>
            </div>
          )}
          {activeSession && (
            <button
              onClick={requestEndSession}
              className="min-h-[52px] bg-red-50 text-red-500 font-bold px-3 sm:px-5 py-3 sm:py-4 rounded-2xl text-xs uppercase tracking-widest hover:bg-red-100 transition-all flex items-center justify-center gap-2"
            >
              <StopCircle size={18} /> Encerrar
            </button>
          )}
        </div>
      </div>

      <div ref={sessionScrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden lg:overflow-hidden grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 lg:overflow-y-auto no-scrollbar" style={scrollBottomPaddingStyle}>
          {sessionWarning && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-700 flex items-center gap-3">
              <AlertCircle size={18} /> {sessionWarning}
            </div>
          )}

          {!intervalRun && openDurations.length > 0 && (
            <div className="sticky top-0 z-30 bg-white rounded-[24px] sm:rounded-[28px] p-3 sm:p-5 shadow-2xl shadow-blue-900/10 border border-blue-100">
              <div className="flex items-center gap-2 mb-4">
                <Timer size={18} className="text-[#7a32fc]" />
                <h2 className="text-sm font-bold text-gray-800">Eventos em andamento</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {openDurations.map((event) => (
                  <div key={event.id} className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-3 sm:p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-gray-800">{event.behaviorName}</p>
                        <p className="text-xs text-gray-500 mt-1">{event.location || 'Sem local'} - severidade {event.severity || '-'}</p>
                        <p className="text-[11px] text-gray-400 mt-1">Inicio {new Date(event.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cronometro</p>
                        <p className="text-3xl font-bold text-[#7a32fc] leading-none">{formatElapsed(event.startedAt, nowMs)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      <button
                        onClick={() => endDuration(event.id)}
                        disabled={Boolean(actionLocks[`duration:end:${event.id}`])}
                        className="min-h-[48px] bg-[#1B254B] text-white rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all active:scale-95 disabled:opacity-60"
                      >
                        Encerrar
                      </button>
                      <button
                        onClick={() => openAbcModalForBehaviorName(event.behaviorName)}
                        className="min-h-[48px] bg-white text-[#7a32fc] border border-purple-100 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest inline-flex items-center justify-center gap-2"
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
            <div
              data-aba-interval-response-active={intervalResponseActive ? 'true' : 'false'}
              className={`sticky top-0 ${intervalResponseActive ? 'z-[160]' : 'z-40'} rounded-[24px] sm:rounded-[28px] p-3 sm:p-5 shadow-2xl border transition-all ${intervalRunAwaitingResponse ? 'bg-amber-50 border-amber-300 ring-4 ring-amber-200/70' : intervalRunPaused ? 'bg-slate-50 border-slate-200 ring-2 ring-slate-200/70' : 'bg-white border-blue-100 shadow-blue-900/10'}`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Timer size={18} className={intervalRunAwaitingResponse ? 'text-amber-600' : intervalRunPaused ? 'text-slate-500' : 'text-[#7a32fc]'} />
                        <h2 className="text-sm font-bold text-gray-800">{intervalRunPaused ? 'Coleta pausada' : 'Coleta por intervalo em andamento'}</h2>
                      </div>
                      <h3 className="text-xl font-bold text-gray-900">{intervalRun.behaviorName}</h3>
                      <p className="text-xs font-semibold text-gray-500 mt-1">
                        {getMeasurementLabel(intervalRun.measurementType)} - {intervalRun.location || 'Sem local'} - severidade {intervalRun.severity || '-'}
                      </p>
                      <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                        Respondidos: {Number(intervalRun.completedCount || 0)}/{Number(intervalRun.totalIntervals || 1)} - SIM: {Number(intervalRun.occurredCount || 0)}
                      </p>
                    </div>
                    {intervalRunAwaitingResponse && !intervalRunPaused && (
                      <button
                        type="button"
                        onClick={() => setIntervalOptionsOpen((open) => !open)}
                        data-aba-interval-options-button
                        className="shrink-0 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-white px-3 text-[10px] font-bold uppercase tracking-widest text-amber-700 shadow-sm active:scale-95"
                      >
                        <MoreHorizontal size={15} /> Opções
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid w-full grid-cols-3 gap-2 sm:gap-3 lg:w-auto lg:min-w-[320px]">
                  <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-3 text-center">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Intervalo</p>
                    <p className="text-2xl font-bold text-gray-900">{intervalRun.intervalIndex}</p>
                  </div>
                  <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-3 text-center">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total</p>
                    <p className="text-2xl font-bold text-gray-900">{intervalRun.totalIntervals}</p>
                  </div>
                  <div className={`rounded-2xl border p-3 text-center ${intervalRunAwaitingResponse ? 'bg-amber-100 border-amber-200' : intervalRunPaused ? 'bg-slate-100 border-slate-200' : 'bg-[#F4F7FE] border-blue-100'}`}>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Restante</p>
                    <p className={`text-2xl font-bold ${intervalRunAwaitingResponse ? 'text-amber-700' : intervalRunPaused ? 'text-slate-700' : 'text-[#7a32fc]'}`}>
                      {intervalRunAwaitingResponse ? 'Agora' : intervalRunPaused ? 'Pausado' : formatRemainingUntil(intervalRun.intervalEndsAt, nowMs)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
                <p className="text-xs font-semibold text-gray-500">
                  {getIntervalInstruction(intervalRun.measurementType)}
                </p>
                <p className={`rounded-2xl px-4 py-3 text-center text-sm font-bold ${intervalRunAwaitingResponse ? 'bg-amber-100 text-amber-800' : intervalRunPaused ? 'bg-slate-100 text-slate-700' : 'bg-[#F4F7FE] text-gray-500'}`}>
                  {intervalRunAwaitingResponse ? 'Responda agora' : intervalRunPaused ? 'Coleta pausada' : 'Aguardando fim do intervalo...'}
                </p>
                {intervalRunAwaitingResponse && (
                <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
                  <button
                    onClick={() => registerInterval(true)}
                    disabled={!intervalRunAwaitingResponse || Boolean(actionLocks[`interval:${intervalRun.id}:${Number(intervalRun.intervalIndex || 1)}`])}
                    className={`min-h-[64px] px-6 py-4 rounded-2xl text-sm font-bold uppercase tracking-widest transition-all active:scale-95 ${intervalRunAwaitingResponse && !actionLocks[`interval:${intervalRun.id}:${Number(intervalRun.intervalIndex || 1)}`] ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                  >
                    SIM
                  </button>
                  <button
                    onClick={() => registerInterval(false)}
                    disabled={!intervalRunAwaitingResponse || Boolean(actionLocks[`interval:${intervalRun.id}:${Number(intervalRun.intervalIndex || 1)}`])}
                    className={`min-h-[64px] px-6 py-4 rounded-2xl text-sm font-bold uppercase tracking-widest transition-all active:scale-95 ${intervalRunAwaitingResponse && !actionLocks[`interval:${intervalRun.id}:${Number(intervalRun.intervalIndex || 1)}`] ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                  >
                    NÃO
                  </button>
                </div>
                )}
              </div>
              <div className={intervalRunPaused ? 'mt-3' : `mt-4 border-t border-blue-100 pt-4 ${intervalResponseActive ? 'pb-2' : ''}`}>
                {intervalRunPaused ? (
                  <div ref={intervalPausedControlsRef} className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4" data-aba-interval-paused-controls>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <button onClick={resumeIntervalRun} className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#1B254B] px-4 py-3 text-xs font-bold uppercase tracking-widest text-white active:scale-95"><RotateCcw size={16} /> Retomar</button>
                      <button onClick={finishIntervalRunNow} className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-emerald-700 active:scale-95"><Square size={15} /> Finalizar agora</button>
                      <button onClick={requestCancelIntervalRun} className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-red-600 active:scale-95"><X size={15} /> Cancelar coleta</button>
                    </div>
                    <p className="mt-3 text-xs font-semibold text-slate-500">
                      Intervalo {intervalRun.intervalIndex}/{intervalRun.totalIntervals} preservado. As respostas anteriores foram mantidas.
                    </p>
                  </div>
                ) : !intervalRunAwaitingResponse ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-aba-interval-running-controls>
                    <button
                      onClick={pauseIntervalRun}
                      className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#1B254B] px-4 py-3 text-xs font-bold uppercase tracking-widest text-white active:scale-95"
                    >
                      <Pause size={16} /> Pausar
                    </button>
                    <button
                      onClick={finishIntervalRunNow}
                      className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-emerald-700 active:scale-95"
                    >
                      <Square size={15} /> Finalizar agora
                    </button>
                    <button
                      onClick={() => setIntervalOptionsOpen((open) => !open)}
                      className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-xs font-bold uppercase tracking-widest text-[#7a32fc] border border-purple-100 active:scale-95"
                    >
                      <MoreHorizontal size={16} /> Opções
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] font-semibold text-amber-700">SIM/NÃO continuam como prioridade. Use Opções no canto para pausar ou encerrar.</p>
                )}
                {intervalOptionsOpen && !intervalRunPaused && (
                  <div className="mt-3 rounded-2xl border border-blue-100 bg-white p-3 shadow-lg shadow-blue-900/5" data-aba-interval-options-panel>
                    {!intervalRunAwaitingResponse && (
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Motivo opcional
                      <select
                        value={intervalEndReason}
                        onChange={(event) => setIntervalEndReason(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-blue-100 bg-[#F8FAFF] px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                      >
                        {intervalLifecycleReasonOptions.map((option) => (
                          <option key={option.key} value={option.key}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    )}
                    <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${intervalRunAwaitingResponse ? '' : 'mt-3'}`}>
                      <button onClick={pauseIntervalRun} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#1B254B] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white active:scale-95"><Pause size={15} /> Pausar coleta</button>
                      <button onClick={finishIntervalRunNow} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 active:scale-95"><Square size={14} /> Finalizar agora</button>
                      <button onClick={requestCancelIntervalRun} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-600 active:scale-95"><X size={14} /> Cancelar coleta</button>
                      <button onClick={() => setIntervalOptionsOpen(false)} className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-gray-100 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600 active:scale-95">Voltar</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {intervalZeroFinishConfirmOpen && intervalRun && (
            <div className="fixed inset-0 z-[220] flex items-end justify-center bg-gray-950/40 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center sm:p-6">
              <div className="w-full max-w-md rounded-[24px] border border-amber-100 bg-white p-5 shadow-2xl shadow-gray-950/20">
                <p className="text-lg font-bold text-gray-900">Nenhum intervalo foi respondido.</p>
                <p className="mt-2 text-sm font-semibold text-gray-600">
                  Deseja cancelar a coleta?
                </p>
                <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => setIntervalZeroFinishConfirmOpen(false)}
                    className="min-h-[48px] rounded-2xl bg-gray-100 px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-600"
                  >
                    Voltar
                  </button>
                  <button
                    onClick={confirmCancelIntervalRun}
                    className="min-h-[48px] rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-red-600 border border-red-100"
                  >
                    Cancelar coleta
                  </button>
                </div>
              </div>
            </div>
          )}

          {intervalCancelConfirmOpen && intervalRun && (
            <div className="fixed inset-0 z-[220] flex items-end justify-center bg-gray-950/40 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center sm:p-6">
              <div className="w-full max-w-md rounded-[24px] border border-red-100 bg-white p-5 shadow-2xl shadow-gray-950/20">
                <p className="text-lg font-bold text-gray-900">Cancelar esta coleta?</p>
                <p className="mt-2 text-sm font-semibold text-gray-600">
                  Os intervalos respondidos não entrarão no resumo clínico.
                </p>
                <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Motivo opcional
                  <select
                    value={intervalCancelReason}
                    onChange={(event) => setIntervalCancelReason(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-blue-100 bg-[#F8FAFF] px-3 py-3 text-xs font-bold text-gray-700 outline-none"
                  >
                    {intervalLifecycleReasonOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => setIntervalCancelConfirmOpen(false)}
                    className="min-h-[48px] rounded-2xl bg-gray-100 px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-600"
                  >
                    Voltar
                  </button>
                  <button
                    onClick={confirmCancelIntervalRun}
                    className="min-h-[48px] rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-red-600 border border-red-100"
                  >
                    Confirmar cancelamento
                  </button>
                </div>
              </div>
            </div>
          )}

          {intervalRun && openDurationsPanel}

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
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Respondidos</p>
                  <p className="text-2xl font-bold text-emerald-950">{intervalSummaryTotals.total}/{Number(intervalSummary?.plannedIntervals || intervalSummary?.plannedTotalIntervals || intervalSummaryTotals.total)}</p>
                </div>
                <div className="rounded-2xl bg-white/70 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">SIM</p>
                  <p className="text-2xl font-bold text-emerald-700">{intervalSummaryTotals.occurred}</p>
                </div>
                <div className="rounded-2xl bg-white/70 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">NÃO</p>
                  <p className="text-2xl font-bold text-emerald-700">{intervalSummaryTotals.notOccurred}</p>
                </div>
                <div className="rounded-2xl bg-white/70 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Ocorrencia</p>
                  <p className="text-2xl font-bold text-emerald-700">{intervalSummaryTotals.percent}%</p>
                </div>
              </div>
              {intervalSummary?.status === 'PARTIALLY_COMPLETED' && (
                <p className="mt-3 rounded-2xl bg-white/70 border border-emerald-100 px-4 py-3 text-sm font-bold text-emerald-800">
                  Finalizada antecipadamente.
                </p>
              )}
            </div>
          )}

          <div className="bg-white rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 shadow-xl shadow-blue-900/5 border border-white">
            <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-center sm:justify-between">
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
                  className="block mt-1 w-full bg-[#F4F7FE] border border-blue-100 rounded-2xl px-4 py-3 text-xs font-bold text-gray-700 outline-none focus:border-[#7a32fc]"
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
                    className={`relative min-h-[136px] border rounded-2xl px-3 py-3 sm:px-4 sm:py-4 text-left font-bold text-sm transition-all hover:scale-[1.02] flex flex-col justify-between overflow-hidden ${behavior.tone} ${selectedBehaviorId === behavior.id ? 'ring-2 ring-[#7a32fc]/40' : ''} ${microFeedback[`behavior:${behavior.id}`] ? 'scale-[0.98] ring-4 ring-white/80' : ''}`}
                  >
                    {microFeedback[`behavior:${behavior.id}`] === 'plus' && (
                      <span className="pointer-events-none absolute right-3 top-3 animate-pop rounded-full bg-emerald-500 px-2 py-1 text-[11px] font-black text-white shadow-lg shadow-emerald-500/20">+1</span>
                    )}
                    {microFeedback[`behavior:${behavior.id}`] === 'pulse' && (
                      <span className="pointer-events-none absolute right-3 top-3 animate-pop rounded-full bg-[#7a32fc] px-2 py-1 text-[10px] font-black text-white shadow-lg shadow-purple-500/20">ON</span>
                    )}
                    <button onClick={() => selectBehavior(behavior)} className="w-full min-h-[58px] text-left">
                      <span className="block">{behavior.name}</span>
                      <span className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest opacity-70">
                        {behavior.defaultMeasurement === 'duration' ? (isOpen ? <Square size={12} /> : <Play size={12} />) : behavior.defaultMeasurement === 'frequency' ? <Plus size={12} /> : <Timer size={12} />}
                        {getMeasurementLabel(behavior.defaultMeasurement)}
                      </span>
                    </button>
                    <button
                      onClick={() => openAbcModal(behavior.id)}
                      className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-1 rounded-xl bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#7a32fc] border border-white/80"
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
                <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap">
                  <button
                    onClick={handleSelectedBehaviorAction}
                    disabled={Boolean(actionLocks[`frequency:${selectedBehavior.id}:${selectedBehavior.name}`])}
                    className={`min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-80 ${microFeedback[`behavior:${selectedBehavior.id}`] === 'plus' ? 'scale-[0.98]' : ''}`}
                  >
                    <Plus size={16} /> + ocorrência
                  </button>
                  <button onClick={() => openAbcModal()} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-white text-[#7a32fc] border border-purple-100 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                    <FileText size={16} /> ABC rapido
                  </button>
                </div>
              )}

              {behaviorMeasurementType === 'duration' && (
                <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap">
                  <button
                    onClick={handleSelectedBehaviorAction}
                    disabled={Boolean(actionLocks[`duration:start:${selectedBehavior.id}`]) || openDurations.some((event) => event.behaviorName === selectedBehavior.name)}
                    className={`min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-60 ${microFeedback[`behavior:${selectedBehavior.id}`] === 'pulse' ? 'scale-[0.98]' : ''}`}
                  >
                    <Play size={16} /> Iniciar duração
                  </button>
                  {openDurations.filter((event) => event.behaviorName === selectedBehavior.name).map((event) => (
                    <button key={event.id} onClick={() => endDuration(event.id)} disabled={Boolean(actionLocks[`duration:end:${event.id}`])} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-[#1B254B] text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60">
                      <Square size={16} /> Encerrar {formatElapsed(event.startedAt, nowMs)}
                    </button>
                  ))}
                </div>
              )}

              {behaviorMeasurementType === 'rate' && (
                <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center">
                  {!rateWindow ? (
                    <button onClick={startRateWindow} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                      <Play size={16} /> Iniciar janela
                    </button>
                  ) : (
                    <>
                      <span className="text-sm font-bold text-gray-700">Janela {formatElapsed(rateWindow.startedAt, nowMs)} - {rateWindow.count} ocorrência(s)</span>
                      <button onClick={registerRateOccurrence} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                        <Plus size={16} /> Ocorrencia
                      </button>
                      <button onClick={() => setRateWindow(null)} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-slate-700 text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
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
                    className={`min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 ${intervalRun ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-[#7a32fc] text-white'}`}
                  >
                    <Play size={16} /> Iniciar coleta por intervalo
                  </button>
                  {intervalRun && intervalRun.behaviorId === selectedBehavior.id && (
                    <p className="text-xs font-semibold text-gray-500">
                      Já existe uma coleta por intervalo em andamento para este comportamento.
                    </p>
                  )}
                </div>
              )}

              {behaviorMeasurementType === 'abc' && (
                <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap">
                  <button onClick={handleSelectedBehaviorAction} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                    <FileText size={16} /> Abrir ABC rapido
                  </button>
                </div>
              )}
            </div>
          </div>

          {maintenanceProbeRows.length > 0 && (
            <section className="rounded-[24px] sm:rounded-[28px] border border-amber-100 bg-white p-4 sm:p-5 shadow-xl shadow-amber-900/5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-600">Manutencao ABA</p>
                  <h2 className="text-lg font-bold text-gray-900">Targets em manutencao e risco de regressao</h2>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                  <ShieldAlert size={14} /> Revisao humana obrigatoria
                </span>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
                {maintenanceProbeRows.slice(0, 3).map((row: any) => (
                  <div key={row.id} className="rounded-2xl border border-amber-100 bg-[#FFFDF7] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-900">{row.name}</p>
                        <p className="mt-1 text-xs font-semibold text-gray-500">
                          {row.nextSchedule ? formatMaintenanceDueLabel(row.nextSchedule.scheduled_for || row.nextSchedule.scheduledFor) : 'Sem maintenance probe agendado'}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${String(row.currentStatus || row.lastResult?.status).toUpperCase() === 'REGRESSION_RISK' ? 'bg-red-50 text-red-600' : String(row.currentStatus || row.lastResult?.status).toUpperCase() === 'WATCH' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-600'}`}>
                        {row.status}
                      </span>
                    </div>
                    <p className="mt-3 text-xs font-semibold text-gray-500">
                      {row.totalTrials > 0
                        ? `${row.totalTrials} probe(s) hoje - ${row.accuracyPercent}% acuracia - ${row.independencePercent}% independencia`
                        : row.lastResult
                          ? `Ultimo probe: ${row.lastResult.accuracy_percent ?? row.lastResult.accuracyPercent ?? 0}% acuracia`
                          : 'Aguardando Maintenance Probe'}
                    </p>
                    {row.consecutiveFailureCount >= 2 && (
                      <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                        {row.consecutiveFailureCount} probes consecutivos abaixo do criterio
                      </p>
                    )}
                    {row.activeAlert && (
                      <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">Risco de regressao</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="space-y-5">
            {sessionGoals.map((goal: any) => {
              const goalKey = String(goal?.id || goal?.name || 'goal');
              const masteryRow = teachingMasteryRows.find((row) => String(row.id || row.targetId || row.name) === goalKey || row.name === goal.name);
              const maintenanceInfo = getGoalMaintenanceInfo(goal);
              const promptedRenderPrompt = resolveAbaPromptLevel({ promptLevelKey });
              const independentTrialLockKey = `trial:${goalKey}:independent:independent`;
              const promptedTrialLockKey = `trial:${goalKey}:prompted:${promptedRenderPrompt.key}`;
              const errorTrialLockKey = `trial:${goalKey}:error:error`;
              return (
                <div key={goal.id} className="bg-white rounded-[24px] sm:rounded-[32px] p-4 sm:p-6 shadow-xl shadow-blue-900/5 border border-white relative overflow-hidden">
                  <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <span className="inline-flex bg-[#7a32fc]/10 text-[#7a32fc] text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest mb-3">
                        {goal.domainName || 'Meta'}
                      </span>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-800 tracking-tight">{goal.name}</h2>
                    </div>
                    {patient.age <= 12 && (
                      <div className="text-left sm:text-right">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Criterio de maestria</p>
                        <p className="max-w-[220px] text-xs font-bold text-[#7a32fc] sm:ml-auto">{masteryRow?.criterion || 'Criterio nao configurado'}</p>
                        <p className="mt-1 text-[11px] font-semibold text-gray-500">Hoje: {masteryRow?.independencePercent ?? 0}% independencia</p>
                        <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${masteryRow?.statusCode === 'READY_FOR_REVIEW' ? 'bg-emerald-50 text-emerald-600' : masteryRow?.statusCode === 'MET_TODAY' ? 'bg-blue-50 text-blue-600' : masteryRow?.statusCode === 'INSUFFICIENT_DATA' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                          {masteryRow?.status || 'Dados insuficientes'}
                        </span>
                      </div>
                    )}
                  </div>

                  {maintenanceInfo.isMaintenanceTarget && (
                    <div className="mb-5 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Target em manutencao</p>
                          <p className="text-xs font-semibold text-amber-800">
                            {maintenanceInfo.nextSchedule ? formatMaintenanceDueLabel(maintenanceInfo.nextSchedule.scheduled_for || maintenanceInfo.nextSchedule.scheduledFor) : 'Sem proximo maintenance probe'}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                          Use Maintenance Probe
                        </span>
                      </div>
                      {maintenanceInfo.consecutiveFailures >= 2 && (
                        <p className="mt-2 text-xs font-bold text-red-600">{maintenanceInfo.consecutiveFailures} probes consecutivos abaixo do criterio</p>
                      )}
                      {maintenanceInfo.activeAlert && (
                        <p className="mt-2 text-xs font-bold text-red-600">Risco de regressao</p>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                      onClick={() => handleTrialClick(goal, 1, 'independent')}
                      disabled={Boolean(actionLocks[independentTrialLockKey])}
                      className={`relative bg-[#05CD99] text-white min-h-[88px] sm:min-h-[96px] rounded-3xl flex flex-col items-center justify-center px-4 shadow-lg shadow-green-500/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-90 ${microFeedback[independentTrialLockKey] === 'check' ? 'scale-[0.98] ring-4 ring-emerald-200/70' : ''}`}
                    >
                      {microFeedback[independentTrialLockKey] === 'check' && <span className="absolute right-4 top-4 rounded-full bg-white/25 p-1"><CheckCircle2 size={16} /></span>}
                      <CheckCircle2 size={26} />
                      <span className="text-xl sm:text-2xl font-bold mt-2">Independente</span>
                      <span className={`${mobileFocusMode ? 'hidden sm:block' : 'block'} text-[10px] font-bold uppercase tracking-widest opacity-80`}>1 = correto independente</span>
                    </button>
                    <button
                      onClick={() => handleTrialClick(goal, 0.5, 'prompted', promptLevelKey)}
                      disabled={Boolean(actionLocks[promptedTrialLockKey])}
                      className={`relative bg-[#FFB547] text-white min-h-[88px] sm:min-h-[96px] rounded-3xl flex flex-col items-center justify-center px-4 shadow-lg shadow-orange-500/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-90 ${microFeedback[promptedTrialLockKey] === 'check' ? 'scale-[0.98] ring-4 ring-orange-200/70' : ''}`}
                    >
                      {microFeedback[promptedTrialLockKey] === 'check' && <span className="absolute right-4 top-4 rounded-full bg-white/25 p-1"><CheckCircle2 size={16} /></span>}
                      <Activity size={26} />
                      <span className="text-xl sm:text-2xl font-bold mt-2">Com ajuda</span>
                      <span className={`${mobileFocusMode ? 'hidden sm:block' : 'block'} text-[10px] font-bold uppercase tracking-widest opacity-80`}>0.5 = correto com ajuda</span>
                    </button>
                    <button
                      onClick={() => handleTrialClick(goal, 0, 'error')}
                      disabled={Boolean(actionLocks[errorTrialLockKey])}
                      className={`relative bg-[#EE5D50] text-white min-h-[88px] sm:min-h-[96px] rounded-3xl flex flex-col items-center justify-center px-4 shadow-lg shadow-red-500/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-90 ${microFeedback[errorTrialLockKey] === 'check' ? 'scale-[0.98] ring-4 ring-red-200/70' : ''}`}
                    >
                      {microFeedback[errorTrialLockKey] === 'check' && <span className="absolute right-4 top-4 rounded-full bg-white/25 p-1"><CheckCircle2 size={16} /></span>}
                      <X size={26} />
                      <span className="text-xl sm:text-2xl font-bold mt-2">Erro</span>
                      <span className={`${mobileFocusMode ? 'hidden sm:block' : 'block'} text-[10px] font-bold uppercase tracking-widest opacity-80`}>0 = erro ou sem resposta</span>
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
                      Segure para ver critérios
                    </button>
                    {activeCriteria === goal.id && (
                      <div className="mt-3 mx-auto max-w-xl bg-[#1B254B] text-white p-5 rounded-3xl shadow-2xl animate-pop">
                        <p className="text-sm font-medium leading-relaxed">
                          {sanitizeDescriptionForDisplay(goal.criteria) || 'Critérios não cadastrados para esta meta.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="bg-white border-t xl:border-t-0 xl:border-l border-gray-100 p-3 sm:p-5 xl:overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Histórico da sessão</p>
              <h2 className="text-lg font-bold text-gray-800">{liveSummaryTotals.recordTotal} registro(s)</h2>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tentativas hoje</p>
              <p className="text-3xl font-bold text-[#7a32fc] leading-none">{liveSummaryTotals.trialTotal}</p>
            </div>
          </div>

          <div className="space-y-3">
            {records.length === 0 ? (
              <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-5 text-sm text-gray-500">
                Nenhum registro nesta sessão.
              </div>
            ) : visibleHistoryRecords.map((record) => {
              const lockedIntervalRecord = isIntervalHistoryRecord(record);
              return (
              <div key={record.id} className="rounded-2xl border border-gray-100 bg-[#F8FAFF] p-3 sm:p-4">
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
                          <option value="">Não informado</option>
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
                          <option value="">Não informada</option>
                          {consequenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                    </div>
                    <textarea
                      value={editingRecordNotes}
                      onChange={(event) => setEditingRecordNotes(event.target.value)}
                      placeholder="Observação opcional"
                      className="w-full min-h-[64px] rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs text-gray-600 outline-none resize-none focus:border-[#7a32fc]"
                    />
                    <p className="text-[11px] text-gray-400">Horario original: {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    <div className="grid grid-cols-2 gap-2">
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
                      <p className={`${mobileFocusMode ? 'line-clamp-2' : ''} text-xs text-gray-500 mt-1`}>{record.detail}</p>
                      {(record.location || record.severity || record.antecedent || record.consequence || record.notes) && (
                        <div className="mt-2 space-y-1 text-[11px] text-gray-500">
                          {(record.location || record.severity) && (
                            <p>{record.location || 'Local não informado'} - severidade {record.severity || '-'}</p>
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
                      <button onClick={() => startEditingRecord(record)} className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-white border border-gray-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-[#7a32fc]">
                        <Pencil size={11} /> Editar
                      </button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
            {clinicalHistoryRecords.length > visibleHistoryRecords.length && (
              <button
                onClick={() => setHistoryExpanded(true)}
                className="w-full rounded-2xl border border-blue-100 bg-[#F4F7FE] px-4 py-3 text-xs font-bold uppercase tracking-widest text-[#7a32fc]"
              >
                Ver mais {clinicalHistoryRecords.length - visibleHistoryRecords.length} registro(s)
              </button>
            )}
            {historyExpanded && clinicalHistoryRecords.length > 8 && (
              <button
                onClick={() => setHistoryExpanded(false)}
                className="w-full rounded-2xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-500"
              >
                Recolher histórico
              </button>
            )}
          </div>
        </aside>
      </div>

      {abcModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-[28px] sm:rounded-[32px] p-4 sm:p-6 shadow-2xl max-w-lg w-full max-h-[calc(100vh-2rem)] overflow-y-auto border border-purple-100">
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
                Observação opcional
                <textarea value={abcNote} onChange={(event) => setAbcNote(event.target.value)} maxLength={600} className="mt-1 w-full min-h-[84px] bg-[#F4F7FE] border border-blue-100 rounded-xl px-3 py-3 text-sm text-gray-700 outline-none resize-none" />
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAbcModalOpen(false)} className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-600 font-bold">Cancelar</button>
              <button onClick={saveAbcEvent} disabled={Boolean(actionLocks['abc:save'])} className="flex-1 py-3 rounded-2xl bg-[#7a32fc] text-white font-bold shadow-lg shadow-purple-500/20 transition-all active:scale-95 disabled:opacity-60">Salvar ABC</button>
            </div>
          </div>
        </div>
      )}

      {promptSelectionGoal && (
        <div className="fixed inset-0 z-[142] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-[28px] sm:rounded-[32px] p-4 sm:p-6 shadow-2xl max-w-lg w-full max-h-[calc(100vh-2rem)] overflow-y-auto border border-orange-100">
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
              Voltar para sessão
            </button>
          </div>
        </div>
      )}

      {durationBlockModalOpen && (
        <div className="fixed inset-0 z-[143] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-[28px] sm:rounded-[32px] p-4 sm:p-6 shadow-2xl max-w-2xl w-full max-h-[calc(100vh-2rem)] overflow-y-auto border border-amber-100">
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
              Voltar para sessão
            </button>
          </div>
        </div>
      )}

      {showSessionSummary && (
        <div className="fixed inset-0 z-[145] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-900/30 backdrop-blur-sm">
          <div className="bg-[#F4F7FE] rounded-[28px] sm:rounded-[32px] p-4 sm:p-6 shadow-2xl max-w-6xl w-full max-h-[calc(100vh-2rem)] overflow-y-auto border border-blue-100">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-[10px] font-bold text-[#7a32fc] uppercase tracking-widest">Encerramento da sessão ABA</p>
                <h3 className="text-2xl font-semibold text-gray-900 mt-1">Resumo da sessão</h3>
                <p className="text-sm text-gray-500 mt-1">Revise bloqueios, avisos e dados clínicos antes de confirmar.</p>
              </div>
              <button onClick={() => setShowSessionSummary(false)} className="p-2 rounded-full hover:bg-white text-gray-500">
                <X size={20} />
              </button>
            </div>

            <section className="rounded-[24px] bg-white border border-blue-100 p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h4 className="text-lg font-bold text-gray-900">Resumo geral</h4>
                <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${sessionClosureSummary.syncStatus === 'synced' ? 'bg-emerald-50 text-emerald-600' : sessionClosureSummary.syncStatus === 'error' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                  {sessionClosureSummary.syncStatus === 'synced' ? 'sincronizado' : sessionClosureSummary.syncStatus === 'error' ? 'não sincronizado' : 'pendente de sincronização'}
                </span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
                <div className="rounded-2xl bg-[#F8FAFF] p-4 lg:col-span-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Paciente</p>
                  <p className="text-lg font-bold text-gray-900">{sessionClosureSummary.patientName || patient.name}</p>
                </div>
                <div className="rounded-2xl bg-[#F8FAFF] p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Início</p>
                  <p className="text-lg font-bold text-gray-900">{formatSessionTime(sessionClosureSummary.startedAt)}</p>
                </div>
                <div className="rounded-2xl bg-[#F8FAFF] p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fim previsto</p>
                  <p className="text-lg font-bold text-gray-900">{formatSessionTime(sessionClosureSummary.endedAt)}</p>
                </div>
                <div className="rounded-2xl bg-[#F8FAFF] p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Duração</p>
                  <p className="text-lg font-bold text-gray-900">{formatSessionDuration(sessionClosureSummary.durationSeconds)}</p>
                </div>
                <div className="rounded-2xl bg-[#F8FAFF] p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tentativas</p>
                  <p className="text-2xl font-bold text-gray-900">{sessionClosureSummary.totalTrials}</p>
                </div>
                <div className="rounded-2xl bg-[#F8FAFF] p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Registros comportamentais</p>
                  <p className="text-2xl font-bold text-gray-900">{sessionClosureSummary.totalBehaviorEvents}</p>
                </div>
              </div>
            </section>

            <section className="mt-4 rounded-[24px] bg-white border border-blue-100 p-5">
              <h4 className="text-lg font-bold text-gray-900">Resumo de comportamentos</h4>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {sessionClosureSummary.frequencySummary.map((item) => (
                  <div key={`frequency-${item.behaviorName}`} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                    <p className="font-bold text-gray-900">{item.behaviorName}</p>
                    <p className="text-sm text-gray-500">frequência: {item.occurrences} ocorrência(s)</p>
                  </div>
                ))}
                {sessionClosureSummary.durationSummary.map((item) => (
                  <div key={`duration-${item.behaviorName}`} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                    <p className="font-bold text-gray-900">{item.behaviorName}</p>
                    <p className="text-sm text-gray-500">{item.episodes} episódio(s)</p>
                    <p className="text-sm text-gray-500">duração total: {formatDurationSeconds(item.totalSeconds)}</p>
                    <p className="text-sm text-gray-500">duração média: {formatDurationSeconds(item.averageSeconds)}</p>
                    <p className="text-sm text-gray-500">maior episódio: {formatDurationSeconds(item.maxSeconds)}</p>
                  </div>
                ))}
                {sessionClosureSummary.intervalSummary.map((item) => (
                  <div key={`interval-${item.behaviorName}-${item.method}`} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                    <p className="font-bold text-gray-900">{item.behaviorName}</p>
                    <p className="text-sm text-gray-500">{getMeasurementLabel(item.method)}</p>
                    <p className="text-sm text-gray-500">{item.totalIntervals}/{item.plannedIntervals || item.totalIntervals} intervalo(s) respondido(s)</p>
                    <p className="text-sm text-gray-500">{item.occurredCount} SIM - {item.notOccurredCount} NÃO</p>
                    <p className="text-sm font-bold text-[#7a32fc]">ocorrência: {item.occurrencePercent}%</p>
                    {item.status === 'PARTIALLY_COMPLETED' && <p className="text-sm font-bold text-amber-700">finalizada antecipadamente</p>}
                  </div>
                ))}
                {sessionClosureSummary.totalBehaviorEvents === 0 && <p className="text-sm text-gray-500">Nenhum comportamento registrado nesta sessão.</p>}
              </div>
            </section>

            <section className="mt-4 rounded-[24px] bg-white border border-blue-100 p-5">
              <h4 className="text-lg font-bold text-gray-900">Tentativas de ensino</h4>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-2xl bg-[#F8FAFF] p-3 border border-gray-100"><p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total</p><p className="text-2xl font-bold text-gray-900">{sessionClosureSummary.totalTrials}</p></div>
                <div className="rounded-2xl bg-[#F8FAFF] p-3 border border-gray-100"><p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Independentes</p><p className="text-2xl font-bold text-gray-900">{sessionClosureSummary.independentTrials}</p></div>
                <div className="rounded-2xl bg-[#F8FAFF] p-3 border border-gray-100"><p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Com ajuda</p><p className="text-2xl font-bold text-gray-900">{sessionClosureSummary.promptedTrials}</p></div>
                <div className="rounded-2xl bg-[#F8FAFF] p-3 border border-gray-100"><p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Erros</p><p className="text-2xl font-bold text-gray-900">{sessionClosureSummary.errorTrials}</p></div>
              </div>
              <p className="mt-3 text-sm text-gray-500">Percentual de acerto: <span className="font-bold text-gray-900">{sessionClosureSummary.accuracyPercent}%</span></p>
              <p className="text-sm text-gray-500">Percentual de independência: <span className="font-bold text-gray-900">{sessionClosureSummary.independencePercent}%</span></p>
              <p className="text-sm text-gray-500">Tipos usados: {sessionClosureSummary.trialTypesUsed.join(', ') || 'nenhum'}</p>
            </section>

            <section className="mt-4 rounded-[24px] bg-white border border-blue-100 p-5">
              <h4 className="text-lg font-bold text-gray-900">Critérios de maestria</h4>
              <div className="mt-3 space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {teachingMasteryRows.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhum critério de maestria relacionado à meta atual.</p>
                ) : teachingMasteryRows.map((row) => (
                  <div key={row.id} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-3">
                    <p className="font-bold text-gray-900">{row.name}</p>
                    <p className="text-xs text-gray-500">critério: {row.criterion}</p>
                    <p className="text-xs text-gray-500">desempenho: {row.performanceText}</p>
                    <p className="text-xs text-gray-500">tentativas: {row.totalTrials ?? 0} - acurácia {row.accuracyPercent ?? 0}% - independência {row.independencePercent ?? 0}%</p>
                    <p className="text-xs text-gray-500">dias consecutivos: {row.consecutiveSuccessfulDays ?? 0}</p>
                    <p className="text-xs text-gray-500">contribuiu para o critério: {row.contributes ? 'sim' : 'não'}</p>
                    <p className="text-xs font-bold text-[#7a32fc]">{row.status}</p>
                    {Array.isArray(row.reasons) && row.reasons.length > 0 && (
                      <p className="mt-1 text-xs text-gray-500">{row.reasons.map((reason: any) => reason?.message || reason).filter(Boolean).join(' ')}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-4 rounded-[24px] bg-white border border-amber-100 p-5">
              <h4 className="text-lg font-bold text-amber-700">Manutencao e regressao</h4>
              <div className="mt-3 space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {maintenanceProbeRows.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhum target em manutencao relacionado a esta sessao.</p>
                ) : maintenanceProbeRows.map((row: any) => (
                  <div key={row.id} className="rounded-2xl bg-[#FFFDF7] border border-amber-100 p-3">
                    <p className="font-bold text-gray-900">{row.name}</p>
                    <p className="text-xs text-gray-500">{row.nextSchedule ? formatMaintenanceDueLabel(row.nextSchedule.scheduled_for || row.nextSchedule.scheduledFor) : 'Sem maintenance probe agendado'}</p>
                    <p className="text-xs text-gray-500">status: {row.status}</p>
                    <p className="text-xs text-gray-500">probes hoje: {row.totalTrials ?? 0} - acuracia {row.accuracyPercent ?? 0}% - independencia {row.independencePercent ?? 0}%</p>
                    {row.consecutiveFailureCount >= 2 && <p className="text-xs font-bold text-red-600">{row.consecutiveFailureCount} probes consecutivos abaixo do criterio</p>}
                    {row.activeAlert && <p className="text-xs font-bold text-red-600">Risco de regressao</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-4 rounded-[24px] bg-white border border-red-100 p-5">
              <h4 className="text-lg font-bold text-red-700">Bloqueios de encerramento</h4>
              {hasClosureBlockers && (
                <p className="mt-2 rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-sm font-semibold text-red-700">
                  Resolva os bloqueios antes de encerrar a sessão.
                </p>
              )}
              <div className="mt-3 space-y-2">
                {closureBlockers.length === 0 ? (
                  <p className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-700">Nenhum bloqueio. O encerramento está liberado.</p>
                ) : closureBlockers.map((item) => (
                  <div key={item.key} className="rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-sm font-semibold text-red-700">
                    {item.label}
                  </div>
                ))}
              </div>
              {openDurations.length > 0 && (
                <div className="mt-4 space-y-3">
                  {openDurations.map((event) => (
                    <div key={event.id} className="rounded-2xl bg-white border border-red-100 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-bold text-gray-900">{event.behaviorName}</p>
                          <p className="text-xs text-gray-500 mt-1">{event.location || 'Sem local'} - severidade {event.severity || '-'}</p>
                          <p className="text-xs text-gray-500 mt-1">Início {formatSessionTime(event.startedAt)} - duração atual {formatElapsed(event.startedAt, nowMs)}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => resolveDurationBeforeEnd(event.id, 'end')} className="rounded-xl bg-[#1B254B] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white">Encerrar agora</button>
                          <button onClick={() => resolveDurationBeforeEnd(event.id, 'discard')} className="rounded-xl bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-600 border border-red-100">Descartar evento</button>
                          <button onClick={() => setShowSessionSummary(false)} className="rounded-xl bg-gray-100 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">Voltar para sessão</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {intervalRun && (
                <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4">
                  <p className="font-bold text-red-700">Há uma coleta por intervalo em andamento</p>
                  <p className="mt-1 text-sm text-red-700">{intervalRun.behaviorName} - {getMeasurementLabel(intervalRun.measurementType)} - intervalo {intervalRun.intervalIndex}/{intervalRun.totalIntervals}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {intervalRunPaused && <button onClick={resumeIntervalRun} className="rounded-xl bg-[#1B254B] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white">Retomar coleta</button>}
                    <button onClick={finishIntervalRunNow} className="rounded-xl bg-emerald-500 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white">Finalizar coleta agora</button>
                    <button onClick={requestCancelIntervalRun} className="rounded-xl bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-600 border border-red-100">Cancelar coleta</button>
                    <button onClick={() => setShowSessionSummary(false)} className="rounded-xl bg-gray-100 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">Voltar para sessão</button>
                  </div>
                </div>
              )}
            </section>

            <section className="mt-4 rounded-[24px] bg-white border border-amber-100 p-5">
              <h4 className="text-lg font-bold text-amber-700">Avisos de encerramento</h4>
              {hasClosureWarnings && !hasClosureBlockers && (
                <p className="mt-2 rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm font-semibold text-amber-800">
                  Esta sessão possui avisos, mas pode ser encerrada. Os avisos ficarão registrados no resumo.
                </p>
              )}
              <div className="mt-3 space-y-2">
                {closureWarnings.length === 0 ? (
                  <p className="rounded-2xl bg-[#F8FAFF] border border-blue-100 px-4 py-3 text-sm font-semibold text-gray-600">Sem avisos adicionais.</p>
                ) : closureWarnings.map((item) => (
                  <div key={item.key} className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm font-semibold text-amber-800">
                    {item.label}
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-4 rounded-[24px] bg-white border border-blue-100 p-5">
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                Observação da sessão
                <textarea
                  value={sessionNote}
                  onChange={(event) => setSessionNote(event.target.value)}
                  placeholder="Resumo clínico da sessão, intercorrências, resposta do paciente e orientações relevantes..."
                  className="mt-2 w-full min-h-[104px] rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3 text-sm text-gray-700 outline-none resize-none focus:border-[#7a32fc]"
                />
              </label>
            </section>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button onClick={() => setShowSessionSummary(false)} className="flex-1 py-3 rounded-2xl bg-white border border-blue-100 text-gray-600 font-semibold">Voltar para sessão</button>
              <button
                onClick={confirmEndSession}
                disabled={hasClosureBlockers}
                className={`flex-1 py-3 rounded-2xl font-semibold shadow-lg transition-all ${hasClosureBlockers ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' : 'bg-[#7a32fc] text-white shadow-purple-500/20 hover:bg-[#6425df]'}`}
              >
                Confirmar encerramento da sessão
              </button>
            </div>
          </div>
        </div>
      )}
      {clinicalDock}
      {clinicalDockSheet}
      {actionToastPortal}
    </div>
  );

  if (typeof document === 'undefined') return sessionModeContent;
  return createPortal(sessionModeContent, document.body);
};
