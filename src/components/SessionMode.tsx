import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock,
  FileText,
  Flame,
  History as HistoryIcon,
  Loader2,
  MapPin,
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
import { getRecordById, getSessionQueuedRecords, syncOfflineData } from '../services/localDb';
import { AUTOMATIC_SESSION_CLOSURE_KEYS, partitionSessionQueueForClosure, therapeuticTimerCompletion, waitForSessionWrites } from '../utils/sessionAutoFinalization';
import { AbaReinforcerSessionPanel } from './AbaReinforcerSessionPanel';
import { flushReinforcerDeliveries } from '../services/abaReinforcers';
import {
  normalizeAbaPromptTypeConfig,
  resolveTrialPromptInfo,
  type AbaPromptTypeConfig
} from '../utils/abaPromptLevels';
import { buildSessionReport, calculateSessionSummary, canCloseAbaSession, canRecordInAbaSession, type SessionSummary, type SessionSummaryPendingItem } from '../utils/abaSessionSummary';
import { isAbaV2Enabled, isAbaV3UiEnabled } from '../utils/featureFlags';
import {
  mergeLegacyAndTherapeuticSessionGoals,
  normalizeTherapeuticPrograms,
  therapeuticProgramsToSessionGoals,
  isTherapeuticMasteryCriteriaCompatible,
} from '../utils/therapeuticPlan';
import { buildClinicalActionToast, buildClinicalOfflineToast, buildClinicalSaveErrorToast, type ClinicalActionToast } from '../utils/abaSessionFeedback';
import { getCrisisShortcutIds, getDockVisibleShortcuts, normalizeQuickBehaviorShortcuts } from '../utils/abaClinicalDock';
import {
  behaviorAllowsMeasurement,
  buildBehaviorEventContextSnapshot,
  formatBehaviorHistoryDetail,
  getBehaviorAllowedMeasurements,
  getBehaviorDefaultMeasurement,
  isIntervalMeasurementType,
  readBehaviorEventContextSnapshot,
  resolveBehaviorMeasurementForAction,
  type BehaviorEventContextSnapshot
} from '../utils/abaBehaviorCapture';
import { formatPatientLabel, formatTherapistLabel, safeDisplayValue } from '../utils/displayLabels';
import {
  formatAbaTrialHistoryLabel,
  getAbaCollectionLabel,
  isDuplicateRiskTrainingCollection,
  isMaintenanceProbeCollection,
  normalizeAbaCollectionType
} from '../utils/abaTrialLabels';
import {
  getActiveMaintenanceProbeForTarget as resolveActiveMaintenanceProbeForTarget,
  getMaintenanceTargetKey,
  normalizeRegularAbaTrialType,
  resolveContextualTrialTypeForTarget,
  type ActiveMaintenanceProbeForTarget,
  type ManualMaintenanceProbeActivation
} from '../utils/abaMaintenanceProbeContext';
import {
  buildIntervalAggregateSummary,
  buildIntervalCancelAudit,
  getIntervalRunStatus,
  pauseIntervalRunState,
  resumeIntervalRunState,
  type AbaIntervalCollectionStatus
} from '../utils/abaIntervalLifecycle';
import {
  abaMasteryCriterionSourceLabel,
  evaluateMaintenanceStatus,
  evaluateTargetMastery,
  formatAbaMasteryCriterion,
  normalizeAbaMasteryCriterion
} from '../utils/abaMasteryEngine';
import { formatMaintenanceScheduleDueLabel, resolveMaintenanceProbeAvailability } from '../utils/abaMaintenanceScheduling';
import { mapMaintenancePanelResponse, resolveMaintenanceTargetDisplay } from '../utils/peiMaintenancePanel';
import { isPeiClinicalRowAfterProgressReset } from '../utils/peiSessionReset';
import { abaV3ActionDisplayLabel, normalizeAbaV3TrialActionKey, type AbaV3TrialActionKey } from '../utils/abaV3Collection';
import {
  abaRecommendationPriorityLabel,
  abaRecommendationStatusLabel,
  abaRecommendationTypeLabel,
  deduplicateAbaRecommendationsForDecisionQueue,
  formatAbaRecommendationTitle,
  translateAbaRecommendationText
} from '../utils/abaPlanningEngine';

// Keep the completion snapshot current across awaited writes, before React renders.
function useLiveSessionState<T>(initial: T): [T, React.Dispatch<React.SetStateAction<T>>, React.MutableRefObject<T>] {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const update = useCallback((next: React.SetStateAction<T>) => {
    ref.current = typeof next === 'function' ? (next as (previous: T) => T)(ref.current) : next;
    setValue(ref.current);
  }, []);
  return [value, update, ref];
}

type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';
type AbcRequirement = 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL' | 'DISABLED';

type SessionAttendanceStatus =
  | 'ATTENDED'
  | 'LATE'
  | 'PARTIAL'
  | 'NO_SHOW'
  | 'CANCELLED_PATIENT'
  | 'CANCELLED_CLINIC';

const SESSION_ATTENDANCE_OPTIONS: Array<{
  value: SessionAttendanceStatus;
  label: string;
  description: string;
}> = [
  { value: 'ATTENDED', label: 'Compareceu', description: 'Atendimento realizado conforme previsto.' },
  { value: 'LATE', label: 'Compareceu com atraso', description: 'Atendimento realizado após o horário agendado.' },
  { value: 'PARTIAL', label: 'Atendimento parcial', description: 'Atendimento iniciado, mas concluído antes do previsto.' },
  { value: 'NO_SHOW', label: 'Falta', description: 'Paciente não compareceu. Não segue para faturamento de convênio.' },
  { value: 'CANCELLED_PATIENT', label: 'Cancelado pelo paciente', description: 'Cancelamento atribuído ao paciente ou responsável.' },
  { value: 'CANCELLED_CLINIC', label: 'Cancelado pela clínica', description: 'Cancelamento atribuído à clínica ou ao profissional.' }
];

const NON_ATTENDANCE_STATUSES = new Set<SessionAttendanceStatus>([
  'NO_SHOW',
  'CANCELLED_PATIENT',
  'CANCELLED_CLINIC'
]);

const createSessionCompletionKey = () => (
  globalThis.crypto?.randomUUID?.()
  || `session-complete-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`
);

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
  latencyMs?: number | null;
  countDelta?: number | null;
  therapeuticMeasurement?: boolean;
  measuredValue?: number | null;
  measurementUnit?: string | null;
  trialOutcome?: 'independent' | 'prompted' | 'error';
  measurementModelVersion?: 'LEGACY_V2' | 'V3' | 'EMERGENCY_LEGACY_BRIDGE' | string;
  v3ActionKey?: AbaV3TrialActionKey;
  v3TrialId?: string | null;
  syncErrorCode?: string | null;
  syncErrorMessage?: string | null;
  collectionType?: string;
  promptTypeId?: string | null;
  promptTypeNameSnapshot?: string | null;
  promptCategorySnapshot?: string | null;
  promptIndependenceScoreSnapshot?: number | null;
  promptIntrusivenessOrderSnapshot?: number | null;
  promptLevelKey?: string;
  promptLevelName?: string;
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
  contextSnapshot?: BehaviorEventContextSnapshot | null;
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
  behaviorId?: string | null;
  startedAt: string;
  location?: string;
  severity?: number | null;
  measurementModelVersion?: string;
  v3EpisodeEventId?: string | null;
};


type TherapeuticTimerState = {
  goalKey: string;
  targetId: string;
  targetName: string;
  programId?: string | null;
  measurementType: 'duration' | 'latency';
  startedAt: string;
  runningSince: string | null;
  accumulatedMs: number;
  recordId?: string;
  completedAt?: string;
  goalSnapshot?: any;
};

type AbaV3BehaviorDecision = {
  measurementModelVersion: string;
  behaviorId: string;
  targetId?: string | null;
  bindingReason?: string | null;
};

type AbaV3TaskAnalysisStep = {
  id: string;
  sequence_no: number;
  step_key: string;
  label: string;
  description?: string | null;
  is_required?: boolean;
};

type AbaV3TaskAnalysisModalState = {
  goal: any;
  targetId: string;
  steps: AbaV3TaskAnalysisStep[];
  startedAt: string;
};

type PendingMaintenanceProbeTrial = {
  goal: any;
  score: number;
  outcome: 'independent' | 'prompted' | 'error';
  selectedPrompt: any;
  previousRecordId: string;
  measurementModelVersion?: string;
  v3ActionKey?: AbaV3TrialActionKey;
  activeMaintenanceProbe?: ActiveMaintenanceProbeForTarget | null;
};

type AbaV3BindingDecision = {
  bindingId: string;
  measurementModelVersion: string;
  collectionDefinitionVersionId?: string | null;
  targetPhaseAssignmentId?: string | null;
  bindingReason?: string | null;
  boundAt?: string | null;
};

type AbaV3ErrorSelection = {
  goal: any;
  selectedPrompt: any;
  activeCollectionType: string;
  activeMaintenanceProbe?: ActiveMaintenanceProbeForTarget | null;
  binding: AbaV3BindingDecision;
};

type AbaV3SessionPlanTarget = {
  target_id: string;
  program_id?: string | null;
  target_type?: string | null;
  measurement_model_version: string;
  binding_source?: 'BOUND' | 'PREVIEW' | string;
  reason?: string | null;
};

type AbaV3SessionCollectionPlan = {
  session_id?: string;
  complete?: boolean;
  targets: AbaV3SessionPlanTarget[];
  v3_behavior_ids: string[];
};

type TrialAuditEvent = {
  id: string;
  action: 'convert_trial_collection_type';
  recordId: string;
  targetId?: string | null;
  targetName?: string | null;
  fromCollectionType?: string | null;
  toCollectionType: string;
  sessionId: string;
  occurredAt: string;
};

const collectionOptions = [
  { key: 'dtt', label: 'DTT' },
  { key: 'net', label: 'NET' },
  { key: 'cold_probe', label: 'Sonda' },
  { key: 'baseline_probe', label: 'Baseline' }
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
  { id: 'crying', name: 'Choro', defaultMeasurement: 'duration', allowedMeasurements: ['duration'], abcRequirement: 'OPTIONAL' as AbcRequirement, tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  { id: 'escape', name: 'Fuga da atividade', defaultMeasurement: 'duration', allowedMeasurements: ['duration'], abcRequirement: 'OPTIONAL' as AbcRequirement, tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'aggression', name: 'Agressão', defaultMeasurement: 'frequency', allowedMeasurements: ['frequency'], abcRequirement: 'OPTIONAL' as AbcRequirement, tone: 'bg-red-50 text-red-700 border-red-100' },
  { id: 'self_injury', name: 'Autoagressão', defaultMeasurement: 'frequency', allowedMeasurements: ['frequency'], abcRequirement: 'OPTIONAL' as AbcRequirement, tone: 'bg-rose-50 text-rose-700 border-rose-100' },
  { id: 'refusal', name: 'Recusa', defaultMeasurement: 'frequency', allowedMeasurements: ['frequency'], abcRequirement: 'OPTIONAL' as AbcRequirement, tone: 'bg-violet-50 text-violet-700 border-violet-100' },
  { id: 'stereotypy', name: 'Estereotipia', defaultMeasurement: 'partial_interval', allowedMeasurements: ['partial_interval', 'whole_interval', 'momentary_time_sampling', 'duration'], abcRequirement: 'OPTIONAL' as AbcRequirement, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' }
];

const abaV3PlanTargetId = (goal: any) => String(
  goal?.target_id || goal?.targetId || goal?.aba_target_id || goal?.abaTargetId || goal?.id || ''
).trim();

const compactBehaviorLabel = (value: unknown) => {
  const label = String(value || '').trim();
  const compactLabels: Record<string, string> = {
    'Fuga da atividade': 'Fuga',
    Autoagressão: 'Autoag.',
    Agressão: 'Agressão',
    Estereotipia: 'Estereotipia'
  };
  return compactLabels[label] || label;
};

const antecedentOptions = ['Demanda apresentada', 'Transição', 'Espera', 'Negação de acesso', 'Barulho', 'Atenção dividida'];
const consequenceOptions = ['Redirecionamento', 'Pausa breve', 'Reforço diferencial', 'Ajuda física', 'Bloqueio seguro', 'Acesso removido'];
const locationOptions = ['Mesa', 'Sala de terapia', 'Brinquedoteca', 'Corredor', 'Banheiro', 'Recepção'];
const severityOptions = [1, 2, 3, 4, 5];
const intervalDurationOptions = [
  { key: '10', label: '10s', seconds: 10 },
  { key: '20', label: '20s', seconds: 20 },
  { key: '30', label: '30s', seconds: 30 },
  { key: '45', label: '45s', seconds: 45 },
  { key: '60', label: '60s', seconds: 60 },
  { key: '120', label: '2min', seconds: 120 },
  { key: 'custom', label: 'Customizado', seconds: null }
];
const quickIntervalDurationKeys = new Set(['10', '20', '30', '45', '60']);
const quickIntervalDurationOptions = intervalDurationOptions.filter((option) => quickIntervalDurationKeys.has(option.key));
const extraIntervalDurationOptions = intervalDurationOptions.filter((option) => !quickIntervalDurationKeys.has(option.key) && option.key !== 'custom');
const normalizeDockLocationLabel = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
const mergeDockLocationOptions = (customOptions: string[]) => Array.from(new Set([
  ...locationOptions,
  ...customOptions.map(normalizeDockLocationLabel).filter(Boolean)
]));
const intervalAlertOptions = [
  { key: 'vibration', label: 'Vibração' },
  { key: 'sound', label: 'Som' },
  { key: 'both', label: 'Ambos' },
  { key: 'silent', label: 'Silencioso' }
];
const intervalQuantityMin = 1;
const intervalQuantityMax = 200;
const transientCollectionSummaryMs = 5000;
const normalizeIntervalQuantityInput = (value: unknown) => {
  const raw = String(value ?? '').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!raw || !Number.isFinite(parsed)) return intervalQuantityMin;
  return Math.min(intervalQuantityMax, Math.max(intervalQuantityMin, parsed));
};
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

const therapeuticMeasurementTypes = new Set([
  'independent_prompted_no_response',
  'correct_incorrect',
  'frequency',
  'duration',
  'latency',
  'task_analysis',
  'percentage'
]);

const normalizeTherapeuticMeasurementType = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  return therapeuticMeasurementTypes.has(normalized) ? normalized : 'independent_prompted_no_response';
};

const therapeuticMeasurementTypeFromGoal = (goal: any) => normalizeTherapeuticMeasurementType(
  goal?.measurementType || goal?.measurement_type || goal?.collectionMeasurementType || goal?.collection_measurement_type
);

const isTherapeuticMeasurementPayload = (raw: any) => raw?.therapeuticMeasurement === true || raw?.therapeutic_measurement === true || String(raw?.source || '').trim() === 'therapeutic_program_measurement';

const formatTherapeuticMeasurementValue = (measurementType: unknown, value: unknown) => {
  const normalized = normalizeTherapeuticMeasurementType(measurementType);
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 'Medida registrada';
  if (normalized === 'duration' || normalized === 'latency') return formatDurationSeconds(numericValue);
  if (normalized === 'percentage' || normalized === 'task_analysis') return `${Math.round(numericValue * 100) / 100}%`;
  if (normalized === 'frequency') return `+${Math.round(numericValue * 100) / 100}`;
  if (normalized === 'correct_incorrect') return numericValue > 0 ? 'Acerto' : 'Erro';
  return `${Math.round(numericValue * 100) / 100}`;
};

const formatTherapeuticMeasurementDetail = (measurementType: unknown, value: unknown, raw?: any) => {
  const normalized = normalizeTherapeuticMeasurementType(measurementType);
  const explicit = String(raw?.displayLabel || raw?.display_label || '').trim();
  if (explicit) return explicit;
  const labels: Record<string, string> = {
    duration: 'Duração',
    latency: 'Tempo de resposta',
    frequency: 'Frequência',
    correct_incorrect: 'Resposta',
    task_analysis: 'Etapas',
    percentage: 'Percentual'
  };
  return `${labels[normalized] || 'Medida'} · ${formatTherapeuticMeasurementValue(normalized, value)}`;
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

const defaultPromptedPromptOptions = normalizeAbaPromptTypeConfig()
  .filter((prompt) => prompt.active && prompt.showInSession && !prompt.countsAsIndependent)
  .map((prompt) => ({
    ...prompt,
    compactLabel: prompt.key === 'partial_physical'

    ? 'Física parcial'
    : prompt.key === 'full_physical'
      ? 'Física total'
      : prompt.label
}));
const buildSessionPromptSnapshot = (prompt: any) => {
  const rawScore = prompt?.promptIndependenceScoreSnapshot ?? prompt?.independenceScore;
  const score = Number(rawScore);
  const rawOrder = prompt?.promptIntrusivenessOrderSnapshot ?? prompt?.intrusivenessOrder;
  const order = Number(rawOrder);
  const name = String(prompt?.promptTypeNameSnapshot || prompt?.label || prompt?.name || prompt?.key || '').trim();
  return {
    promptTypeId: prompt?.promptTypeId || prompt?.id || null,
    prompt_type_id: prompt?.promptTypeId || prompt?.id || null,
    promptTypeNameSnapshot: name || null,
    prompt_type_name_snapshot: name || null,
    promptCategorySnapshot: prompt?.promptCategorySnapshot || prompt?.category || null,
    prompt_category_snapshot: prompt?.promptCategorySnapshot || prompt?.category || null,
    promptIndependenceScoreSnapshot: Number.isFinite(score) ? score : null,
    prompt_independence_score_snapshot: Number.isFinite(score) ? score : null,
    promptIntrusivenessOrderSnapshot: Number.isFinite(order) ? order : null,
    prompt_intrusiveness_order_snapshot: Number.isFinite(order) ? order : null
  };
};
const REAL_CLINICAL_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRealClinicalId = (value: unknown) => REAL_CLINICAL_ID_REGEX.test(String(value || '').trim());

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
    const measurementModelVersion = String(event.measurement_model_version || event.measurementModelVersion || '').trim().toUpperCase();
    const collectionType = event.collection_type || event.collectionType || event.trial_type || event.trialType || 'dtt';
    if (measurementModelVersion === 'V3' || tableName === 'aba_trials_v3') {
      const clientMetadata = event.client_metadata && typeof event.client_metadata === 'object' && !Array.isArray(event.client_metadata)
        ? event.client_metadata
        : {};
      const steps = Array.isArray(event.steps) ? event.steps : [];
      const primaryStep = steps.find((step: any) => String(step?.opportunity_role || '').toUpperCase() === 'PRIMARY_INDEPENDENT');
      const supportStep = steps.find((step: any) => String(step?.opportunity_role || '').toUpperCase() === 'SUPPORT');
      const inferredActionKey = supportStep?.prompt_key && String(supportStep?.outcome || '').toUpperCase() === 'CORRECT'
        ? 'PROMPTED_CORRECT'
        : String(primaryStep?.outcome || '').toUpperCase() === 'CORRECT'
          ? 'INDEPENDENT_CORRECT'
          : String(primaryStep?.outcome || '').toUpperCase() === 'NO_RESPONSE'
            ? 'NO_RESPONSE'
            : 'INDEPENDENT_INCORRECT';
      const v3ActionKey = (normalizeAbaV3TrialActionKey(clientMetadata.ui_action || clientMetadata.action_key || inferredActionKey) || inferredActionKey) as AbaV3TrialActionKey;
      const promptKey = String(clientMetadata.prompt_key || supportStep?.prompt_key || '').trim();
      const promptName = String(clientMetadata.prompt_name || promptKey || '').trim();
      const lastRevisionReason = String(event.last_revision_reason || event.lastRevisionReason || '').trim();
      const lastRevisionEventType = String(event.last_revision_event_type || event.lastRevisionEventType || '').trim().toUpperCase();
      const lastRevisionAt = String(event.last_revision_at || event.lastRevisionAt || '').trim();
      const isIndependentCorrect = v3ActionKey === 'INDEPENDENT_CORRECT';
      const isPromptedCorrect = v3ActionKey === 'PROMPTED_CORRECT';
      const outcome: SessionRecord['trialOutcome'] = isIndependentCorrect ? 'independent' : isPromptedCorrect ? 'prompted' : 'error';
      const normalizedCollectionType = normalizeAbaCollectionType(collectionType);
      return {
        id: String(event.id),
        kind: 'trial',
        title: String(event.target_name || event.targetName || 'Tentativa'),
        detail: `${getAbaCollectionLabel(normalizedCollectionType)} · ${abaV3ActionDisplayLabel(v3ActionKey)}${promptName ? ` · ${promptName}` : ''}`,
        timestamp: String(event.occurred_at || event.occurredAt || event.created_at || event.createdAt || new Date().toISOString()),
        syncStatus: normalizeSyncStatus(event.sync_status || event.syncStatus || 'synced'),
        targetId: event.target_id || event.targetId || null,
        targetName: event.target_name || event.targetName || null,
        programId: event.program_id || event.programId || null,
        therapistId: event.therapist_id || event.therapistId || null,
        trialOutcome: outcome,
        measurementModelVersion: 'V3',
        v3ActionKey,
        v3TrialId: event.trial_id || event.trialId || event.id || null,
        collectionType: normalizedCollectionType,
        promptTypeId: clientMetadata.prompt_type_id || null,
        promptTypeNameSnapshot: promptName || null,
        promptCategorySnapshot: clientMetadata.prompt_category || null,
        promptIntrusivenessOrderSnapshot: clientMetadata.prompt_intrusiveness_order ?? null,
        promptLevelKey: isPromptedCorrect ? promptKey : isIndependentCorrect ? 'independent' : 'error',
        promptLevelName: isPromptedCorrect ? promptName : abaV3ActionDisplayLabel(v3ActionKey),
        score: null,
        correct: isIndependentCorrect || isPromptedCorrect,
        independent: isIndependentCorrect,
        rawPayload: {
          ...clientMetadata,
          measurementModelVersion: 'V3',
          v3ActionKey,
          clientEventId: event.client_event_id || event.clientEventId || null,
          serverTrialId: event.trial_id || event.trialId || event.id || null,
          lastRevisionReason: lastRevisionReason || null,
          lastRevisionEventType: lastRevisionEventType || null,
          lastRevisionAt: lastRevisionAt || null,
          steps
        }
      };
    }

    const correct = Boolean(event.correct ?? event.isCorrect);
    const independent = Boolean(event.independent ?? event.isIndependent);
    const outcome: SessionRecord['trialOutcome'] = !correct ? 'error' : independent ? 'independent' : 'prompted';
    const score = event.response_score ?? event.responseScore ?? event.score ?? null;
    const promptLevelKey = event.prompt_level_key || event.promptLevelKey;
    const promptLevelName = event.prompt_level_name || event.promptLevelName;
    const rawPayload = event.raw_payload || event.rawPayload || {};
    if (isTherapeuticMeasurementPayload(rawPayload)) {
      const therapeuticMeasurementType = normalizeTherapeuticMeasurementType(rawPayload.measurementType || rawPayload.measurement_type);
      const rawMeasurementValue = rawPayload.measurementValue ?? rawPayload.measurement_value
        ?? (therapeuticMeasurementType === 'latency' ? Number(event.latency_ms ?? event.latencyMs ?? 0) / 1000 : null);
      const measuredValue = Number(rawMeasurementValue);
      const safeMeasuredValue = Number.isFinite(measuredValue) ? measuredValue : null;
      return {
        id: String(event.id),
        kind: 'trial',
        title: String(event.target_name || event.targetName || 'Medida terapêutica'),
        detail: formatTherapeuticMeasurementDetail(therapeuticMeasurementType, safeMeasuredValue, rawPayload),
        timestamp: String(event.occurred_at || event.occurredAt || event.created_at || event.createdAt || new Date().toISOString()),
        syncStatus: normalizeSyncStatus(event.sync_status || event.syncStatus || 'synced'),
        targetId: event.target_id || event.targetId || null,
        targetName: event.target_name || event.targetName || null,
        programId: event.program_id || event.programId || null,
        therapistId: event.therapist_id || event.therapistId || null,
        measurementType: therapeuticMeasurementType,
        therapeuticMeasurement: true,
        measuredValue: safeMeasuredValue,
        measurementUnit: rawPayload.measurementUnit || rawPayload.measurement_unit || null,
        durationSeconds: therapeuticMeasurementType === 'duration' ? safeMeasuredValue : null,
        latencyMs: therapeuticMeasurementType === 'latency' ? (event.latency_ms ?? event.latencyMs ?? (safeMeasuredValue !== null ? Math.round(safeMeasuredValue * 1000) : null)) : null,
        collectionType: normalizeAbaCollectionType(collectionType),
        score,
        correct,
        independent: false,
        rawPayload
      };
    }
    return {
      id: String(event.id),
      kind: 'trial',
      title: String(event.target_name || event.targetName || 'Tentativa'),
      detail: formatAbaTrialHistoryLabel({ collectionType, outcome, score, promptLevelKey, promptLevelName }),
      timestamp: String(event.occurred_at || event.occurredAt || event.created_at || event.createdAt || new Date().toISOString()),
      syncStatus: normalizeSyncStatus(event.sync_status || event.syncStatus || 'synced'),
      targetId: event.target_id || event.targetId || null,
      targetName: event.target_name || event.targetName || null,
      programId: event.program_id || event.programId || null,
      therapistId: event.therapist_id || event.therapistId || null,
      trialOutcome: outcome,
      collectionType,
      promptTypeId: event.prompt_type_id || event.promptTypeId || rawPayload.promptTypeId || rawPayload.prompt_type_id || null,
      promptTypeNameSnapshot: event.prompt_type_name_snapshot || event.promptTypeNameSnapshot || rawPayload.promptTypeNameSnapshot || rawPayload.prompt_type_name_snapshot || null,
      promptCategorySnapshot: event.prompt_category_snapshot || event.promptCategorySnapshot || rawPayload.promptCategorySnapshot || rawPayload.prompt_category_snapshot || null,
      promptIndependenceScoreSnapshot: event.prompt_independence_score_snapshot ?? event.promptIndependenceScoreSnapshot ?? rawPayload.promptIndependenceScoreSnapshot ?? rawPayload.prompt_independence_score_snapshot ?? null,
      promptIntrusivenessOrderSnapshot: event.prompt_intrusiveness_order_snapshot ?? event.promptIntrusivenessOrderSnapshot ?? rawPayload.promptIntrusivenessOrderSnapshot ?? rawPayload.prompt_intrusiveness_order_snapshot ?? null,
      promptLevelKey,
      promptLevelName,
      score,
      correct,
      independent,
      rawPayload
    };
  }

  const measurementType = String(event.measurement_type || event.measurementType || 'frequency');
  const durationSeconds = event.duration_seconds ?? event.durationSeconds ?? null;
  const countDelta = event.count_delta ?? event.countDelta ?? null;
  const contextSnapshot = readBehaviorEventContextSnapshot(event);
  const detail = formatBehaviorHistoryDetail({
    measurementType,
    durationSeconds,
    countDelta,
    location: contextSnapshot?.location ?? event.location,
    severity: contextSnapshot?.severity ?? event.severity,
    status: event.status
  });

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
    contextSnapshot,
    rawPayload: event.raw_payload || event.rawPayload || null,
    location: contextSnapshot?.location ?? event.location,
    severity: contextSnapshot?.severity ?? event.severity ?? null,
    antecedent: contextSnapshot?.abc?.antecedent || event.antecedent,
    consequence: contextSnapshot?.abc?.consequence || event.consequence,
    notes: event.notes
  };
};

const normalizePersistedSessionRecord = (record: any): SessionRecord => {
  const normalizedRecord: SessionRecord = {
    ...record,
    syncStatus: normalizeSyncStatus(record?.syncStatus || record?.sync_status)
  };
  if (normalizedRecord.kind === 'trial') {
    const collectionType = normalizeAbaCollectionType(normalizedRecord.collectionType || record?.collection_type || record?.trialType || 'dtt');
    const promptLevelKey = normalizedRecord.promptLevelKey || record?.prompt_level_key || record?.promptLevel;
    const promptLevelName = normalizedRecord.promptLevelName || record?.prompt_level_name;
    const rawPayload = normalizedRecord.rawPayload || record?.raw_payload || record?.rawPayload || {};
    if (isTherapeuticMeasurementPayload(rawPayload)) {
      const therapeuticMeasurementType = normalizeTherapeuticMeasurementType(rawPayload.measurementType || rawPayload.measurement_type || normalizedRecord.measurementType);
      const rawMeasurementValue = rawPayload.measurementValue ?? rawPayload.measurement_value ?? normalizedRecord.measuredValue
        ?? (therapeuticMeasurementType === 'latency' ? Number(record?.latency_ms ?? normalizedRecord.latencyMs ?? 0) / 1000 : null);
      const measuredValue = Number(rawMeasurementValue);
      const safeMeasuredValue = Number.isFinite(measuredValue) ? measuredValue : null;
      return {
        ...normalizedRecord,
        collectionType,
        measurementType: therapeuticMeasurementType,
        therapeuticMeasurement: true,
        measuredValue: safeMeasuredValue,
        measurementUnit: rawPayload.measurementUnit || rawPayload.measurement_unit || normalizedRecord.measurementUnit || null,
        durationSeconds: therapeuticMeasurementType === 'duration' ? safeMeasuredValue : normalizedRecord.durationSeconds,
        latencyMs: therapeuticMeasurementType === 'latency' ? (record?.latency_ms ?? normalizedRecord.latencyMs ?? (safeMeasuredValue !== null ? Math.round(safeMeasuredValue * 1000) : null)) : normalizedRecord.latencyMs,
        rawPayload,
        independent: false,
        detail: formatTherapeuticMeasurementDetail(therapeuticMeasurementType, safeMeasuredValue, rawPayload)
      };
    }
    const score = normalizedRecord.score ?? record?.response_score ?? 0;
    const scoreNumber = Number(score);
    const isCorrect = typeof normalizedRecord.correct === 'boolean' ? normalizedRecord.correct : Number.isFinite(scoreNumber) && scoreNumber > 0;
    const isIndependent = typeof normalizedRecord.independent === 'boolean' ? normalizedRecord.independent : Number.isFinite(scoreNumber) && scoreNumber >= 1;
    const outcome = normalizedRecord.trialOutcome || (!isCorrect ? 'error' : isIndependent ? 'independent' : 'prompted');
    const measurementModelVersion = String(normalizedRecord.measurementModelVersion || rawPayload.measurementModelVersion || '').trim().toUpperCase();
    const promptTypeNameSnapshot = normalizedRecord.promptTypeNameSnapshot || record?.prompt_type_name_snapshot || record?.promptTypeNameSnapshot || rawPayload.promptTypeNameSnapshot || rawPayload.prompt_type_name_snapshot || null;
    if (measurementModelVersion === 'V3') {
      const v3ActionKey = normalizeAbaV3TrialActionKey(normalizedRecord.v3ActionKey || rawPayload.v3ActionKey)
        || (outcome === 'independent' ? 'INDEPENDENT_CORRECT' : outcome === 'prompted' ? 'PROMPTED_CORRECT' : 'INDEPENDENT_INCORRECT');
      const promptLabel = v3ActionKey === 'PROMPTED_CORRECT'
        ? String(promptTypeNameSnapshot || promptLevelName || '').trim()
        : '';
      return {
        ...normalizedRecord,
        collectionType,
        measurementModelVersion: 'V3',
        v3ActionKey,
        promptTypeId: normalizedRecord.promptTypeId || record?.prompt_type_id || record?.promptTypeId || rawPayload.promptTypeId || rawPayload.prompt_type_id || null,
        promptTypeNameSnapshot,
        promptCategorySnapshot: normalizedRecord.promptCategorySnapshot || record?.prompt_category_snapshot || record?.promptCategorySnapshot || rawPayload.promptCategorySnapshot || rawPayload.prompt_category_snapshot || null,
        promptIndependenceScoreSnapshot: normalizedRecord.promptIndependenceScoreSnapshot ?? record?.prompt_independence_score_snapshot ?? record?.promptIndependenceScoreSnapshot ?? rawPayload.promptIndependenceScoreSnapshot ?? rawPayload.prompt_independence_score_snapshot ?? null,
        promptIntrusivenessOrderSnapshot: normalizedRecord.promptIntrusivenessOrderSnapshot ?? record?.prompt_intrusiveness_order_snapshot ?? record?.promptIntrusivenessOrderSnapshot ?? rawPayload.promptIntrusivenessOrderSnapshot ?? rawPayload.prompt_intrusiveness_order_snapshot ?? null,
        promptLevelKey,
        promptLevelName,
        rawPayload,
        score: null,
        trialOutcome: outcome,
        detail: `${getAbaCollectionLabel(collectionType)} · ${abaV3ActionDisplayLabel(v3ActionKey)}${promptLabel ? ` · ${promptLabel}` : ''}`
      };
    }
    return {
      ...normalizedRecord,
      collectionType,
      promptTypeId: normalizedRecord.promptTypeId || record?.prompt_type_id || record?.promptTypeId || rawPayload.promptTypeId || rawPayload.prompt_type_id || null,
      promptTypeNameSnapshot,
      promptCategorySnapshot: normalizedRecord.promptCategorySnapshot || record?.prompt_category_snapshot || record?.promptCategorySnapshot || rawPayload.promptCategorySnapshot || rawPayload.prompt_category_snapshot || null,
      promptIndependenceScoreSnapshot: normalizedRecord.promptIndependenceScoreSnapshot ?? record?.prompt_independence_score_snapshot ?? record?.promptIndependenceScoreSnapshot ?? rawPayload.promptIndependenceScoreSnapshot ?? rawPayload.prompt_independence_score_snapshot ?? null,
      promptIntrusivenessOrderSnapshot: normalizedRecord.promptIntrusivenessOrderSnapshot ?? record?.prompt_intrusiveness_order_snapshot ?? record?.promptIntrusivenessOrderSnapshot ?? rawPayload.promptIntrusivenessOrderSnapshot ?? rawPayload.prompt_intrusiveness_order_snapshot ?? null,
      promptLevelKey,
      promptLevelName,
      rawPayload,
      trialOutcome: outcome,
      detail: formatAbaTrialHistoryLabel({
        collectionType,
        outcome,
        score,
        promptLevelKey,
        promptLevelName
      })
    };
  }
  return normalizedRecord;
};

const getIntervalInstruction = (measurementType: string) => {
  if (measurementType === 'partial_interval') return 'SIM = ocorreu em qualquer momento do intervalo.';
  if (measurementType === 'whole_interval') return 'SIM = ocorreu durante o intervalo inteiro.';
  return 'SIM = estava ocorrendo exatamente no momento do alerta.';
};

const readMasteryValue = (row: any, ...keys: string[]) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return undefined;
};

const buildSessionGoalMasteryCriterion = (goal: any) => {
  const embedded = goal?.mastery_criteria && typeof goal.mastery_criteria === 'object'
    ? goal.mastery_criteria
    : goal?.masteryCriteria && typeof goal.masteryCriteria === 'object'
      ? goal.masteryCriteria
      : {};
  const rawCriterion: any = {
    ...embedded,
    id: readMasteryValue(embedded, 'id') || readMasteryValue(goal, 'masteryCriteriaId', 'criteriaId') || null,
    organization_id: readMasteryValue(goal, 'organization_id', 'organizationId', 'clinic_id', 'clinicId') || null,
    program_id: readMasteryValue(goal, 'program_id', 'programId', 'protocol_id', 'protocolId') || null,
    target_id: readMasteryValue(goal, 'target_id', 'targetId', 'aba_target_id', 'abaTargetId', 'id') || null,
    name: readMasteryValue(embedded, 'name') || 'Criterio da meta',
    is_active: readMasteryValue(embedded, 'is_active', 'isActive') ?? true,
    source: readMasteryValue(embedded, 'source', 'criterionSource', 'criterion_source', 'origin') || 'skill',
    sourceLabel: readMasteryValue(embedded, 'sourceLabel', 'source_label', 'originLabel', 'origin_label') || undefined
  };
  const legacySuccessTarget = readMasteryValue(goal, 'meta_sucessos', 'metaSucessos', 'masteryTarget', 'mastery_target');
  if (
    legacySuccessTarget !== undefined &&
    readMasteryValue(rawCriterion, 'required_consecutive_independent_correct_trials', 'requiredConsecutiveIndependentCorrectTrials') === undefined &&
    readMasteryValue(rawCriterion, 'required_independent_correct_trials', 'requiredIndependentCorrectTrials') === undefined
  ) {
    rawCriterion.required_consecutive_independent_correct_trials = legacySuccessTarget;
    rawCriterion.requiredConsecutiveIndependentCorrectTrials = legacySuccessTarget;
    rawCriterion.mastery_criterion_mode = readMasteryValue(rawCriterion, 'mastery_criterion_mode', 'masteryCriterionMode') || 'consecutive_independent';
    rawCriterion.masteryCriterionMode = rawCriterion.mastery_criterion_mode;
    rawCriterion.requires_consecutive_successes = true;
    rawCriterion.requiresConsecutiveSuccesses = true;
  }
  const normalized = normalizeAbaMasteryCriterion(rawCriterion);
  return normalized ? { ...normalized, sourceLabel: abaMasteryCriterionSourceLabel(normalized) } : null;
};

const masteryStatusLabel = (status: string) => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'READY_FOR_REVIEW') return 'Critério concluído - pronto para revisão';
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

const isTeachingOperationalGoal = (goal: any) => {
  const values = [
    goal?.clinical_status,
    goal?.clinicalStatus,
    goal?.phase,
    goal?.status,
    goal?.target_type,
    goal?.targetType
  ].map((value) => String(value || '').trim().toLowerCase());
  if (values.some((value) => ['in_progress', 'acquisition', 'teaching', 'baseline'].includes(value))) return true;
  return Boolean(goal?.isPriority && !isMaintenanceLikeGoal(goal));
};

const normalizeSessionMaintenanceProbeList = (items: any[]) => (Array.isArray(items) ? items : [])
  .map((item: any) => {
    const schedule = item?.schedule && typeof item.schedule === 'object' ? item.schedule : {};
    const scheduleId = String(schedule?.id || schedule?.schedule_id || schedule?.scheduleId || item?.scheduleId || '').trim();
    const targetId = String(schedule?.target_id || schedule?.targetId || schedule?.target?.id || item?.targetId || '').trim();
    if (!scheduleId || !targetId) return null;
    return {
      ...schedule,
      id: scheduleId,
      schedule_id: schedule?.schedule_id || scheduleId,
      scheduleId,
      target_id: targetId,
      targetId,
      target_name: schedule?.target_name || schedule?.targetName || item?.targetName || schedule?.target?.name || null,
      targetName: schedule?.targetName || schedule?.target_name || item?.targetName || schedule?.target?.name || null,
      protocolTitle: schedule?.protocolTitle || schedule?.protocol_title || item?.protocolName || null,
      protocol_title: schedule?.protocol_title || schedule?.protocolTitle || item?.protocolName || null,
      domainName: schedule?.domainName || schedule?.domain_name || item?.domainName || null,
      domain_name: schedule?.domain_name || schedule?.domainName || item?.domainName || null,
      target_due_date: schedule?.target_due_date || schedule?.targetDueDate || schedule?.due_date || schedule?.dueDate || item?.dueDate || null,
      targetDueDate: schedule?.targetDueDate || schedule?.target_due_date || schedule?.dueDate || schedule?.due_date || item?.dueDate || null,
      scheduled_for: schedule?.scheduled_for || schedule?.scheduledFor || item?.appointmentStartAt || item?.dueDate || null,
      scheduledFor: schedule?.scheduledFor || schedule?.scheduled_for || item?.appointmentStartAt || item?.dueDate || null,
      appointment_id: schedule?.appointment_id || schedule?.appointmentId || item?.appointmentId || null,
      appointmentId: schedule?.appointmentId || schedule?.appointment_id || item?.appointmentId || null,
      appointmentStartAt: item?.appointmentStartAt || schedule?.appointmentStartAt || null,
      availabilityReason: item?.availabilityReason || schedule?.availabilityReason || null,
      status: schedule?.status || item?.status || null
    };
  })
  .filter(Boolean);

const getMaintenancePanelSchedule = (row: any) => (
  row?.nextSchedule ||
  row?.activeSchedule ||
  row?.schedule ||
  row?.nextProbe?.schedule ||
  null
);

const mergeMaintenanceScheduleLists = (...lists: any[][]) => {
  const byId = new Map<string, any>();
  lists.flat().forEach((schedule: any) => {
    const scheduleId = String(schedule?.id || schedule?.schedule_id || schedule?.scheduleId || '').trim();
    if (!scheduleId) return;
    if (!byId.has(scheduleId)) byId.set(scheduleId, schedule);
  });
  return Array.from(byId.values());
};

const maintenanceScheduleTargetId = (schedule: any) => String(schedule?.target_id || schedule?.targetId || schedule?.target?.id || '').trim();

const buildSessionGoalFromAvailableMaintenanceSchedule = (schedule: any) => {
  const targetId = maintenanceScheduleTargetId(schedule);
  if (!targetId) return null;
  const targetName = String(schedule?.targetName || schedule?.target_name || schedule?.target?.name || 'Sondagem de manutenção').trim();
  return {
    id: targetId,
    target_id: targetId,
    targetId,
    name: targetName,
    targetName,
    target_name: targetName,
    protocolTitle: schedule?.protocolTitle || schedule?.protocol_title || null,
    protocol_title: schedule?.protocol_title || schedule?.protocolTitle || null,
    domainName: schedule?.domainName || schedule?.domain_name || null,
    domain_name: schedule?.domain_name || schedule?.domainName || null,
    status: 'maintenance_probe_available',
    clinical_status: 'MAINTENANCE',
    source: 'session_maintenance_probe_available',
    isMaintenanceProbeAvailableSessionGoal: true
  };
};

const mergeSessionGoalsWithAvailableMaintenance = (baseGoals: any[], availableSchedules: any[]) => {
  const byTargetId = new Map<string, any>();
  (Array.isArray(baseGoals) ? baseGoals : []).forEach((goal: any) => {
    const targetId = String(goal?.target_id || goal?.targetId || goal?.aba_target_id || goal?.abaTargetId || goal?.id || '').trim();
    const key = targetId || String(goal?.id || goal?.name || '').trim();
    if (key && !byTargetId.has(key)) byTargetId.set(key, goal);
  });
  (Array.isArray(availableSchedules) ? availableSchedules : []).forEach((schedule: any) => {
    const targetId = maintenanceScheduleTargetId(schedule);
    if (!targetId || byTargetId.has(targetId)) return;
    const goal = buildSessionGoalFromAvailableMaintenanceSchedule(schedule);
    if (goal) byTargetId.set(targetId, goal);
  });
  return Array.from(byTargetId.values()).sort((a: any, b: any) => {
    const availableDiff = (b.isMaintenanceProbeAvailableSessionGoal ? 1 : 0) - (a.isMaintenanceProbeAvailableSessionGoal ? 1 : 0);
    if (availableDiff !== 0) return availableDiff;
    return (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0);
  });
};


type SessionSummaryDisclosureTone = 'default' | 'amber' | 'red' | 'slate' | 'emerald';

const SessionSummaryDisclosure = ({
  title,
  meta,
  tone = 'default',
  children
}: {
  title: string;
  meta?: React.ReactNode;
  tone?: SessionSummaryDisclosureTone;
  children: React.ReactNode;
}) => {
  const toneClasses: Record<SessionSummaryDisclosureTone, string> = {
    default: 'border-blue-100 bg-white text-gray-900',
    amber: 'border-amber-100 bg-amber-50/70 text-amber-800',
    red: 'border-red-100 bg-red-50/70 text-red-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700'
  };

  return (
    <details className="group mt-3">
      <summary
        className={`flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm transition hover:shadow-md [&::-webkit-details-marker]:hidden ${toneClasses[tone]}`}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-[11px] font-medium opacity-65">{meta || 'Toque para ver os detalhes'}</p>
        </div>
        <ChevronDown size={18} className="shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-2 [&>section]:mt-0">{children}</div>
    </details>
  );
};

export const SessionMode = ({
  patient,
  onClose,
  onRecordTrial,
  activeSession,
  remainingSeconds = 0,
  formatCountdown,
  onConfirmEndSession,
  onSessionSummaryPersisted,
  onMasteryPreviewChanged,
  onSessionRecordSaved,
  therapistId,
  therapistName,
  clinicId,
  capabilities,
  userRole,
  reviewSessionId = '',
  openCompletedReport = false
}: any) => {
  const abaV3UiEnabled = isAbaV3UiEnabled();
  if (!isAbaV2Enabled() && !abaV3UiEnabled) return null;
  const hasCapability = (capability: string) => {
    if (capabilities instanceof Set) return capabilities.has(capability);
    if (Array.isArray(capabilities)) return capabilities.includes(capability);
    if (capabilities && typeof capabilities.has === 'function') return capabilities.has(capability);
    return false;
  };
  const canReopenNoShow = hasCapability('calendar.no_show.record') && ['owner', 'admin', 'coordinator', 'director'].includes(String(userRole || '').trim().toLowerCase());

  const legacySessionGoals = useMemo(() => (
    [...(patient.pei?.filter(isTeachingOperationalGoal) || [])]
      .sort((a: any, b: any) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0))
  ), [patient.pei]);

  const requestedReviewSessionId = String(reviewSessionId || '').trim();
  const isCompletedSessionReview = Boolean(requestedReviewSessionId);
  const sessionId = String(requestedReviewSessionId || activeSession?.id || `draft-${patient?.id || 'patient'}`);
  const patientId = String(patient?.id || '');
  const resolvedTherapistId = String(therapistId || activeSession?.therapistId || activeSession?.therapist_id || '').trim();
  const resolvedClinicId = String(clinicId || activeSession?.clinicId || activeSession?.clinic_id || patient?.clinicId || patient?.clinic_id || patient?.organizationId || patient?.organization_id || '').trim();
  const activeAppointmentId = String(activeSession?.appointmentId || activeSession?.appointment_id || '').trim();
  const activeTherapeuticPlanId = String(activeSession?.therapeuticPlanId || activeSession?.therapeutic_plan_id || '').trim();
  const activeSessionLocationName = String(
    activeSession?.locationNameSnapshot ||
      activeSession?.location_name_snapshot ||
      activeSession?.locationContextSnapshot?.locationName ||
      activeSession?.location_context_snapshot?.locationName ||
      activeSession?.roomName ||
      activeSession?.room_name ||
      '',
  ).trim();
  const activeSessionCareSetting = String(activeSession?.careSetting || activeSession?.care_setting || '').toUpperCase();
  const sessionClinicalDate = activeSession?.clinicalDate || activeSession?.clinical_date || activeSession?.sessionDate || activeSession?.session_date || activeSession?.date || activeSession?.scheduledAt || activeSession?.scheduled_at || activeSession?.startedAt || activeSession?.started_at || activeSession?.created_at || new Date().toISOString();
  const maintenanceTimeZone = String(activeSession?.timeZone || activeSession?.timezone || patient?.timeZone || patient?.timezone || patient?.clinicTimeZone || patient?.clinic_timezone || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';
  const patientDisplayName = formatPatientLabel(patient);
  const therapistDisplayName = formatTherapistLabel({
    therapistName,
    professionalName: activeSession?.professionalName || activeSession?.professional_name || patient?.professionalName || patient?.professional_name,
    displayName: activeSession?.therapistName || activeSession?.therapist_name || patient?.therapistName || patient?.therapist_name,
    id: resolvedTherapistId
  });
  const sessionStateKey = `verto.aba_session_state:${patientId}:${sessionId}`;

  const [trialCount, setTrialCount] = useState(0);
  const [reinforcerClosureSyncing, setReinforcerClosureSyncing] = useState(false);
  const [activeCriteria, setActiveCriteria] = useState<string | null>(null);
  const [collectionType, setCollectionType] = useState('dtt');
  const [lastRegularTrialType, setLastRegularTrialType] = useState('dtt');
  const [currentTrialTargetKey, setCurrentTrialTargetKey] = useState<string | null>(null);
  const [activeMaintenanceProbeTargetId, setActiveMaintenanceProbeTargetId] = useState<string | null>(null);
  const [activeMaintenanceScheduleId, setActiveMaintenanceScheduleId] = useState<string | null>(null);
  const [expandedMaintenanceProbeTargetId, setExpandedMaintenanceProbeTargetId] = useState<string | null>(null);
  const [maintenanceProbeQueueFilter, setMaintenanceProbeQueueFilter] = useState<'all' | 'pending' | 'registered'>('all');
  const [maintenanceProbeQueueExpanded, setMaintenanceProbeQueueExpanded] = useState(false);
  const [sessionPlanFilter, setSessionPlanFilter] = useState<'all' | 'skills' | 'maintenance'>('all');
  const [manualMaintenanceProbeTargets, setManualMaintenanceProbeTargets] = useState<Record<string, ManualMaintenanceProbeActivation>>({});
  const [manualRegularOverrideTargetId, setManualRegularOverrideTargetId] = useState<string | null>(null);
  const [promptLevelKey, setPromptLevelKey] = useState('verbal');
  const [records, setRecords, recordsRef] = useLiveSessionState<SessionRecord[]>([]);
  const [sessionLiveSummary, setSessionLiveSummary] = useState<any>(null);
  const [maintenanceOverview, setMaintenanceOverview] = useState<any>({ schedules: [], probeResults: [], alerts: [], summary: null });
  const [maintenancePanel, setMaintenancePanel] = useState<any>(null);
  const [therapeuticPrograms, setTherapeuticPrograms] = useState<any[]>([]);
  const [therapeuticPlanLoading, setTherapeuticPlanLoading] = useState(true);
  const [sessionMaintenanceProbes, setSessionMaintenanceProbes] = useState<any>({ available: [], upcoming: [], loaded: false, error: '' });
  const [maintenanceScheduleModalGoal, setMaintenanceScheduleModalGoal] = useState<any>(null);
  const [maintenanceScheduleMode, setMaintenanceScheduleMode] = useState('DEFAULT_SEQUENCE');
  const [maintenanceCustomDate, setMaintenanceCustomDate] = useState('');
  const [maintenanceSelectedAppointmentId, setMaintenanceSelectedAppointmentId] = useState('');
  const [maintenanceAppointmentsState, setMaintenanceAppointmentsState] = useState<{ loading: boolean; error: string; items: any[] }>({ loading: false, error: '', items: [] });
  const [maintenanceScheduleSaving, setMaintenanceScheduleSaving] = useState(false);
  const [planningFocusType, setPlanningFocusType] = useState('BALANCED');
  const [planningRecommendations, setPlanningRecommendations] = useState<any[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [planningMessage, setPlanningMessage] = useState('');
  const [planningFilter, setPlanningFilter] = useState<'pending' | 'high' | 'regression' | 'maintenance' | 'prompt_fading' | 'edited' | 'history'>('pending');
  const [planningDecisionLoadingId, setPlanningDecisionLoadingId] = useState('');
  const planningGenerationInFlightRef = useRef(false);
  const planningDecisionInFlightRef = useRef(new Set<string>());
  const [editingRecommendation, setEditingRecommendation] = useState<any>(null);
  const [editRecommendationForm, setEditRecommendationForm] = useState({
    title: '',
    priority: 'MEDIUM',
    recommendationType: 'CONTINUE_TRAINING',
    targetId: '',
    suggestedAction: '',
    summary: '',
    rationale: '',
    clinicalNote: '',
    applyForDate: '',
    responsibleProfessionalId: ''
  });
  const [rejectingRecommendation, setRejectingRecommendation] = useState<any>(null);
  const [rejectRecommendationReason, setRejectRecommendationReason] = useState('');
  const [rejectRecommendationNotes, setRejectRecommendationNotes] = useState('');
  const [nextSessionPlanItems, setNextSessionPlanItems] = useState<any[]>([]);
  const [planActionMessage, setPlanActionMessage] = useState('');
  const planningFilterOptions = [
    { key: 'pending', label: 'Pendentes' },
    { key: 'high', label: 'Alta prioridade' },
    { key: 'regression', label: 'Regressão' },
    { key: 'maintenance', label: 'Manutenção' },
    { key: 'prompt_fading', label: 'Redução de ajuda' },
    { key: 'edited', label: 'Editadas' },
    { key: 'history', label: 'Histórico' }
  ] as const;
  const recommendationTypeOptions = [
    { value: 'REGRESSION_ATTENTION', label: 'Atenção para regressão' },
    { value: 'MAINTENANCE_PROBE', label: 'Sondagem de manutenção' },
    { value: 'PROMPT_FADING', label: 'Redução gradual de ajuda' },
    { value: 'MASTERY_REVIEW', label: 'Revisão de critério' },
    { value: 'CONTINUE_TRAINING', label: 'Continuidade de ensino' },
    { value: 'INTRODUCE_NEW_TARGET', label: 'Novo alvo' },
    { value: 'BEHAVIOR_MONITORING', label: 'Monitoramento comportamental' },
    { value: 'ABC_COLLECTION', label: 'Coleta ABC' },
    { value: 'GENERALIZATION', label: 'Generalização' }
  ];
  const recommendationPriorityOptions = [
    { value: 'HIGH', label: 'Alta' },
    { value: 'MEDIUM', label: 'Média' },
    { value: 'LOW', label: 'Baixa' }
  ];
  const rejectRecommendationReasons = [
    'Não faz sentido clinicamente agora',
    'Dados insuficientes',
    'Já foi trabalhado',
    'Supervisor decidiu não aplicar',
    'Prioridade será outra',
    'Outro motivo'
  ];
  const [openDurations, setOpenDurations, openDurationsRef] = useLiveSessionState<OpenDurationEvent[]>([]);
  const [therapeuticTimers, setTherapeuticTimers, therapeuticTimersRef] = useLiveSessionState<Record<string, TherapeuticTimerState>>({});
  const [priorMasteryEvaluations, setPriorMasteryEvaluations] = useState<any[]>([]);
  const [selectedBehaviorId, setSelectedBehaviorId] = useState('crying');
  const [behaviorMeasurementType, setBehaviorMeasurementType] = useState(behaviorPresets[0].defaultMeasurement);
  const [canonicalBehaviorPresets, setCanonicalBehaviorPresets] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState(locationOptions[0]);
  const [selectedSeverity, setSelectedSeverity] = useState(2);
  const [rateWindow, setRateWindow, rateWindowRef] = useLiveSessionState<any>(null);
  const [intervalRun, setIntervalRun, intervalRunRef] = useLiveSessionState<any>(null);
  const [intervalSummary, setIntervalSummary] = useState<any>(null);
  const [intervalDurationMode, setIntervalDurationMode] = useState('30');
  const [intervalCustomSeconds, setIntervalCustomSeconds] = useState(45);
  const [intervalTotalIntervals, setIntervalTotalIntervals] = useState(10);
  const [intervalTotalIntervalsInput, setIntervalTotalIntervalsInput] = useState('10');
  const [intervalQuantityError, setIntervalQuantityError] = useState('');
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
  const [attendanceStatus, setAttendanceStatus] = useState<SessionAttendanceStatus>('ATTENDED');
  const [endingSession, setEndingSession, endingSessionRef] = useLiveSessionState(false);
  const [sessionEndError, setSessionEndError] = useState('');
  const [noShowReopenPromptOpen, setNoShowReopenPromptOpen] = useState(false);
  const [noShowReopenReason, setNoShowReopenReason] = useState('');
  const [noShowReopenError, setNoShowReopenError] = useState('');
  const [reopeningNoShow, setReopeningNoShow] = useState(false);
  const completionIdempotencyKeyRef = useRef('');
  const completionRequestRef = useRef<{ payload: any; records: SessionRecord[] } | null>(null);
  const noShowReopenIdempotencyKeyRef = useRef('');
  const [sessionCompleted, setSessionCompleted] = useState(Boolean(isCompletedSessionReview));
  const [postClosureSummary, setPostClosureSummary] = useState<SessionSummary | null>(null);
  const [showPostClosureReport, setShowPostClosureReport] = useState(Boolean(isCompletedSessionReview && openCompletedReport));
  const [completedReviewLoading, setCompletedReviewLoading] = useState(Boolean(isCompletedSessionReview));
  const [completedReviewError, setCompletedReviewError] = useState('');
  const [completedReviewReloadKey, setCompletedReviewReloadKey] = useState(0);
  const [operationalClosure, setOperationalClosure] = useState<any>(null);
  const [operationalClosureLoading, setOperationalClosureLoading] = useState(false);
  const [operationalClosureError, setOperationalClosureError] = useState('');
  const [showComplementEditor, setShowComplementEditor] = useState(false);
  const [durationBlockModalOpen, setDurationBlockModalOpen] = useState(false);
  const [promptSelectionGoal, setPromptSelectionGoal] = useState<any>(null);
  const [promptWarning, setPromptWarning] = useState('');
  const [abaV3ErrorSelection, setAbaV3ErrorSelection] = useState<AbaV3ErrorSelection | null>(null);
  const abaV3BindingCacheRef = useRef<Map<string, AbaV3BindingDecision>>(new Map());
  const abaV3BindingInflightRef = useRef<Map<string, Promise<AbaV3BindingDecision | null>>>(new Map());
  const abaV3BehaviorBindingCacheRef = useRef<Map<string, AbaV3BehaviorDecision>>(new Map());
  const [abaV3SessionPlan, setAbaV3SessionPlan] = useState<AbaV3SessionCollectionPlan>({ targets: [], v3_behavior_ids: [], complete: false });
  const [abaV3SessionPlanStatus, setAbaV3SessionPlanStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [abaV3TaskAnalysisModal, setAbaV3TaskAnalysisModal] = useState<AbaV3TaskAnalysisModalState | null>(null);
  const [abaV3TaskAnalysisResults, setAbaV3TaskAnalysisResults] = useState<Record<number, { performanceCode: string; promptKey?: string | null }>>({});
  const [abaV3TaskAnalysisSaving, setAbaV3TaskAnalysisSaving] = useState(false);
  const [clinicPromptTypes, setClinicPromptTypes] = useState<AbaPromptTypeConfig[]>(() => normalizeAbaPromptTypeConfig());
  const [mobileFocusMode, setMobileFocusMode] = useState(true);
  const [mobileSelectedGoalKey, setMobileSelectedGoalKey] = useState('');
  const [mobilePromptGridGoalKey, setMobilePromptGridGoalKey] = useState('');
  const [mobilePromptCategoryByGoalKey, setMobilePromptCategoryByGoalKey] = useState<Record<string, string>>({});
  const [mobileExpandedCriteriaKey, setMobileExpandedCriteriaKey] = useState('');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false);
  const [clinicalDockSheetOpen, setClinicalDockSheetOpen] = useState(false);
  const [dockLocationsExpanded, setDockLocationsExpanded] = useState(false);
  const [dockLocationManagerOpen, setDockLocationManagerOpen] = useState(false);
  const [customDockLocations, setCustomDockLocations] = useState<string[]>([]);
  const [dockLocationRows, setDockLocationRows] = useState<Array<{ id: string; name: string }>>([]);
  const [persistedQuickBehaviorShortcuts, setPersistedQuickBehaviorShortcuts] = useState<any[] | null>(null);
  const [sessionQuickPreferencesLoading, setSessionQuickPreferencesLoading] = useState(false);
  const [sessionQuickPreferencesSaving, setSessionQuickPreferencesSaving] = useState(false);
  const [newDockLocationName, setNewDockLocationName] = useState('');
  const [editingDockLocationName, setEditingDockLocationName] = useState('');
  const [editingDockLocationValue, setEditingDockLocationValue] = useState('');
  const [dockMoreBehaviorsOpen, setDockMoreBehaviorsOpen] = useState(false);
  const [dockMoreDurationsOpen, setDockMoreDurationsOpen] = useState(false);
  const [crisisMode, setCrisisMode] = useState(false);
  const [actionToast, setActionToast] = useState<ClinicalActionToast | null>(null);
  const [actionLocks, setActionLocks] = useState<Record<string, boolean>>({});
  const [microFeedback, setMicroFeedback] = useState<Record<string, 'pulse' | 'check' | 'plus'>>({});
  const [maintenanceProbeFeedback, setMaintenanceProbeFeedback] = useState('');
  const [maintenanceStartDecision, setMaintenanceStartDecision] = useState<'' | 'added' | 'review' | 'skipped'>('');
  const [pendingMaintenanceProbeTrial, setPendingMaintenanceProbeTrial] = useState<PendingMaintenanceProbeTrial | null>(null);
  const [, setTrialAuditEvents] = useState<TrialAuditEvent[]>([]);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editingRecordTitle, setEditingRecordTitle] = useState('');
  const [editingRecordDetail, setEditingRecordDetail] = useState('');
  const [editingRecordCollectionType, setEditingRecordCollectionType] = useState('dtt');
  const [abaV3RevisionRecord, setAbaV3RevisionRecord] = useState<SessionRecord | null>(null);
  const [abaV3RevisionMode, setAbaV3RevisionMode] = useState<'CORRECT' | 'VOID'>('CORRECT');
  const [abaV3RevisionActionKey, setAbaV3RevisionActionKey] = useState<AbaV3TrialActionKey>('INDEPENDENT_CORRECT');
  const [abaV3RevisionPromptKey, setAbaV3RevisionPromptKey] = useState('');
  const [abaV3RevisionReason, setAbaV3RevisionReason] = useState('');
  const [abaV3RevisionSaving, setAbaV3RevisionSaving] = useState(false);
  const abaV3TargetPlanById = useMemo(() => new Map(
    (abaV3SessionPlan.targets || []).map((target) => [String(target.target_id || '').trim(), target])
  ), [abaV3SessionPlan.targets]);
  const abaV3BehaviorIdSet = useMemo(() => new Set(
    (abaV3SessionPlan.v3_behavior_ids || []).map((behaviorId) => String(behaviorId || '').trim()).filter(Boolean)
  ), [abaV3SessionPlan.v3_behavior_ids]);
  const abaV3PlannedModelForGoal = (goal: any) => abaV3TargetPlanById.get(abaV3PlanTargetId(goal))?.measurement_model_version || '';
  const isGoalPlannedForV3Ui = (goal: any) => abaV3PlannedModelForGoal(goal) === 'V3';

  const activePromptOptions = useMemo(() => normalizeAbaPromptTypeConfig(clinicPromptTypes)
    .filter((prompt) => prompt.active && prompt.showInSession)
    .filter((prompt) => prompt.key !== 'independent' && prompt.key !== 'error')
    .map((prompt) => ({ ...prompt, compactLabel: prompt.label })), [clinicPromptTypes]);
  const legacyPromptedPromptOptions = useMemo(() => {
    const options = activePromptOptions.filter((prompt) => !prompt.countsAsIndependent);
    return options.length > 0 ? options : defaultPromptedPromptOptions;
  }, [activePromptOptions]);
  const v3PromptedPromptOptions = useMemo(() => (
    activePromptOptions.filter((prompt) => Boolean(prompt.id))
  ), [activePromptOptions]);
  const promptedPromptOptionsForGoal = (goal: any) => isGoalPlannedForV3Ui(goal)
    ? v3PromptedPromptOptions
    : legacyPromptedPromptOptions;

  const buildPromptCategoryBuckets = (options: typeof activePromptOptions) => {
    const normalizeCategory = (value: unknown) => String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_');
    const bucketDefinitions = [
      { key: 'visual', label: 'Visual', matches: ['visual'] },
      { key: 'verbal', label: 'Verbal', matches: ['verbal'] },
      { key: 'gestural_model', label: 'Gestual/Mod.', matches: ['gestual', 'gestural', 'modelo', 'model', 'posicional', 'positional'] },
      { key: 'physical', label: 'Física', matches: ['fisica', 'physical', 'bloqueio', 'block'] }
    ];
    const buckets = bucketDefinitions.map((bucket) => ({ ...bucket, prompts: [] as typeof activePromptOptions }));
    const otherBucket = { key: 'other', label: 'Outras', matches: [] as string[], prompts: [] as typeof activePromptOptions };
    options.forEach((prompt) => {
      const token = [
        normalizeCategory(prompt.category),
        normalizeCategory(prompt.key),
        normalizeCategory(prompt.label),
        normalizeCategory(prompt.name)
      ].join('_');
      const bucket = buckets.find((item) => item.matches.some((match) => token.includes(match))) || otherBucket;
      bucket.prompts.push(prompt);
    });
    return [...buckets, otherBucket].filter((bucket) => bucket.prompts.length > 0);
  };
  const legacyPromptCategoryBuckets = useMemo(() => buildPromptCategoryBuckets(legacyPromptedPromptOptions), [legacyPromptedPromptOptions]);
  const v3PromptCategoryBuckets = useMemo(() => buildPromptCategoryBuckets(v3PromptedPromptOptions), [v3PromptedPromptOptions]);
  const promptCategoryBucketsForGoal = (goal: any) => isGoalPlannedForV3Ui(goal)
    ? v3PromptCategoryBuckets
    : legacyPromptCategoryBuckets;


  useEffect(() => {
    let cancelled = false;
    dataService.getAbaPromptTypes()
      .then((result: any) => {
        if (cancelled) return;
        setClinicPromptTypes(normalizeAbaPromptTypeConfig(result?.data));
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn('Falha ao carregar tipos de ajuda ABA:', error);
        if (!cancelled) setClinicPromptTypes(normalizeAbaPromptTypeConfig());
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setTherapeuticPlanLoading(true);
    setTherapeuticPrograms([]);

    // A session without a frozen specialty plan must never aggregate every
    // specialty plan visible for the patient. Legacy PEI remains separate.
    if (!activeTherapeuticPlanId) {
      setTherapeuticPlanLoading(false);
      return () => {
        cancelled = true;
      };
    }

    dataService.getPatientTherapeuticPlan(patientId)
      .then((result: any) => {
        if (cancelled) return;
        if (result?.success === false) {
          if (import.meta.env.DEV) console.warn('Plano terapêutico indisponível na sessão:', result?.message || result?.error);
          setTherapeuticPrograms([]);
          return;
        }
        const normalizedPrograms = normalizeTherapeuticPrograms(result?.data || result);
        setTherapeuticPrograms(
          normalizedPrograms.filter((program: any) => String(program?.therapeutic_plan_id || program?.therapeuticPlanId || '').trim() === activeTherapeuticPlanId)
        );
      })
      .catch((loadError: any) => {
        if (import.meta.env.DEV) console.warn('Falha ao carregar programas terapêuticos na sessão:', loadError);
        if (!cancelled) setTherapeuticPrograms([]);
      })
      .finally(() => {
        if (!cancelled) setTherapeuticPlanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTherapeuticPlanId, patientId]);

  useEffect(() => {
    let cancelled = false;
    if (!patientId || sessionId.startsWith('draft-')) {
      setPriorMasteryEvaluations([]);
      return () => { cancelled = true; };
    }
    dataService.getAbaMasteryEvaluations(patientId, { page: 1, pageSize: 50 })
      .then((result: any) => {
        if (cancelled) return;
        const rows = Array.isArray(result?.data) ? result.data : [];
        setPriorMasteryEvaluations(rows.filter((row: any) => String(row?.session_id || row?.sessionId || '').trim() !== sessionId));
      })
      .catch((error: any) => {
        if (import.meta.env.DEV) console.warn('Falha ao carregar histórico de critérios ABA:', error);
        if (!cancelled) setPriorMasteryEvaluations([]);
      });
    return () => { cancelled = true; };
  }, [patientId, sessionId]);

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
  const maintenanceProbeFeedbackTimerRef = useRef<number | null>(null);
  const sessionScrollRef = useRef<HTMLDivElement | null>(null);
  const postClosureScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionSummaryScrollRef = useRef<HTMLDivElement | null>(null);
  const closureAttendanceRef = useRef<HTMLDivElement | null>(null);
  const closureNoteRef = useRef<HTMLDivElement | null>(null);
  const closureDurationResolutionRef = useRef<HTMLDivElement | null>(null);
  const closureIntervalResolutionRef = useRef<HTMLDivElement | null>(null);
  const clinicalDockRef = useRef<HTMLDivElement | null>(null);
  const intervalPausedControlsRef = useRef<HTMLDivElement | null>(null);

  const sessionBehaviorPresets = useMemo(() => {
    if (!abaV3UiEnabled || abaV3BehaviorIdSet.size === 0 || canonicalBehaviorPresets.length === 0) return behaviorPresets;
    const merged = [...behaviorPresets];
    canonicalBehaviorPresets
      .filter((behavior) => abaV3BehaviorIdSet.has(String(behavior.id || '').trim()))
      .forEach((behavior, index) => {
        const behaviorName = String(behavior.name || '').trim();
        const legacyIndex = merged.findIndex((item) => item.name.toLowerCase() === behaviorName.toLowerCase());
        const legacyByName = legacyIndex >= 0 ? merged[legacyIndex] : null;
        const measurementType = String(behavior.measurementType || 'frequency').toLowerCase();
        const canonical = {
          id: String(behavior.id),
          name: behaviorName,
          defaultMeasurement: measurementType,
          allowedMeasurements: [measurementType],
          abcRequirement: legacyByName?.abcRequirement || ('OPTIONAL' as AbcRequirement),
          tone: legacyByName?.tone || behaviorPresets[index % behaviorPresets.length].tone,
          intervalSeconds: behavior.intervalSeconds || null,
          canonicalV3Definition: true
        };
        if (legacyIndex >= 0) merged[legacyIndex] = canonical as any;
        else merged.push(canonical as any);
      });
    return merged;
  }, [abaV3UiEnabled, abaV3BehaviorIdSet, canonicalBehaviorPresets]);

  useEffect(() => {
    if (!abaV3UiEnabled || !patientId || abaV3BehaviorIdSet.size === 0) {
      setCanonicalBehaviorPresets([]);
      return;
    }
    let cancelled = false;
    dataService.getAbaV3BehaviorCatalog(patientId)
      .then((result: any) => {
        if (cancelled) return;
        setCanonicalBehaviorPresets(result?.success && Array.isArray(result?.data) ? result.data : []);
      })
      .catch(() => {
        if (!cancelled) setCanonicalBehaviorPresets([]);
      });
    return () => { cancelled = true; };
  }, [abaV3UiEnabled, patientId, abaV3BehaviorIdSet]);

  useEffect(() => {
    if (sessionBehaviorPresets.some((behavior) => behavior.id === selectedBehaviorId)) return;
    const first = sessionBehaviorPresets[0];
    if (!first) return;
    setSelectedBehaviorId(first.id);
    setBehaviorMeasurementType(first.defaultMeasurement);
    setAbcBehaviorId(first.id);
  }, [selectedBehaviorId, sessionBehaviorPresets]);

  const selectedBehavior = useMemo(
    () => sessionBehaviorPresets.find((behavior) => behavior.id === selectedBehaviorId) || sessionBehaviorPresets[0] || behaviorPresets[0],
    [selectedBehaviorId, sessionBehaviorPresets]
  );
  const selectedBehaviorMeasurements = getBehaviorAllowedMeasurements(selectedBehavior);
  const selectedBehaviorAllowsMultipleMethods = selectedBehaviorMeasurements.length > 1;
  const selectedBehaviorMethodOptions = behaviorMeasurementOptions.filter((option) => selectedBehaviorMeasurements.includes(option.key as any));
  const baselineQuickBehaviorShortcuts = useMemo(() => normalizeQuickBehaviorShortcuts(
    patient?.quickBehaviorShortcuts ||
    patient?.quick_behavior_shortcuts ||
    patient?.abaSettings?.quickBehaviorShortcuts ||
    patient?.clinicSettings?.quickBehaviorShortcuts ||
    patient?.clinicSettings?.abaQuickBehaviorShortcuts,
    sessionBehaviorPresets
  ), [patient?.abaSettings?.quickBehaviorShortcuts, patient?.clinicSettings?.abaQuickBehaviorShortcuts, patient?.clinicSettings?.quickBehaviorShortcuts, patient?.quickBehaviorShortcuts, patient?.quick_behavior_shortcuts, sessionBehaviorPresets]);
  const quickBehaviorShortcuts = useMemo(() => {
    if (persistedQuickBehaviorShortcuts !== null) {
      return persistedQuickBehaviorShortcuts.length > 0
        ? normalizeQuickBehaviorShortcuts(persistedQuickBehaviorShortcuts, sessionBehaviorPresets)
        : [];
    }
    return baselineQuickBehaviorShortcuts;
  }, [baselineQuickBehaviorShortcuts, persistedQuickBehaviorShortcuts, sessionBehaviorPresets]);
  const dockShortcuts = useMemo(() => getDockVisibleShortcuts(
    crisisMode ? baselineQuickBehaviorShortcuts : quickBehaviorShortcuts,
    { crisisMode, limit: 3 }
  ), [baselineQuickBehaviorShortcuts, crisisMode, quickBehaviorShortcuts]);
  const personalizedDockShortcuts = useMemo(() => getDockVisibleShortcuts(quickBehaviorShortcuts, { crisisMode: false, limit: 3 }), [quickBehaviorShortcuts]);
  const crisisShortcutIdSet = useMemo(() => new Set(getCrisisShortcutIds()), []);
  const dockLocationOptions = useMemo(() => mergeDockLocationOptions(customDockLocations), [customDockLocations]);
  const visibleDockLocationOptions = dockLocationsExpanded ? dockLocationOptions : dockLocationOptions.slice(0, 6);
  const recentBehaviorRecords = useMemo(() => records.filter((record) => record.kind === 'behavior' && !isCancelledIntervalClinicalRecord(record)).slice(0, 5), [records]);
  const visibleDockBehaviorOptions = useMemo(() => {
    const byId = new Map<string, any>();
    const addBehavior = (behavior?: any | null) => {
      if (!behavior || byId.has(behavior.id)) return;
      byId.set(behavior.id, behavior);
    };
    addBehavior(selectedBehavior);
    recentBehaviorRecords.forEach((record: any) => {
      const behavior = sessionBehaviorPresets.find((item) => (
        item.id === record.behaviorId ||
        item.id === record.behavior_id ||
        item.name === record.behaviorName ||
        item.name === record.behavior_name ||
        item.name === record.title
      ));
      addBehavior(behavior);
    });
    quickBehaviorShortcuts.forEach((shortcut: any) => {
      addBehavior(sessionBehaviorPresets.find((item) => item.id === shortcut.behaviorId || item.name === shortcut.behaviorName));
    });
    sessionBehaviorPresets.forEach(addBehavior);
    return Array.from(byId.values()).slice(0, 8);
  }, [quickBehaviorShortcuts, recentBehaviorRecords, selectedBehavior, sessionBehaviorPresets]);
  const extraDockBehaviorOptions = useMemo(() => {
    const visibleIds = new Set(visibleDockBehaviorOptions.map((behavior) => behavior.id));
    return sessionBehaviorPresets.filter((behavior) => !visibleIds.has(behavior.id));
  }, [visibleDockBehaviorOptions, sessionBehaviorPresets]);
  const intervalRunStatus = getIntervalRunStatus(intervalRun);
  const intervalRunPaused = intervalRunStatus === 'PAUSED';
  const intervalRunAwaitingResponse = intervalRunStatus === 'AWAITING_RESPONSE';
  const intervalResponseActive = Boolean((intervalRunAwaitingResponse || intervalRun?.awaitingResponse) && !intervalRun?.paused && !intervalRun?.completed);
  const intervalDurationMs = Math.max(1000, Number(intervalRun?.intervalSeconds || intervalSeconds || 1) * 1000);
  const intervalRemainingMs = intervalRun?.intervalEndsAt
    ? Math.max(0, new Date(intervalRun.intervalEndsAt).getTime() - nowMs)
    : intervalDurationMs;
  const intervalProgressPercent = intervalRunAwaitingResponse
    ? 100
    : intervalRunPaused
      ? Math.min(100, Math.max(0, ((intervalDurationMs - Math.max(0, Number(intervalRun?.pauseRemainingMs ?? intervalRemainingMs))) / intervalDurationMs) * 100))
      : Math.min(100, Math.max(0, ((intervalDurationMs - intervalRemainingMs) / intervalDurationMs) * 100));
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

  const syncDockLocationRows = (rows: any[]) => {
    const normalizedRows = (Array.isArray(rows) ? rows : [])
      .map((row: any) => ({ id: String(row?.id || '').trim(), name: normalizeDockLocationLabel(row?.name) }))
      .filter((row: any) => row.id && row.name && !locationOptions.includes(row.name));
    setDockLocationRows(normalizedRows);
    setCustomDockLocations(Array.from(new Set(normalizedRows.map((row: any) => row.name))));
  };

  const addDockLocation = async () => {
    const nextLocation = normalizeDockLocationLabel(newDockLocationName);
    if (!nextLocation) return;
    const defaultLocation = locationOptions.find((location) => location.toLocaleLowerCase('pt-BR') === nextLocation.toLocaleLowerCase('pt-BR'));
    if (defaultLocation) {
      setSelectedLocation(defaultLocation);
      setNewDockLocationName('');
      setDockLocationsExpanded(true);
      showClinicalToast({ variant: 'info', title: 'Local já disponível.', subtitle: defaultLocation }, 'none');
      return;
    }
    const result = await dataService.createAbaSessionLocation(nextLocation);
    if (result?.success === false || !result?.data?.id) {
      showClinicalToast({ variant: 'error', title: 'Não foi possível adicionar o local.', subtitle: result?.message || result?.error || 'Tente novamente.' }, 'error');
      return;
    }
    const nextRows = [
      ...dockLocationRows.filter((row) => row.id !== String(result.data.id)),
      { id: String(result.data.id), name: normalizeDockLocationLabel(result.data.name || nextLocation) }
    ];
    syncDockLocationRows(nextRows);
    setSelectedLocation(normalizeDockLocationLabel(result.data.name || nextLocation));
    setNewDockLocationName('');
    setDockLocationsExpanded(true);
    showClinicalToast({ variant: 'success', title: 'Local adicionado e selecionado.', subtitle: normalizeDockLocationLabel(result.data.name || nextLocation) }, 'none');
  };

  const startRenameDockLocation = (location: string) => {
    setEditingDockLocationName(location);
    setEditingDockLocationValue(location);
  };

  const renameDockLocation = async () => {
    const currentLocation = normalizeDockLocationLabel(editingDockLocationName);
    const nextLocation = normalizeDockLocationLabel(editingDockLocationValue);
    const row = dockLocationRows.find((item) => item.name === currentLocation);
    if (!row?.id || !currentLocation || !nextLocation) return;
    const result = await dataService.updateAbaSessionLocation(row.id, nextLocation);
    if (result?.success === false || !result?.data?.id) {
      showClinicalToast({ variant: 'error', title: 'Não foi possível renomear o local.', subtitle: result?.message || result?.error || 'Tente novamente.' }, 'error');
      return;
    }
    const persistedName = normalizeDockLocationLabel(result.data.name || nextLocation);
    syncDockLocationRows(dockLocationRows.map((item) => item.id === row.id ? { id: row.id, name: persistedName } : item));
    if (selectedLocation === currentLocation) setSelectedLocation(persistedName);
    setEditingDockLocationName('');
    setEditingDockLocationValue('');
    showClinicalToast({ variant: 'success', title: 'Local atualizado.', subtitle: persistedName }, 'none');
  };

  const removeDockLocation = async (location: string) => {
    const removedLocation = normalizeDockLocationLabel(location);
    const row = dockLocationRows.find((item) => item.name === removedLocation);
    if (!row?.id) return;
    const result = await dataService.removeAbaSessionLocation(row.id);
    if (result?.success === false) {
      showClinicalToast({ variant: 'error', title: 'Não foi possível remover o local.', subtitle: result?.message || result?.error || 'Tente novamente.' }, 'error');
      return;
    }
    syncDockLocationRows(dockLocationRows.filter((item) => item.id !== row.id));
    if (selectedLocation === removedLocation) setSelectedLocation(locationOptions[0]);
    if (editingDockLocationName === removedLocation) {
      setEditingDockLocationName('');
      setEditingDockLocationValue('');
    }
    showClinicalToast({ variant: 'info', title: 'Local removido da lista rápida.', subtitle: removedLocation }, 'none');
  };

  const savePersonalizedQuickBehaviorShortcuts = async (nextShortcuts: any[]) => {
    if (sessionQuickPreferencesSaving) return false;
    setSessionQuickPreferencesSaving(true);
    try {
      const normalized = nextShortcuts.slice(0, 3).map((shortcut: any, index: number) => ({
        ...shortcut,
        priority: index + 1,
        visibleInDock: true
      }));
      const result = await dataService.saveAbaQuickBehaviorShortcuts(normalized);
      if (result?.success === false) {
        showClinicalToast({ variant: 'error', title: 'Não foi possível salvar os atalhos.', subtitle: result?.message || result?.error || 'Tente novamente.' }, 'error');
        return false;
      }
      const persisted = Array.isArray(result?.data?.quickBehaviorShortcuts) ? result.data.quickBehaviorShortcuts : normalized;
      setPersistedQuickBehaviorShortcuts(persisted);
      showClinicalToast({ variant: 'success', title: 'Acessos rápidos atualizados.', subtitle: 'A preferência fica salva para você nesta clínica.' }, 'none');
      return true;
    } finally {
      setSessionQuickPreferencesSaving(false);
    }
  };

  const toggleSelectedBehaviorQuickShortcut = async () => {
    const behavior = selectedBehavior;
    if (!behavior?.id) return;
    const current = personalizedDockShortcuts;
    const existing = current.find((shortcut: any) => shortcut.behaviorId === behavior.id);
    if (existing) {
      await savePersonalizedQuickBehaviorShortcuts(current.filter((shortcut: any) => shortcut.behaviorId !== behavior.id));
      return;
    }
    if (current.length >= 3) {
      showClinicalToast({ variant: 'info', title: 'Você já tem 3 acessos rápidos.', subtitle: 'Remova ou reordene um deles antes de fixar outro.' }, 'none');
      return;
    }
    const method = resolveBehaviorMeasurementForAction(behavior, behaviorMeasurementType || behavior.defaultMeasurement || 'frequency');
    await savePersonalizedQuickBehaviorShortcuts([
      ...current,
      {
        behaviorId: behavior.id,
        label: behavior.name,
        method,
        priority: current.length + 1,
        visibleInDock: true,
        color: 'slate',
        icon: method === 'duration' ? 'duration' : 'plus'
      }
    ]);
  };

  const movePersonalizedQuickShortcut = async (behaviorId: string, direction: -1 | 1) => {
    const current = [...personalizedDockShortcuts];
    const index = current.findIndex((shortcut: any) => shortcut.behaviorId === behaviorId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return;
    [current[index], current[targetIndex]] = [current[targetIndex], current[index]];
    await savePersonalizedQuickBehaviorShortcuts(current);
  };

  const dockChipClass = (active: boolean) => `inline-flex min-h-[36px] min-w-0 max-w-full items-center justify-center overflow-hidden whitespace-nowrap rounded-full border px-4 py-2 text-[11px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[#7a32fc]/30 active:scale-[0.98] ${active ? 'border-[#7a32fc] bg-[#7a32fc] text-white shadow-sm shadow-purple-500/10 ring-2 ring-[#7a32fc]/10' : 'border-[#E2D9EA] bg-white text-slate-700 hover:border-purple-200 hover:bg-white'}`;

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
    if (maintenanceProbeFeedbackTimerRef.current) window.clearTimeout(maintenanceProbeFeedbackTimerRef.current);
    Object.values(actionLockTimersRef.current).forEach((timer) => window.clearTimeout(Number(timer)));
    Object.values(microFeedbackTimersRef.current).forEach((timer) => window.clearTimeout(Number(timer)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDockLocationsExpanded(false);
    setDockLocationManagerOpen(false);
    setEditingDockLocationName('');
    setEditingDockLocationValue('');
    if (!resolvedClinicId) {
      syncDockLocationRows([]);
      setPersistedQuickBehaviorShortcuts(null);
      return () => { cancelled = true; };
    }
    setSessionQuickPreferencesLoading(true);
    dataService.getAbaSessionQuickCollectionPreferences()
      .then((result: any) => {
        if (cancelled) return;
        if (result?.success === false) {
          syncDockLocationRows([]);
          setPersistedQuickBehaviorShortcuts(null);
          return;
        }
        const payload = result?.data || {};
        syncDockLocationRows(Array.isArray(payload?.locations) ? payload.locations : []);
        setPersistedQuickBehaviorShortcuts(payload?.preferencesFound
          ? (Array.isArray(payload?.quickBehaviorShortcuts) ? payload.quickBehaviorShortcuts : [])
          : null);
      })
      .catch(() => {
        if (cancelled) return;
        syncDockLocationRows([]);
        setPersistedQuickBehaviorShortcuts(null);
      })
      .finally(() => {
        if (!cancelled) setSessionQuickPreferencesLoading(false);
      });
    return () => { cancelled = true; };
  }, [resolvedClinicId]);

  useEffect(() => {
    setBehaviorMeasurementType(getBehaviorDefaultMeasurement(selectedBehavior));
  }, [selectedBehavior.id, selectedBehavior.defaultMeasurement]);

  useEffect(() => {
    setHydratedSessionStateKey('');
    try {
      const persisted = JSON.parse(localStorage.getItem(sessionStateKey) || '{}');
      setRecords(Array.isArray(persisted.records)
        ? persisted.records.map(normalizePersistedSessionRecord)
        : []);
      setOpenDurations(Array.isArray(persisted.openDurations) ? persisted.openDurations : []);
      setTherapeuticTimers(persisted.therapeuticTimers && typeof persisted.therapeuticTimers === 'object' ? persisted.therapeuticTimers : {});
      setRateWindow(persisted.rateWindow || null);
      setIntervalRun(persisted.intervalRun || null);
      const persistedIntervalSummary = persisted.intervalSummary || null;
      const persistedSummaryEndedAtMs = persistedIntervalSummary?.endedAt
        ? new Date(persistedIntervalSummary.endedAt).getTime()
        : 0;
      const persistedSummaryStillVisible = Boolean(
        persistedIntervalSummary
        && Number.isFinite(persistedSummaryEndedAtMs)
        && persistedSummaryEndedAtMs > 0
        && Date.now() - persistedSummaryEndedAtMs < transientCollectionSummaryMs
      );
      setIntervalSummary(persistedSummaryStillVisible ? persistedIntervalSummary : null);
      setSessionNote(String(persisted.sessionNote || ''));
      setSessionCompleted(Boolean(isCompletedSessionReview || persisted.sessionCompleted || String(activeSession?.status || '').toLowerCase() === 'completed'));
      setPostClosureSummary(persisted.postClosureSummary || null);
      setTrialCount(Number(persisted.trialCount || 0));
      setMaintenanceStartDecision(['added', 'review', 'skipped'].includes(String(persisted.maintenanceStartDecision || ''))
        ? persisted.maintenanceStartDecision
        : '');
      const restoredRegularTrialType = normalizeRegularAbaTrialType(persisted.lastRegularTrialType, 'dtt');
      const restoredCollectionType = normalizeAbaCollectionType(persisted.collectionType || restoredRegularTrialType);
      setLastRegularTrialType(restoredRegularTrialType);
      setCollectionType(isMaintenanceProbeCollection(restoredCollectionType) ? restoredRegularTrialType : normalizeRegularAbaTrialType(restoredCollectionType, restoredRegularTrialType));
      setManualMaintenanceProbeTargets(persisted.manualMaintenanceProbeTargets && typeof persisted.manualMaintenanceProbeTargets === 'object' ? persisted.manualMaintenanceProbeTargets : {});
      setActiveMaintenanceProbeTargetId(null);
      setActiveMaintenanceScheduleId(null);
      setManualRegularOverrideTargetId(null);
      setCurrentTrialTargetKey(null);
    } catch {
      setRecords([]);
      setOpenDurations([]);
      setTherapeuticTimers({});
      setRateWindow(null);
      setIntervalRun(null);
      setIntervalSummary(null);
      setSessionNote('');
      setSessionCompleted(Boolean(isCompletedSessionReview || String(activeSession?.status || '').toLowerCase() === 'completed'));
      setPostClosureSummary(null);
      setTrialCount(0);
      setLastRegularTrialType('dtt');
      setCollectionType('dtt');
      setManualMaintenanceProbeTargets({});
      setActiveMaintenanceProbeTargetId(null);
      setActiveMaintenanceScheduleId(null);
      setManualRegularOverrideTargetId(null);
      setCurrentTrialTargetKey(null);
    } finally {
      setHydratedSessionStateKey(sessionStateKey);
    }
  }, [isCompletedSessionReview, sessionStateKey]);

  useEffect(() => {
    if (hydratedSessionStateKey !== sessionStateKey) return;
    try {
      localStorage.setItem(
        sessionStateKey,
        JSON.stringify({
          records: records.slice(0, 40),
          openDurations,
          therapeuticTimers,
          rateWindow,
          intervalRun,
          intervalSummary,
          sessionNote,
          sessionCompleted,
          postClosureSummary,
          trialCount,
          collectionType,
          lastRegularTrialType,
          manualMaintenanceProbeTargets,
          maintenanceStartDecision
        })
      );
    } catch {
      // Local session history is a convenience layer; encrypted offline cache remains the source of truth.
    }
  }, [collectionType, hydratedSessionStateKey, intervalRun, intervalSummary, lastRegularTrialType, maintenanceStartDecision, manualMaintenanceProbeTargets, openDurations, therapeuticTimers, postClosureSummary, rateWindow, records, sessionCompleted, sessionNote, sessionStateKey, trialCount]);

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
        const result = await dataService.getAbaMaintenanceOverview(patientId, { page: 1, pageSize: 20, appointmentId: activeAppointmentId || undefined });
        if (!cancelled) setMaintenanceOverview(result?.data || { schedules: [], probeResults: [], alerts: [], summary: null });
      } catch {
        if (!cancelled) setMaintenanceOverview({ schedules: [], probeResults: [], alerts: [], summary: null });
      }
    };
    void loadMaintenanceOverview();
    return () => {
      cancelled = true;
    };
  }, [activeAppointmentId, patientId, sessionId, sessionCompleted]);

  useEffect(() => {
    let cancelled = false;
    const loadMaintenancePanel = async () => {
      if (!patientId || !activeAppointmentId || sessionCompleted) {
        setMaintenancePanel(null);
        return;
      }
      try {
        const result = await dataService.getAbaMaintenancePanel(patientId, { page: 1, pageSize: 200 });
        if (cancelled) return;
        setMaintenancePanel(mapMaintenancePanelResponse(result, {
          patientId,
          requestId: Date.now(),
          loadedAt: Date.now()
        }));
      } catch {
        if (!cancelled) setMaintenancePanel(null);
      }
    };
    void loadMaintenancePanel();
    return () => {
      cancelled = true;
    };
  }, [activeAppointmentId, patientId, sessionCompleted, sessionId]);

  const loadSessionMaintenanceProbeState = useCallback(async (source: 'auto' | 'manual_reload' = 'auto') => {
    if (!patientId || !sessionId || sessionId.startsWith('draft-') || sessionCompleted) {
      return { available: [], upcoming: [], loaded: false, error: '' };
    }
    try {
      const result = await dataService.getAbaSessionMaintenanceProbes(sessionId, {
        appointmentId: activeAppointmentId || undefined,
        clinicalDate: sessionClinicalDate || undefined,
        timeZone: maintenanceTimeZone || undefined,
        force: source === 'manual_reload'
      });
      const payload = result?.data || result || {};
      const nextState = {
        available: result?.success === false ? [] : Array.isArray(payload?.available) ? payload.available : [],
        upcoming: result?.success === false ? [] : Array.isArray(payload?.upcoming) ? payload.upcoming : [],
        loaded: true,
        error: result?.success === false ? (result?.error || 'Não foi possível carregar sondagens de manutenção.') : '',
        diagnostics: payload?.diagnostics || result?.diagnostics || null
      };
      if (import.meta.env.DEV) {
        console.info('[Maintenance Probes] load attempt', {
          sessionIdPresent: Boolean(sessionId && !sessionId.startsWith('draft-')),
          appointmentIdPresent: Boolean(activeAppointmentId),
          clinicalDate: String(sessionClinicalDate || '').slice(0, 10),
          timeZone: maintenanceTimeZone,
          resultCount: nextState.available.length + nextState.upcoming.length,
          source
        });
      }
      return nextState;
    } catch {
      if (import.meta.env.DEV) {
        console.info('[Maintenance Probes] load attempt', {
          sessionIdPresent: Boolean(sessionId && !sessionId.startsWith('draft-')),
          appointmentIdPresent: Boolean(activeAppointmentId),
          clinicalDate: String(sessionClinicalDate || '').slice(0, 10),
          timeZone: maintenanceTimeZone,
          resultCount: 0,
          source
        });
      }
      return { available: [], upcoming: [], loaded: true, error: 'Não foi possível carregar sondagens de manutenção.' };
    }
  }, [activeAppointmentId, maintenanceTimeZone, patientId, sessionClinicalDate, sessionCompleted, sessionId]);

  useEffect(() => {
    let cancelled = false;
    loadSessionMaintenanceProbeState('auto').then((nextState) => {
      if (!cancelled) setSessionMaintenanceProbes(nextState);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSessionMaintenanceProbeState]);

  useEffect(() => {
    let cancelled = false;
    const loadNextSessionPlanItems = async () => {
      if (!patientId || sessionCompleted) {
        setNextSessionPlanItems([]);
        return;
      }
      try {
        const result = await dataService.getAbaNextSessionPlanItems(patientId, { status: 'PLANNED', limit: 8 });
        if (!cancelled) setNextSessionPlanItems(Array.isArray(result?.data) ? result.data : []);
      } catch {
        if (!cancelled) setNextSessionPlanItems([]);
      }
    };
    void loadNextSessionPlanItems();
    return () => {
      cancelled = true;
    };
  }, [patientId, sessionCompleted, sessionId]);

  useEffect(() => {
    const hasRunningTherapeuticTimer = Object.values(therapeuticTimers).some((timer) => Boolean(timer?.runningSince));
    const hasRunningTimer = openDurations.length > 0 || hasRunningTherapeuticTimer || rateWindow || intervalRun;
    if (!hasRunningTimer) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [intervalRun, openDurations.length, rateWindow, therapeuticTimers]);

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

  useEffect(() => {
    if (!intervalSummary) return;
    const endedAtMs = intervalSummary?.endedAt ? new Date(intervalSummary.endedAt).getTime() : Date.now();
    const safeEndedAtMs = Number.isFinite(endedAtMs) && endedAtMs > 0 ? endedAtMs : Date.now();
    const remainingMs = Math.max(0, transientCollectionSummaryMs - (Date.now() - safeEndedAtMs));
    if (remainingMs <= 0) {
      setIntervalSummary(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setIntervalSummary(null);
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [intervalSummary]);

  useEffect(() => {
    if (!(sessionCompleted && postClosureSummary && !showSessionSummary)) return;
    const animationFrame = window.requestAnimationFrame(() => {
      postClosureScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [sessionCompleted, postClosureSummary?.id, showPostClosureReport, showSessionSummary]);

  useEffect(() => {
    if (!showSessionSummary) return;
    const animationFrame = window.requestAnimationFrame(() => {
      sessionSummaryScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [showSessionSummary]);

  useEffect(() => {
    if (!activeAppointmentId || !(sessionCompleted && postClosureSummary && !showSessionSummary)) {
      setOperationalClosure(null);
      setOperationalClosureError('');
      return;
    }
    let cancelled = false;
    setOperationalClosureLoading(true);
    setOperationalClosureError('');
    dataService.getClosureAppointmentDetail(activeAppointmentId)
      .then((result: any) => {
        if (cancelled) return;
        if (result?.success) {
          setOperationalClosure(result.data || null);
          setOperationalClosureError('');
        } else {
          setOperationalClosure(null);
          setOperationalClosureError(result?.error || 'Não foi possível carregar o fechamento agora.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOperationalClosure(null);
          setOperationalClosureError('Não foi possível carregar o fechamento agora.');
        }
      })
      .finally(() => {
        if (!cancelled) setOperationalClosureLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAppointmentId, sessionCompleted, postClosureSummary?.id, showSessionSummary]);

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

  const goalTargetId = (goal: any) => String(goal?.target_id || goal?.targetId || goal?.aba_target_id || goal?.abaTargetId || goal?.id || '').trim();
  const goalTargetName = (goal: any) => String(goal?.name || goal?.target_name || goal?.targetName || '').trim();
  const goalTargetType = (goal: any) => String(goal?.target_type || goal?.targetType || '').trim().toLowerCase();
  const goalTherapeuticObjectiveId = (goal: any) => String(goal?.therapeutic_objective_id || goal?.therapeuticObjectiveId || '').trim();
  const goalTherapeuticPlanId = (goal: any) => String(goal?.therapeutic_plan_id || goal?.therapeuticPlanId || '').trim();
  const therapeuticGoalKey = (goal: any) => goalTargetId(goal) || goalTargetName(goal) || String(goal?.id || '').trim();
  const CMV3_PLAN_SUPPORTED_MEASUREMENTS = new Set(['correct_incorrect', 'frequency', 'duration', 'latency', 'percentage']);
  const clinicalPlanMetricDirection = (goal: any, measurementType: string) => {
    const criteria = goal?.masteryCriteria || goal?.mastery_criteria || {};
    const operator = String(criteria?.operator || '').trim().toLowerCase();
    if (['lte', 'lt', 'less_than', 'less_than_or_equal'].includes(operator)) return 'lower_is_better';
    if (['gte', 'gt', 'greater_than', 'greater_than_or_equal'].includes(operator)) return 'higher_is_better';
    if (measurementType === 'correct_incorrect' || measurementType === 'percentage') return 'higher_is_better';
    if (measurementType === 'latency') return 'lower_is_better';
    return 'no_directional_judgment';
  };
  const buildClinicalPlanMeasurementV3Payload = ({ goal, measurementType, numericValue, measurementUnit, timestamp, startedAt, endedAt, trialId }: any) => {
    const therapeuticObjectiveId = goalTherapeuticObjectiveId(goal);
    const targetId = goalTargetId(goal);
    const targetName = goalTargetName(goal) || 'Alvo terapêutico';
    if (!therapeuticObjectiveId || !CMV3_PLAN_SUPPORTED_MEASUREMENTS.has(measurementType)) return null;
    const metricKey = `program_target:${targetId || therapeuticObjectiveId}:${measurementType}`.slice(0, 120);
    const metricLabel = `${targetName} · ${measurementType === 'correct_incorrect' ? 'Acurácia' : measurementType === 'frequency' ? 'Frequência' : measurementType === 'duration' ? 'Duração' : measurementType === 'latency' ? 'Latência' : 'Percentual'}`.slice(0, 180);
    const payload: any = {
      sourceKind: 'THERAPEUTIC_OBJECTIVE',
      therapeuticObjectiveId,
      metricKey,
      metricLabel,
      metricType: measurementType,
      unit: measurementType === 'correct_incorrect' ? 'percent' : measurementUnit || null,
      direction: clinicalPlanMetricDirection(goal, measurementType),
      observedAt: timestamp,
      idempotencyKey: trialId,
      numericValue,
      sessionId,
      therapeuticPlanId: activeTherapeuticPlanId || null,
    };
    if (measurementType === 'duration' || measurementType === 'latency') {
      payload.startedAt = startedAt;
      payload.endedAt = endedAt || timestamp;
    }
    return payload;
  };
  const therapeuticTimerElapsedMs = (timer: TherapeuticTimerState | null | undefined) => {
    if (!timer) return 0;
    const runningDelta = timer.runningSince ? Math.max(0, nowMs - new Date(timer.runningSince).getTime()) : 0;
    return Math.max(0, Number(timer.accumulatedMs || 0) + runningDelta);
  };

  const persistTherapeuticMeasurement = async ({
    goal,
    measurementType,
    measurementValue,
    measurementUnit,
    displayLabel,
    startedAt,
    endedAt,
    latencyMs,
    measurementId,
    sessionFinalization = false
  }: {
    goal: any;
    measurementType: string;
    measurementValue: number;
    measurementUnit?: string;
    displayLabel?: string;
    startedAt?: string | null;
    endedAt?: string | null;
    latencyMs?: number | null;
    measurementId?: string;
    sessionFinalization?: boolean;
  }) => {
    if (!ensureSessionCanRecord()) return false;
    const normalizedMeasurementType = normalizeTherapeuticMeasurementType(measurementType);
    if (normalizedMeasurementType === 'independent_prompted_no_response') return false;
    const numericValue = Number(measurementValue);
    if (!Number.isFinite(numericValue)) {
      setSessionWarning('A medida clínica informada é inválida. Nenhum dado foi gravado.');
      return false;
    }
    const targetId = goalTargetId(goal);
    const targetName = goalTargetName(goal) || 'Alvo terapêutico';
    const programId = String(goal?.programId || goal?.program_id || goal?.protocolId || '').trim() || null;
    const timestamp = endedAt || new Date().toISOString();
    const trialId = measurementId || globalThis.crypto.randomUUID();
    const actionKey = `therapeutic:${normalizedMeasurementType}:${targetId || targetName}`;
    if (!lockAction(actionKey, 0)) return false;
    const normalizedCollectionType = normalizeAbaCollectionType(collectionType);
    const isCorrectIncorrect = normalizedMeasurementType === 'correct_incorrect';
    const correct = isCorrectIncorrect ? numericValue > 0 : false;
    const rawPayload = {
      therapeuticMeasurement: true,
      isCensored: sessionFinalization,
      endReason: sessionFinalization ? 'SESSION_FINALIZATION' : null,
      source: 'therapeutic_program_measurement',
      measurementType: normalizedMeasurementType,
      measurementValue: numericValue,
      measurementUnit: measurementUnit || null,
      displayLabel: displayLabel || formatTherapeuticMeasurementDetail(normalizedMeasurementType, numericValue),
      startedAt: startedAt || null,
      endedAt: timestamp,
      durationSeconds: normalizedMeasurementType === 'duration' ? numericValue : null,
      latencyMs: normalizedMeasurementType === 'latency' ? (latencyMs ?? Math.round(numericValue * 1000)) : null,
      programId,
      targetId: targetId || null
    };
    const localRecord: Omit<SessionRecord, 'syncStatus'> = {
      id: trialId,
      kind: 'trial',
      title: targetName,
      detail: formatTherapeuticMeasurementDetail(normalizedMeasurementType, numericValue, rawPayload),
      timestamp,
      targetId: targetId || null,
      targetName,
      programId,
      therapistId: resolvedTherapistId || null,
      measurementType: normalizedMeasurementType,
      therapeuticMeasurement: true,
      measuredValue: numericValue,
      measurementUnit: measurementUnit || null,
      durationSeconds: normalizedMeasurementType === 'duration' ? numericValue : null,
      latencyMs: normalizedMeasurementType === 'latency' ? (latencyMs ?? Math.round(numericValue * 1000)) : null,
      collectionType: normalizedCollectionType,
      score: isCorrectIncorrect ? numericValue : null,
      correct,
      independent: false,
      rawPayload
    };
    upsertRecord(localRecord, 'syncing');
    try {
      const cmv3Payload = buildClinicalPlanMeasurementV3Payload({
        goal,
        measurementType: normalizedMeasurementType,
        numericValue,
        measurementUnit,
        timestamp,
        startedAt: startedAt || timestamp,
        endedAt: timestamp,
        trialId,
      });
      if (cmv3Payload && sessionFinalization) {
        cmv3Payload.isCensored = true;
        cmv3Payload.censorReason = 'SESSION_FINALIZATION';
      }
      const useCanonicalPlanWriter = Boolean(cmv3Payload);
      const result = useCanonicalPlanWriter
        ? await dataService.saveClinicalPlanMeasurementV3(patientId, cmv3Payload)
        : await dataService.saveAbaTrial({
            id: trialId,
            clinic_id: resolvedClinicId || undefined,
            patient_id: patientId,
            session_id: sessionId,
            target_id: targetId || undefined,
            target_name: targetName,
            program_id: programId || undefined,
            collection_type: normalizedCollectionType,
            trial_type: normalizedCollectionType,
            ...(isCorrectIncorrect ? { response_score: numericValue, max_score: 1, correct } : {}),
            independent: false,
            latency_ms: normalizedMeasurementType === 'latency' ? (latencyMs ?? Math.round(numericValue * 1000)) : undefined,
            occurred_at: timestamp,
            therapist_id: resolvedTherapistId || undefined,
            source: 'therapeutic_program_measurement_legacy_fallback',
            raw_payload: {
              ...rawPayload,
              canonicalPlanWriterFallback: true,
              fallbackReason: !CMV3_PLAN_SUPPORTED_MEASUREMENTS.has(normalizedMeasurementType)
                ? 'SEMANTIC_FAMILY_NOT_SUPPORTED_BY_PLAN_WRITER'
                : 'THERAPEUTIC_OBJECTIVE_IDENTITY_UNAVAILABLE',
              therapeuticPlanId: goalTherapeuticPlanId(goal) || null,
              therapeuticObjectiveId: goalTherapeuticObjectiveId(goal) || null,
            }
          });
      if (result?.success === false) {
        updateRecordStatus(trialId, result?.durable ? 'local' : 'error');
        if (!result?.durable) {
          setSessionWarning(result?.error || (useCanonicalPlanWriter ? 'Não foi possível salvar esta medida no registro clínico V3. Nenhum registro Legacy foi criado.' : 'Não foi possível salvar esta medida clínica.'));
          showClinicalToast(buildClinicalSaveErrorToast(), 'error');
          return false;
        }
      } else {
        updateRecordStatus(trialId, result?.pending ? 'local' : 'synced');
      }
      triggerMicroFeedback(actionKey, normalizedMeasurementType === 'frequency' ? 'plus' : 'check');
      const measurementFeedback = displayLabel || formatTherapeuticMeasurementValue(normalizedMeasurementType, numericValue);
      showClinicalToast({
        variant: 'success',
        title: 'Medida registrada',
        compactTitle: '✓ Medida salva',
        compactSubtitle: measurementFeedback,
        subtitle: measurementFeedback
      });
      onSessionRecordSaved?.();
      return true;
    } catch (error) {
      updateRecordStatus(trialId, 'error');
      setSessionWarning('Não foi possível salvar esta medida clínica. O registro local foi preservado para revisão.');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      console.error('Falha ao persistir medida do programa terapêutico:', error);
      return false;
    } finally {
      releaseActionLock(actionKey);
    }
  };

  const startTherapeuticTimer = (goal: any, measurementType: 'duration' | 'latency') => {
    if (!ensureSessionCanRecord()) return;
    const goalKey = therapeuticGoalKey(goal);
    if (!goalKey) return;
    const now = new Date().toISOString();
    setTherapeuticTimers((prev) => ({
      ...prev,
      [goalKey]: {
        goalKey,
        targetId: goalTargetId(goal),
        targetName: goalTargetName(goal) || 'Alvo terapêutico',
        programId: String(goal?.programId || goal?.program_id || goal?.protocolId || '').trim() || null,
        measurementType,
        startedAt: now,
        runningSince: now,
        accumulatedMs: 0,
        recordId: globalThis.crypto.randomUUID(),
        goalSnapshot: {
          id: goalTargetId(goal), name: goalTargetName(goal),
          programId: goal?.programId || goal?.program_id || goal?.protocolId || null,
          therapeutic_objective_id: goalTherapeuticObjectiveId(goal),
          therapeutic_plan_id: goalTherapeuticPlanId(goal)
        }
      }
    }));
  };

  const pauseResumeTherapeuticDuration = (goal: any) => {
    const goalKey = therapeuticGoalKey(goal);
    setTherapeuticTimers((prev) => {
      const timer = prev[goalKey];
      if (!timer || timer.measurementType !== 'duration') return prev;
      if (timer.runningSince) {
        const accumulatedMs = timer.accumulatedMs + Math.max(0, Date.now() - new Date(timer.runningSince).getTime());
        return { ...prev, [goalKey]: { ...timer, accumulatedMs, runningSince: null } };
      }
      return { ...prev, [goalKey]: { ...timer, runningSince: new Date().toISOString() } };
    });
  };

  const finishTherapeuticTimer = async (goal: any, endedAt = new Date().toISOString(), sessionFinalization = false) => {
    const goalKey = therapeuticGoalKey(goal);
    const timer = therapeuticTimersRef.current[goalKey];
    if (!timer) return true;
    const completedAt = timer.completedAt || endedAt;
    const { totalMs, seconds, effectiveStartedAt } = therapeuticTimerCompletion(timer, completedAt);
    const recordId = timer.recordId || globalThis.crypto.randomUUID();
    setTherapeuticTimers((prev) => ({ ...prev, [goalKey]: { ...timer, recordId, completedAt, accumulatedMs: totalMs, runningSince: null } }));
    const saved = await persistTherapeuticMeasurement({
      goal,
      measurementType: timer.measurementType,
      measurementValue: seconds,
      measurementUnit: 'seconds',
      displayLabel: `${timer.measurementType === 'duration' ? 'Duração' : 'Tempo de resposta'} · ${formatDurationSeconds(seconds)}`,
      startedAt: effectiveStartedAt,
      endedAt: completedAt,
      latencyMs: timer.measurementType === 'latency' ? Math.round(totalMs) : null,
      measurementId: recordId,
      sessionFinalization
    });
    if (saved) {
      setTherapeuticTimers((prev) => {
        const next = { ...prev };
        delete next[goalKey];
        return next;
      });
    }
    return saved;
  };

  const cancelTherapeuticTimer = (goal: any) => {
    const goalKey = therapeuticGoalKey(goal);
    setTherapeuticTimers((prev) => {
      if (!prev[goalKey]) return prev;
      const next = { ...prev };
      delete next[goalKey];
      return next;
    });
  };

  const normalizeSessionGoalKey = (value: any) => String(value ?? '').trim();
  const uniqueSessionGoalKeys = (values: any[]) =>
    values
      .map(normalizeSessionGoalKey)
      .filter((value: string, index: number, list: string[]) => Boolean(value) && list.indexOf(value) === index);
  const getSessionGoalIdentityKeys = (goal: any) => uniqueSessionGoalKeys([
    goal?.target_id,
    goal?.targetId,
    goal?.aba_target_id,
    goal?.abaTargetId,
    goal?.id,
    goal?.goalId,
    goal?.goal_id,
    goal?.peiGoalId,
    goal?.pei_goal_id,
    goal?.skillId,
    goal?.skill_id,
    goal?.localTargetRef,
    goal?.local_target_ref
  ]);
  const sessionRecordMatchesTeachingGoal = (record: SessionRecord, goal: any) => {
    if (record.kind !== 'trial') return false;
    if (isMaintenanceProbeCollection(record.collectionType)) return false;
    const recordTargetId = normalizeSessionGoalKey(record.targetId);
    const goalKeys = getSessionGoalIdentityKeys(goal);
    if (recordTargetId && goalKeys.length > 0) return goalKeys.includes(recordTargetId);
    return String(record.title || record.targetName || '').trim() === goalTargetName(goal);
  };
  const teachingMasteryRowMatchesGoal = (row: any, goal: any) => {
    const goalKeys = getSessionGoalIdentityKeys(goal);
    const rowKeys = uniqueSessionGoalKeys([
      row?.targetId,
      row?.target_id,
      row?.id,
      row?.goalId,
      row?.goal_id,
      row?.peiGoalId,
      row?.pei_goal_id,
      row?.skillId,
      row?.skill_id,
      row?.localTargetRef,
      row?.local_target_ref
    ]);
    if (goalKeys.length > 0 && rowKeys.length > 0) return rowKeys.some((key: string) => goalKeys.includes(key));
    return String(row?.name || row?.targetName || row?.target_name || '').trim() === goalTargetName(goal);
  };
  const clearManualMaintenanceProbeTarget = (targetKey?: string | null) => {
    const safeTargetKey = String(targetKey || '').trim();
    if (!safeTargetKey) return;
    setManualMaintenanceProbeTargets((prev) => {
      if (!prev[safeTargetKey]) return prev;
      const next = { ...prev };
      delete next[safeTargetKey];
      return next;
    });
  };

  const getAvailableMaintenanceProbeForTarget = (goal: any): ActiveMaintenanceProbeForTarget | null => resolveActiveMaintenanceProbeForTarget({
    targetId: goalTargetId(goal),
    targetName: goalTargetName(goal),
    schedules: sessionId.startsWith('draft-') ? maintenanceSchedules : sessionAvailableMaintenanceProbeSchedules,
    manualActivations: {},
    activeAppointmentId,
    sessionId,
    sessionClinicalDate,
    timeZone: maintenanceTimeZone,
    now: new Date(nowMs)
  });

  const getActiveMaintenanceProbeForTarget = (goal: any): ActiveMaintenanceProbeForTarget | null => resolveActiveMaintenanceProbeForTarget({
    targetId: goalTargetId(goal),
    targetName: goalTargetName(goal),
    schedules: [],
    manualActivations: manualMaintenanceProbeTargets,
    activeAppointmentId,
    sessionId,
    sessionClinicalDate,
    timeZone: maintenanceTimeZone,
    now: new Date(nowMs)
  });

  const handleCollectionTypeChange = (value: unknown) => {
    const normalized = normalizeAbaCollectionType(value);
    if (isMaintenanceProbeCollection(normalized)) {
      setCollectionType('maintenance_probe');
      setManualRegularOverrideTargetId(null);
      return;
    }
    const regularType = normalizeRegularAbaTrialType(normalized, lastRegularTrialType || 'dtt');
    setCollectionType(regularType);
    setLastRegularTrialType(regularType);
    if (activeMaintenanceProbeTargetId) {
      clearManualMaintenanceProbeTarget(activeMaintenanceProbeTargetId);
      setManualRegularOverrideTargetId(activeMaintenanceProbeTargetId);
    }
    setActiveMaintenanceProbeTargetId(null);
    setActiveMaintenanceScheduleId(null);
  };

  const syncTrialTypeForGoal = (goal: any) => {
    const targetKey = getMaintenanceTargetKey(goal);
    const activeProbe = getActiveMaintenanceProbeForTarget(goal);
    const sameManualOverride = Boolean(targetKey && manualRegularOverrideTargetId === targetKey);
    if (targetKey) setCurrentTrialTargetKey(targetKey);
    if (manualRegularOverrideTargetId && targetKey && manualRegularOverrideTargetId !== targetKey) {
      setManualRegularOverrideTargetId(null);
    }
    const resolvedCollectionType = resolveContextualTrialTypeForTarget({
      requestedTrialType: collectionType,
      lastRegularTrialType,
      activeProbe,
      manualRegularOverride: sameManualOverride
    });
    if (isMaintenanceProbeCollection(resolvedCollectionType)) {
      setCollectionType('maintenance_probe');
      if (targetKey) setActiveMaintenanceProbeTargetId(targetKey);
      setActiveMaintenanceScheduleId(activeProbe?.scheduleId || null);
      return { collectionType: 'maintenance_probe', activeProbe };
    }
    const regularType = normalizeRegularAbaTrialType(resolvedCollectionType, lastRegularTrialType || 'dtt');
    setCollectionType(regularType);
    if (!isMaintenanceProbeCollection(collectionType)) setLastRegularTrialType(regularType);
    setActiveMaintenanceProbeTargetId(null);
    setActiveMaintenanceScheduleId(null);
    return { collectionType: regularType, activeProbe: sameManualOverride ? activeProbe : null };
  };

  const resolveBehaviorDecisionForPayload = async (payload: any): Promise<AbaV3BehaviorDecision | null> => {
    if (!abaV3UiEnabled) return null;
    const behaviorId = String(payload?.behavior_id || payload?.behaviorId || '').trim();
    if (!behaviorId) throw new Error('O comportamento precisa estar identificado antes da coleta V3.');
    const behavior = sessionBehaviorPresets.find((item) => String(item.id) === behaviorId) || { id: behaviorId };
    return await resolveAbaV3BehaviorForAction(behavior);
  };

  const saveExistingBehaviorEvent = async (payload: any, record: Omit<SessionRecord, 'syncStatus'>) => {
    let behaviorDecision: AbaV3BehaviorDecision | null = null;
    try {
      behaviorDecision = await resolveBehaviorDecisionForPayload(payload);
    } catch (error: any) {
      setSessionWarning(error?.message || 'Não foi possível determinar o modelo deste comportamento.');
      showClinicalToast({ variant: 'error', title: 'Coleta bloqueada', subtitle: error?.message || 'Não foi possível determinar o modelo de coleta.' }, 'error');
      return { success: false, error };
    }
    const isV3 = behaviorDecision?.measurementModelVersion === 'V3';
    const persistedRecord = isV3 ? { ...record, measurementModelVersion: 'V3' } : record;
    upsertRecord(persistedRecord, 'local');
    updateRecordStatus(record.id, 'syncing');
    try {
      const result = isV3
        ? await persistAbaV3BehaviorPayload(payload, behaviorDecision as AbaV3BehaviorDecision)
        : await dataService.saveAbaBehaviorEvent({
            ...payload,
            patient_id: patientId,
            patientId,
            session_id: sessionId,
            sessionId,
            appointment_id: activeAppointmentId || undefined,
            appointmentId: activeAppointmentId || undefined,
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
    let behaviorDecision: AbaV3BehaviorDecision | null = null;
    try {
      behaviorDecision = await resolveBehaviorDecisionForPayload(payload);
    } catch (error: any) {
      setSessionWarning(error?.message || 'Não foi possível determinar o modelo deste comportamento.');
      showClinicalToast({ variant: 'error', title: 'Coleta bloqueada', subtitle: error?.message || 'Não foi possível determinar o modelo de coleta.' }, 'error');
      return { success: false, error };
    }
    const isV3 = behaviorDecision?.measurementModelVersion === 'V3';
    const persistedRecord = isV3 ? { ...record, measurementModelVersion: 'V3' } : record;
    addRecord(persistedRecord, 'local');
    updateRecordStatus(record.id, 'syncing');
    try {
      const result = isV3
        ? await persistAbaV3BehaviorPayload(payload, behaviorDecision as AbaV3BehaviorDecision)
        : await dataService.saveAbaBehaviorEvent({
            ...payload,
            patient_id: patientId,
            patientId,
            session_id: sessionId,
            sessionId,
            appointment_id: activeAppointmentId || undefined,
            appointmentId: activeAppointmentId || undefined,
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
    updateRecordStatus(record.id, 'syncing');
    try {
      const result = await dataService.saveAbaIntervalRecord({
        ...payload,
        patient_id: patientId,
        patientId,
        session_id: sessionId,
        sessionId,
        appointment_id: activeAppointmentId || undefined,
        appointmentId: activeAppointmentId || undefined,
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
    updateRecordStatus(record.id, 'syncing');
    try {
      const result = await dataService.saveAbaIntervalSummary({
        ...payload,
        patient_id: patientId,
        patientId,
        session_id: sessionId,
        sessionId,
        appointment_id: activeAppointmentId || undefined,
        appointmentId: activeAppointmentId || undefined,
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
    updateRecordStatus(record.id, 'syncing');
    try {
      const result = await dataService.saveAbaAbcEvent({
        ...payload,
        patient_id: patientId,
        patientId,
        session_id: sessionId,
        sessionId,
        appointment_id: activeAppointmentId || undefined,
        appointmentId: activeAppointmentId || undefined,
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        therapist_id: resolvedTherapistId || undefined,
        therapistId: resolvedTherapistId || undefined,
        source: 'verto_web'
      });
      if (!result?.success) {
        updateRecord(record.id, {
          syncStatus: 'error',
          syncErrorCode: result?.code || null,
          syncErrorMessage: result?.error || 'Não foi possível persistir o ABC.'
        });
        showClinicalToast({ variant: 'error', title: 'ABC não gravado', subtitle: result?.error || 'Revise o registro e tente novamente.' }, 'error');
        return result;
      }
      updateRecordStatus(record.id, !result?.pending && !result?.offline ? 'synced' : 'local');
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
    if (record.measurementModelVersion === 'V3') {
      showClinicalToast({ variant: 'info', title: 'Registro V3 é imutável', subtitle: 'Retificações V3 exigem evento de revisão; exclusão Legacy foi bloqueada.' }, 'none');
      return { success: false, code: 'aba_v3_append_only' };
    }
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
    const overrideRawPayload = {
      ...(overrides.rawPayload || {}),
      ...(overrides.raw_payload || {})
    };
    const contextSnapshot = buildBehaviorEventContextSnapshot({
      ...overrideRawPayload.contextSnapshot,
      ...overrideRawPayload.context_snapshot,
      behaviorName,
      behaviorId: overrides.behaviorId || overrides.behavior_id || selectedBehavior?.id || null,
      collectionMethod: measurementType,
      location: overrides.location ?? selectedLocation,
      severity: overrides.severity ?? selectedSeverity,
      durationSeconds: overrides.durationSeconds ?? overrides.duration_seconds ?? null,
      quantity: overrides.quantity ?? overrides.countDelta ?? overrides.count_delta ?? null,
      alertTarget: overrides.alertTarget ?? overrides.alert_type ?? overrides.alertType ?? intervalAlertType,
      sessionId,
      patientId,
      professionalId: resolvedTherapistId || null,
      timestamp,
      antecedent: overrides.antecedent,
      consequence: overrides.consequence,
      activityName: activeSession?.activityName || activeSession?.activity_name || null,
      goalName: overrides.goalName || overrides.goal_name || overrides.targetName || overrides.target_name || null
    });
    const rawPayload = {
      ...overrideRawPayload,
      contextSnapshot,
      context_snapshot: contextSnapshot,
      clinicId: resolvedClinicId || undefined,
      patientId,
      sessionId,
      therapistId: resolvedTherapistId || null,
      source: 'session_mode_intelligent_behavior',
      clientSource: 'verto_web',
      sessionReferenceDate: activeSession?.referenceDate || null,
      syncStatus: 'local'
    };
    return {
      id: overrides.id || crypto.randomUUID(),
      clinic_id: resolvedClinicId || undefined,
      clinicId: resolvedClinicId || undefined,
      patient_id: patientId,
      patientId,
      session_id: sessionId,
      sessionId,
      appointment_id: activeAppointmentId || undefined,
      appointmentId: activeAppointmentId || undefined,
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
      ...overrides,
      raw_payload: rawPayload,
      rawPayload,
      contextSnapshot
    };
  };

  const recordMatchesGoal = (record: SessionRecord, goal: any) => {
    const goalId = goalTargetId(goal);
    const recordTargetId = String(record.targetId || '').trim();
    return Boolean(goalId && recordTargetId && recordTargetId === goalId);
  };

  const persistMaintenanceProbeResultForTrial = async (params: {
    goal: any;
    score: number;
    outcome: 'independent' | 'prompted' | 'error';
    selectedPrompt: any;
    timestamp: string;
    trialId: string;
    activeProbe: ActiveMaintenanceProbeForTarget | null;
  }) => {
    const goalId = goalTargetId(params.goal);
    const goalName = goalTargetName(params.goal) || 'Target';
    const activeProbe = params.activeProbe || getActiveMaintenanceProbeForTarget(params.goal);
    const resolvedTargetId = goalId || String(activeProbe?.targetId || '').trim();
    const resolvedScheduleId = String(activeProbe?.scheduleId || activeMaintenanceScheduleId || '').trim();
    if (!isRealClinicalId(resolvedTargetId) || !isRealClinicalId(resolvedScheduleId)) {
      setSessionWarning('Nao foi possivel registrar sondagem de manutencao sem habilidade e sondagem vinculadas.');
      showClinicalToast({
        variant: 'error',
        title: 'Sondagem de manutencao incompleta',
        subtitle: 'Selecione uma sondagem disponivel com target e schedule reais.'
      }, 'error');
      return { success: false, error: 'missing_real_maintenance_probe_link' };
    }
    const promptType = params.outcome === 'prompted' ? params.selectedPrompt.key : null;
    const promptSnapshot = buildSessionPromptSnapshot(params.selectedPrompt);
    const syntheticRecord: SessionRecord = {
      id: params.trialId,
      kind: 'trial',
      title: goalName,
      detail: '',
      timestamp: params.timestamp,
      syncStatus: 'local',
      targetId: resolvedTargetId,
      targetName: goalName,
      trialOutcome: params.outcome,
      collectionType: 'maintenance_probe',
      promptTypeId: promptSnapshot.promptTypeId,
      promptTypeNameSnapshot: promptSnapshot.promptTypeNameSnapshot,
      promptCategorySnapshot: promptSnapshot.promptCategorySnapshot,
      promptIndependenceScoreSnapshot: promptSnapshot.promptIndependenceScoreSnapshot,
      promptIntrusivenessOrderSnapshot: promptSnapshot.promptIntrusivenessOrderSnapshot,
      promptLevelKey: params.selectedPrompt.key,
      promptLevelName: params.selectedPrompt.label,
      score: params.score,
      correct: params.outcome !== 'error' && params.score > 0,
      independent: params.outcome === 'independent'
    };
    const probeRecords = [
      syntheticRecord,
      ...records.filter((record) => record.kind === 'trial' && isMaintenanceProbeCollection(record.collectionType) && recordMatchesGoal(record, params.goal))
    ];
    const maintenanceInfo = getGoalMaintenanceInfo(params.goal);
    const maintenanceEvaluation = evaluateMaintenanceStatus({
      organizationId: resolvedClinicId || 'local',
      patientId,
      targetId: resolvedTargetId,
      targetName: goalName,
      sessionId,
      maintenanceScheduleId: resolvedScheduleId,
      criteria: buildSessionGoalMasteryCriterion(params.goal),
      trials: probeRecords.map((record) => ({
        ...record,
        target_id: record.targetId || resolvedTargetId,
        target_name: record.targetName || record.title,
        response_score: record.score,
        correct: Boolean(record.correct),
        independent: Boolean(record.independent),
        collection_type: record.collectionType,
        prompt_level_key: record.promptLevelKey,
        prompt_type_id: record.promptTypeId,
        prompt_type_name_snapshot: record.promptTypeNameSnapshot,
        prompt_category_snapshot: record.promptCategorySnapshot,
        prompt_independence_score_snapshot: record.promptIndependenceScoreSnapshot,
        prompt_intrusiveness_order_snapshot: record.promptIntrusivenessOrderSnapshot,
        trial_outcome: record.trialOutcome,
        therapist_id: record.therapistId || resolvedTherapistId || null,
        occurred_at: record.timestamp
      })),
      previousProbeResults: maintenanceInfo.probeResults,
      occurredAt: params.timestamp
    });
    const result = await dataService.saveAbaMaintenanceProbeResult({
      id: `maintenance-${resolvedScheduleId}-${sessionId}-${params.trialId}`,
      organization_id: resolvedClinicId || undefined,
      organizationId: resolvedClinicId || undefined,
      clinic_id: resolvedClinicId || undefined,
      clinicId: resolvedClinicId || undefined,
      patient_id: patientId,
      patientId,
      target_id: resolvedTargetId,
      targetId: resolvedTargetId,
      target_name: goalName,
      targetName: goalName,
      maintenance_schedule_id: resolvedScheduleId,
      maintenanceScheduleId: resolvedScheduleId,
      schedule_id: resolvedScheduleId,
      scheduleId: resolvedScheduleId,
      session_id: sessionId,
      sessionId,
      appointment_id: activeAppointmentId || undefined,
      appointmentId: activeAppointmentId || undefined,
      trial_id: params.trialId,
      trialId: params.trialId,
      probe_date: params.timestamp.slice(0, 10),
      probeDate: params.timestamp.slice(0, 10),
      clinical_date: String(activeSession?.referenceDate || activeSession?.reference_date || params.timestamp.slice(0, 10)).slice(0, 10),
      clinicalDate: String(activeSession?.referenceDate || activeSession?.reference_date || params.timestamp.slice(0, 10)).slice(0, 10),
      occurred_at: params.timestamp,
      occurredAt: params.timestamp,
      result: params.outcome,
      prompt_type: promptType,
      promptType,
      ...promptSnapshot,
      passed: maintenanceEvaluation.status === 'MAINTAINED',
      status: maintenanceEvaluation.status,
      probeStatus: maintenanceEvaluation.status,
      total_trials: maintenanceEvaluation.totalTrials,
      totalTrials: maintenanceEvaluation.totalTrials,
      independent_trials: maintenanceEvaluation.independentTrials,
      independentTrials: maintenanceEvaluation.independentTrials,
      prompted_trials: maintenanceEvaluation.promptedTrials,
      promptedTrials: maintenanceEvaluation.promptedTrials,
      error_trials: maintenanceEvaluation.errorTrials,
      errorTrials: maintenanceEvaluation.errorTrials,
      accuracy_percent: maintenanceEvaluation.accuracyPercent,
      accuracyPercent: maintenanceEvaluation.accuracyPercent,
      independence_percent: maintenanceEvaluation.independencePercent,
      independencePercent: maintenanceEvaluation.independencePercent,
      created_by: resolvedTherapistId || undefined,
      createdBy: resolvedTherapistId || undefined,
      updated_by: resolvedTherapistId || undefined,
      updatedBy: resolvedTherapistId || undefined,
      raw_payload: {
        source: 'session_mode_trial',
        clientTrialId: params.trialId,
        trialId: params.trialId,
        maintenanceScheduleId: resolvedScheduleId,
        maintenance_schedule_id: resolvedScheduleId,
        result: params.outcome,
        score: params.score,
        promptType,
        ...promptSnapshot,
        targetName: goalName,
        status: maintenanceEvaluation.status,
        reasons: maintenanceEvaluation.reasons,
        criterionProgressLabel: maintenanceEvaluation.criterionProgressLabel,
        activeMaintenanceProbe: {
          scheduleId: resolvedScheduleId,
          targetId: resolvedTargetId,
          source: activeProbe?.source || 'available'
        },
        manuallyActivated: Boolean(activeProbe?.manuallyActivated),
        linkedToSession: Boolean(activeProbe?.linkedToSession),
        noAutomaticTargetMutation: true
      }
    });
    if (result?.success === false && !result?.pending && !result?.offline) {
      updateRecordStatus(params.trialId, 'error');
      showPersistResultToast(result);
      return result;
    } else if (result?.pending || result?.offline) {
      showPersistResultToast(result);
    } else {
      showClinicalToast({
        variant: 'success',
        title: 'Sondagem de manutencao registrada.',
        subtitle: 'Resultado salvo no registro clínico.'
      });
    }
    void refreshMaintenanceOverview();

    const targetKey = getMaintenanceTargetKey(params.goal);
    const nextManualActivations = { ...manualMaintenanceProbeTargets };
    if (targetKey && activeProbe?.manuallyActivated) {
      delete nextManualActivations[targetKey];
      setManualMaintenanceProbeTargets(nextManualActivations);
    }
    setActiveMaintenanceProbeTargetId(null);
    setActiveMaintenanceScheduleId(null);
    setExpandedMaintenanceProbeTargetId(null);
    setManualRegularOverrideTargetId(null);
    setCollectionType(lastRegularTrialType || 'dtt');
    return result;
  };

  const findPreviousTrainingTrialForGoal = (goal: any) => {
    return records
      .filter((record) => record.kind === 'trial' && recordMatchesGoal(record, goal) && isDuplicateRiskTrainingCollection(record.collectionType))
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())[0] || null;
  };

  const persistTrialAudit = (audit: Omit<TrialAuditEvent, 'id' | 'sessionId' | 'occurredAt'>) => {
    const auditEvent: TrialAuditEvent = {
      id: `trial-audit-${crypto.randomUUID()}`,
      sessionId,
      occurredAt: new Date().toISOString(),
      ...audit
    };
    const toCollectionLabel = getAbaCollectionLabel(audit.toCollectionType);
    setTrialAuditEvents((prev) => [auditEvent, ...prev].slice(0, 25));
    void dataService.saveActivityLog({
      type: 'clinical_audit',
      title: 'Conversão de tentativa ABA',
      content: `Tentativa de ${audit.targetName || 'target'} convertida de ${getAbaCollectionLabel(audit.fromCollectionType)} para ${toCollectionLabel}.`,
      details: 'Score, prompt, horário original e target foram preservados.',
      action: 'convert_trial_collection_type',
      action_type: 'convert_trial_collection_type',
      target_name: audit.targetName || null,
      patient_name: patientDisplayName,
      therapist_name: therapistDisplayName,
      created_at: auditEvent.occurredAt
    }).catch((error) => {
      if (import.meta.env.DEV) console.warn('Falha ao registrar auditoria da conversão ABA:', error);
    });
  };

  const persistConvertedTrialRecord = async (record: SessionRecord, fromCollectionType: string, mode: 'conversion' | 'edit' = 'conversion') => {
    const canUpdatePersistedTrial = !String(record.id || '').startsWith('trial-ui-') || record.rawPayload?.clientTrialId === record.id;
    if (!canUpdatePersistedTrial) return;
    try {
      const maxScore = Number(record.rawPayload?.targetMaxScore || record.rawPayload?.maxScore || 1);
      const activeProbe = getActiveMaintenanceProbeForTarget({ id: record.targetId || null, name: record.targetName || record.title });
      const maintenanceScheduleId = String(
        activeProbe?.scheduleId ||
        record.rawPayload?.maintenanceScheduleId ||
        record.rawPayload?.maintenance_schedule_id ||
        record.rawPayload?.activeMaintenanceProbe?.scheduleId ||
        ''
      ).trim();
      const maintenanceTargetId = String(record.targetId || activeProbe?.targetId || '').trim();
      if (!isRealClinicalId(maintenanceTargetId) || !isRealClinicalId(maintenanceScheduleId)) {
        updateRecordStatus(record.id, 'error');
        setSessionWarning('Nao foi possivel converter a tentativa sem sondagem de manutencao disponivel vinculada.');
        showClinicalToast({
          variant: 'error',
          title: 'Sondagem de manutencao incompleta',
          subtitle: 'Use uma sondagem disponivel antes de converter ou editar este registro.'
        }, 'error');
        return;
      }
      const resolvedProbe: ActiveMaintenanceProbeForTarget = activeProbe || {
        active: true,
        targetId: maintenanceTargetId,
        targetName: record.targetName || record.title || null,
        scheduleId: maintenanceScheduleId,
        status: 'AVAILABLE_IN_SESSION',
        dueDate: null,
        linkedToSession: true,
        manuallyActivated: false,
        source: 'available',
        schedule: null
      };
      const result = await dataService.saveAbaTrial({
        id: record.id,
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        patient_id: patientId,
        patientId,
        session_id: sessionId,
        sessionId,
        appointment_id: activeAppointmentId || undefined,
        appointmentId: activeAppointmentId || undefined,
        target_id: maintenanceTargetId,
        targetId: maintenanceTargetId,
        target_name: record.targetName || record.title,
        targetName: record.targetName || record.title,
        program_id: record.programId || null,
        programId: record.programId || null,
        maintenance_schedule_id: maintenanceScheduleId,
        maintenanceScheduleId: maintenanceScheduleId,
        schedule_id: maintenanceScheduleId,
        scheduleId: maintenanceScheduleId,
        collection_type: 'maintenance_probe',
        collectionType: 'maintenance_probe',
        trialType: 'maintenance_probe',
        response_score: record.score,
        score: record.score,
        max_score: maxScore,
        maxScore,
        correct: Boolean(record.correct),
        isCorrect: Boolean(record.correct),
        independent: Boolean(record.independent),
        isIndependent: Boolean(record.independent),
        prompt_level_key: record.promptLevelKey,
        promptLevelKey: record.promptLevelKey,
        prompt_level_name: record.promptLevelName,
        promptLevelName: record.promptLevelName,
        prompt_type_id: record.promptTypeId,
        promptTypeId: record.promptTypeId,
        prompt_type_name_snapshot: record.promptTypeNameSnapshot,
        promptTypeNameSnapshot: record.promptTypeNameSnapshot,
        prompt_category_snapshot: record.promptCategorySnapshot,
        promptCategorySnapshot: record.promptCategorySnapshot,
        prompt_independence_score_snapshot: record.promptIndependenceScoreSnapshot,
        promptIndependenceScoreSnapshot: record.promptIndependenceScoreSnapshot,
        prompt_intrusiveness_order_snapshot: record.promptIntrusivenessOrderSnapshot,
        promptIntrusivenessOrderSnapshot: record.promptIntrusivenessOrderSnapshot,
        occurred_at: record.timestamp,
        occurredAt: record.timestamp,
        timestamp: record.timestamp,
        therapist_id: record.therapistId || resolvedTherapistId || undefined,
        therapistId: record.therapistId || resolvedTherapistId || undefined,
        source: 'verto_web',
        raw_payload: {
          ...(record.rawPayload || {}),
          maintenanceScheduleId,
          maintenance_schedule_id: maintenanceScheduleId,
          activeMaintenanceProbe: {
            scheduleId: maintenanceScheduleId,
            targetId: maintenanceTargetId,
            source: resolvedProbe.source || 'available'
          },
          convertedFromCollectionType: mode === 'conversion' ? fromCollectionType : undefined,
          convertedToCollectionType: mode === 'conversion' ? 'maintenance_probe' : undefined,
          conversionPreservedOriginalTimestamp: mode === 'conversion' ? true : undefined,
          maintenanceProbeTrialEdited: mode === 'edit' ? true : undefined,
          source: mode === 'edit' ? 'session_mode_trial_edit' : 'session_mode_trial_conversion'
        }
      });
      updateRecordStatus(record.id, result?.success && !result?.pending && !result?.offline ? 'synced' : 'local');
      showPersistResultToast(result);
      await persistMaintenanceProbeResultForTrial({
        goal: { id: record.targetId || null, name: record.targetName || record.title },
        score: Number(record.score ?? 0),
        outcome: record.trialOutcome || (record.correct ? 'independent' : 'error'),
        selectedPrompt: {
          key: record.promptLevelKey || 'independent',
          label: record.promptLevelName || record.promptLevelKey || 'Independente',
          promptTypeId: record.promptTypeId || null,
          promptTypeNameSnapshot: record.promptTypeNameSnapshot || record.promptLevelName || null,
          promptCategorySnapshot: record.promptCategorySnapshot || null,
          promptIndependenceScoreSnapshot: record.promptIndependenceScoreSnapshot ?? null,
          promptIntrusivenessOrderSnapshot: record.promptIntrusivenessOrderSnapshot ?? null
        },
        timestamp: record.timestamp,
        trialId: record.id,
        activeProbe: resolvedProbe
      });
      onSessionRecordSaved?.();
    } catch (error) {
      updateRecordStatus(record.id, 'error');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      if (import.meta.env.DEV) console.error('Falha ao persistir conversão da tentativa ABA:', error);
    }
  };

  const convertPreviousTrialToMaintenanceProbe = (recordId: string) => {
    const original = records.find((record) => record.id === recordId);
    if (!original) {
      setPendingMaintenanceProbeTrial(null);
      return;
    }
    const fromCollectionType = normalizeAbaCollectionType(original.collectionType);
    const convertedAt = new Date().toISOString();
    const activeProbe = getActiveMaintenanceProbeForTarget({ id: original.targetId || null, name: original.targetName || original.title });
    const maintenanceScheduleId = String(activeProbe?.scheduleId || '').trim();
    const maintenanceTargetId = String(activeProbe?.targetId || original.targetId || '').trim();
    const convertedRecord: SessionRecord = {
      ...original,
      targetId: maintenanceTargetId || original.targetId || null,
      collectionType: 'maintenance_probe',
      detail: formatAbaTrialHistoryLabel({
        collectionType: 'maintenance_probe',
        outcome: original.trialOutcome || (original.correct ? 'independent' : 'error'),
        score: original.score ?? 0,
        promptLevelKey: original.promptLevelKey,
        promptLevelName: original.promptLevelName
      }),
      syncStatus: 'local',
      editedAt: convertedAt,
      rawPayload: {
        ...(original.rawPayload || {}),
        maintenanceScheduleId: maintenanceScheduleId || undefined,
        maintenance_schedule_id: maintenanceScheduleId || undefined,
        activeMaintenanceProbe: maintenanceScheduleId && maintenanceTargetId ? {
          scheduleId: maintenanceScheduleId,
          targetId: maintenanceTargetId,
          source: activeProbe?.source || 'available'
        } : undefined,
        convertedFromCollectionType: fromCollectionType,
        convertedToCollectionType: 'maintenance_probe',
        convertedAt,
        conversionPreservedOriginalTimestamp: true
      }
    };
    updateRecord(recordId, convertedRecord);
    persistTrialAudit({
      action: 'convert_trial_collection_type',
      recordId,
      targetId: original.targetId || null,
      targetName: original.targetName || original.title || null,
      fromCollectionType,
      toCollectionType: 'maintenance_probe'
    });
    void persistConvertedTrialRecord(convertedRecord, fromCollectionType);
    showClinicalToast({
      variant: 'success',
      title: 'Tentativa convertida',
      subtitle: 'Score, prompt e horário original foram preservados.'
    });
    setPendingMaintenanceProbeTrial(null);
  };

  const resolveAbaV3BindingForGoal = async (goal: any): Promise<AbaV3BindingDecision | null> => {
    const targetId = String(goalTargetId(goal) || '').trim();
    if (!targetId || !sessionId || sessionId.startsWith('draft-')) {
      throw new Error('A coleta V3 exige uma sessão e um target persistidos antes da primeira tentativa.');
    }
    const cacheKey = `${sessionId}:${targetId}`;
    const cached = abaV3BindingCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const pending = abaV3BindingInflightRef.current.get(cacheKey);
    if (pending) return pending;

    const request = (async (): Promise<AbaV3BindingDecision | null> => {
      const result = await dataService.resolveAbaV3SessionTargetBinding({
        patientId,
        sessionId,
        targetId
      });
      if (!result?.success || !result?.data?.measurementModelVersion) {
        throw new Error(result?.error || 'Não foi possível determinar o modelo de coleta deste target.');
      }
      const binding = result.data as AbaV3BindingDecision;
      abaV3BindingCacheRef.current.set(cacheKey, binding);
      return binding;
    })();

    abaV3BindingInflightRef.current.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (abaV3BindingInflightRef.current.get(cacheKey) === request) {
        abaV3BindingInflightRef.current.delete(cacheKey);
      }
    }
  };

  const primeAbaV3BindingForGoal = (goal: any) => {
    if (!goal || !patientId || !sessionId || sessionId.startsWith('draft-') || abaV3SessionPlanStatus !== 'ready') return;
    if (abaV3PlannedModelForGoal(goal) !== 'V3') return;
    void resolveAbaV3BindingForGoal(goal).catch((error: any) => {
      console.warn('[ABA V3] Não foi possível preparar o binding do alvo selecionado:', error?.message || String(error));
      setSessionWarning(error?.message || 'Não foi possível preparar a coleta V3 deste target.');
    });
  };

  const resolveAbaV3BehaviorForAction = async (behavior: any): Promise<AbaV3BehaviorDecision | null> => {
    if (!abaV3UiEnabled) return null;
    const behaviorId = String(behavior?.id || behavior?.behaviorId || behavior?.behavior_id || '').trim();
    if (!behaviorId || !sessionId || sessionId.startsWith('draft-')) {
      throw new Error('A coleta comportamental V3 exige sessão e comportamento persistidos.');
    }
    if (abaV3SessionPlanStatus === 'ready' && !abaV3BehaviorIdSet.has(behaviorId)) return null;
    if (abaV3SessionPlanStatus !== 'ready') {
      throw new Error('O plano de coleta V3 desta sessão ainda não foi confirmado. Tente novamente antes de registrar comportamento.');
    }
    const cacheKey = `${sessionId}:${behaviorId}`;
    const cached = abaV3BehaviorBindingCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const result = await dataService.resolveAbaV3BehaviorCollection({ patientId, sessionId, behaviorId });
    if (!result?.success || !result?.data?.measurementModelVersion) {
      throw new Error(result?.error || 'Não foi possível determinar o modelo de coleta deste comportamento.');
    }
    const decision = result.data as AbaV3BehaviorDecision;
    abaV3BehaviorBindingCacheRef.current.set(cacheKey, decision);
    return decision;
  };

  const persistAbaV3BehaviorPayload = async (payload: any, behaviorDecision: AbaV3BehaviorDecision) => {
    if (behaviorDecision.measurementModelVersion !== 'V3') return null;
    const behaviorId = String(payload?.behavior_id || payload?.behaviorId || behaviorDecision.behaviorId || '').trim();
    const measurementType = String(payload?.measurement_type || payload?.measurementType || payload?.method || '').trim().toLowerCase();
    const startedAt = String(payload?.started_at || payload?.startedAt || payload?.timestamp || new Date().toISOString());
    const endedAt = String(payload?.ended_at || payload?.endedAt || '').trim();
    if (measurementType === 'abc') {
      throw new Error('ABC ainda não possui modelo V3 próprio. Esta coleta foi bloqueada para não cair no Legacy por engano.');
    }
    let actionType = '';
    let clientEventId = String(payload?.id || crypto.randomUUID());
    let episodeEventId: string | undefined;
    let occurredAt = String(payload?.timestamp || payload?.occurred_at || payload?.occurredAt || new Date().toISOString());
    if (measurementType === 'frequency') actionType = 'FREQUENCY';
    else if (measurementType === 'rate') actionType = 'RATE_OCCURRENCE';
    else if (measurementType === 'duration' && !endedAt) {
      actionType = 'DURATION_START';
      occurredAt = startedAt;
    } else if (measurementType === 'duration' && endedAt) {
      actionType = 'DURATION_STOP';
      episodeEventId = String(payload?.id || '').trim();
      clientEventId = crypto.randomUUID();
      occurredAt = endedAt;
    } else {
      throw new Error('Este método comportamental ainda não possui escrita V3 por evento.');
    }
    return await dataService.saveAbaV3BehaviorAction({
      patientId,
      sessionId,
      behaviorId,
      actionType,
      clientEventId,
      episodeEventId,
      causalEntityId: measurementType === 'rate'
        ? String(payload?.raw_payload?.rateWindowId || payload?.rawPayload?.rateWindowId || episodeEventId || clientEventId)
        : (episodeEventId || clientEventId),
      occurredAt,
      countDelta: payload?.count_delta ?? payload?.countDelta ?? 1,
      metadata: {
        source: 'session_mode_v3',
        targetId: behaviorDecision.targetId || null,
        location: payload?.location || undefined,
        severity: payload?.severity ?? undefined,
        contextSnapshot: payload?.contextSnapshot || payload?.raw_payload?.contextSnapshot || undefined
      }
    });
  };

  const openAbaV3TaskAnalysis = async (goal: any) => {
    if (!abaV3UiEnabled || goalTargetType(goal) !== 'task_analysis') return false;
    const binding = await resolveAbaV3BindingForGoal(goal);
    if (binding?.measurementModelVersion !== 'V3') return false;
    const targetId = goalTargetId(goal);
    const result = await dataService.getAbaV3TaskAnalysisDefinition({ patientId, sessionId, targetId });
    if (!result?.success || result?.data?.measurementModelVersion !== 'V3' || !Array.isArray(result?.data?.steps) || result.data.steps.length === 0) {
      throw new Error(result?.error || 'A definição V3 da análise de tarefa ainda não está pronta.');
    }
    const steps = result.data.steps as AbaV3TaskAnalysisStep[];
    setAbaV3TaskAnalysisResults(Object.fromEntries(steps.map((step) => [Number(step.sequence_no), { performanceCode: 'NOT_OBSERVED', promptKey: null }])));
    setAbaV3TaskAnalysisModal({ goal, targetId, steps, startedAt: new Date().toISOString() });
    return true;
  };

  const saveAbaV3TaskAnalysis = async () => {
    const modal = abaV3TaskAnalysisModal;
    if (!modal || abaV3TaskAnalysisSaving) return;
    setAbaV3TaskAnalysisSaving(true);
    const completedAt = new Date().toISOString();
    const clientEventId = crypto.randomUUID();
    try {
      const results = modal.steps.map((step) => {
        const value = abaV3TaskAnalysisResults[Number(step.sequence_no)] || { performanceCode: 'NOT_OBSERVED', promptKey: null };
        return {
          sequence_no: Number(step.sequence_no),
          performance_code: value.performanceCode,
          prompt_key: value.performanceCode === 'PROMPTED' ? value.promptKey || null : null,
          occurred_at: completedAt,
          metadata: {}
        };
      });
      if (results.some((row) => row.performance_code === 'PROMPTED' && !row.prompt_key)) {
        throw new Error('Selecione o tipo de ajuda em todos os passos marcados como Com ajuda.');
      }
      const result = await dataService.saveAbaV3TaskAnalysisRun({
        patientId,
        sessionId,
        targetId: modal.targetId,
        clientEventId,
        occurredAt: modal.startedAt,
        completedAt,
        lifecycleStatus: 'COMPLETE',
        results,
        metadata: { source: 'session_mode_v3' }
      });
      if (!result?.success) throw new Error(result?.error || 'Não foi possível salvar a análise de tarefa V3.');
      const observed = results.filter((row) => !['NOT_OBSERVED','NOT_APPLICABLE'].includes(row.performance_code)).length;
      addRecord({
        id: `task-v3-${clientEventId}`,
        kind: 'trial',
        title: goalTargetName(modal.goal) || 'Análise de tarefa',
        detail: `Análise de tarefa · ${observed}/${results.length} passo(s) observados`,
        timestamp: completedAt,
        targetId: modal.targetId,
        targetName: goalTargetName(modal.goal) || null,
        programId: modal.goal?.programId || modal.goal?.program_id || null,
        therapistId: resolvedTherapistId || null,
        measurementModelVersion: 'V3',
        collectionType: 'task_analysis',
        score: null,
        rawPayload: { clientEventId, taskAnalysis: true, results }
      }, result?.pending ? 'local' : 'synced');
      setTrialCount((prev) => prev + 1);
      setAbaV3TaskAnalysisModal(null);
      setAbaV3TaskAnalysisResults({});
      showClinicalToast({ variant: result?.pending ? 'info' : 'success', title: result?.pending ? 'Análise preservada para sincronização' : 'Análise de tarefa registrada', subtitle: `${observed}/${results.length} passo(s) observados` });
      onSessionRecordSaved?.();
    } catch (error: any) {
      setSessionWarning(error?.message || 'Não foi possível salvar a análise de tarefa V3.');
      showClinicalToast({ variant: 'error', title: 'Não foi possível salvar', subtitle: error?.message || 'Revise a análise de tarefa e tente novamente.' }, 'error');
    } finally {
      setAbaV3TaskAnalysisSaving(false);
    }
  };

  const persistV3TrialRecord = async ({
    goal,
    actionKey,
    selectedPrompt,
    activeCollectionType,
    activeMaintenanceProbe
  }: {
    goal: any;
    actionKey: AbaV3TrialActionKey;
    selectedPrompt: any;
    activeCollectionType: string;
    activeMaintenanceProbe?: ActiveMaintenanceProbeForTarget | null;
  }) => {
    const timestamp = new Date().toISOString();
    const normalizedCollectionType = normalizeAbaCollectionType(activeCollectionType);
    const isMaintenanceAttempt = isMaintenanceProbeCollection(normalizedCollectionType);
    const resolvedMaintenanceProbe = isMaintenanceAttempt
      ? activeMaintenanceProbe || getActiveMaintenanceProbeForTarget(goal)
      : null;
    const recordTargetId = String(resolvedMaintenanceProbe?.targetId || goalTargetId(goal)).trim();
    const maintenanceScheduleId = String(resolvedMaintenanceProbe?.scheduleId || activeMaintenanceScheduleId || '').trim();
    if (!recordTargetId || sessionId.startsWith('draft-')) {
      throw new Error('A coleta V3 exige target e sessão persistidos.');
    }
    if (isMaintenanceAttempt && (!resolvedMaintenanceProbe || !maintenanceScheduleId)) {
      throw new Error('Sondagem de manutenção V3 exige uma agenda ativa vinculada.');
    }

    const trialLockKey = `trial-v3:${recordTargetId}:${actionKey}:${selectedPrompt?.key || 'none'}`;
    if (!lockAction(trialLockKey, 600)) return;
    const clientEventId = crypto.randomUUID();
    const localRecordId = `trial-v3-${clientEventId}`;
    const actionLabel = abaV3ActionDisplayLabel(actionKey);
    const collectionLabel = getAbaCollectionLabel(normalizedCollectionType);
    const isIndependentCorrect = actionKey === 'INDEPENDENT_CORRECT';
    const isPromptedCorrect = actionKey === 'PROMPTED_CORRECT';
    const isCorrect = isIndependentCorrect || isPromptedCorrect;
    const localOutcome: 'independent' | 'prompted' | 'error' = isIndependentCorrect
      ? 'independent'
      : isPromptedCorrect
        ? 'prompted'
        : 'error';

    addRecord({
      id: localRecordId,
      kind: 'trial',
      title: goal.name,
      detail: `${collectionLabel} · ${actionLabel}${isPromptedCorrect && selectedPrompt?.label ? ` · ${selectedPrompt.label}` : ''}`,
      timestamp,
      targetId: recordTargetId,
      targetName: goal?.name || null,
      programId: goal?.programId || goal?.program_id || goal?.protocolId || null,
      therapistId: resolvedTherapistId || null,
      trialOutcome: localOutcome,
      measurementModelVersion: 'V3',
      v3ActionKey: actionKey,
      collectionType: normalizedCollectionType,
      promptTypeId: isPromptedCorrect ? selectedPrompt?.id || null : null,
      promptTypeNameSnapshot: isPromptedCorrect ? selectedPrompt?.label || selectedPrompt?.name || null : null,
      promptCategorySnapshot: isPromptedCorrect ? selectedPrompt?.category || null : null,
      promptIntrusivenessOrderSnapshot: isPromptedCorrect ? selectedPrompt?.intrusivenessOrder ?? null : null,
      promptLevelKey: isPromptedCorrect ? selectedPrompt?.key || '' : isIndependentCorrect ? 'independent' : 'error',
      promptLevelName: isPromptedCorrect ? selectedPrompt?.label || '' : actionLabel,
      score: null,
      correct: isCorrect,
      independent: isIndependentCorrect,
      rawPayload: {
        source: 'session_mode_v3',
        measurementModelVersion: 'V3',
        v3ActionKey: actionKey,
        clientEventId,
        maintenanceScheduleId: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
        activeMaintenanceProbe: isMaintenanceAttempt ? {
          scheduleId: maintenanceScheduleId,
          targetId: recordTargetId,
          source: resolvedMaintenanceProbe?.source || 'available'
        } : undefined
      }
    });
    triggerMicroFeedback(trialLockKey, 'check');
    updateRecordStatus(localRecordId, 'syncing');

    try {
      const result = await dataService.saveAbaV3TrialAction({
        patientId,
        sessionId,
        targetId: recordTargetId,
        clientEventId,
        actionKey,
        promptTypeId: isPromptedCorrect ? selectedPrompt?.id || null : null,
        promptKey: isPromptedCorrect ? selectedPrompt?.key || null : null,
        trialType: normalizedCollectionType,
        occurredAt: timestamp,
        maintenanceScheduleId: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
        clientMetadata: { source: 'session_mode_v3' }
      });
      if (!result?.success) {
        updateRecord(localRecordId, {
          syncStatus: 'error',
          syncErrorCode: result?.code || null,
          syncErrorMessage: result?.error || 'Não foi possível persistir a tentativa V3.',
          rawPayload: {
            source: 'session_mode_v3',
            measurementModelVersion: 'V3',
            v3ActionKey: actionKey,
            clientEventId,
            maintenanceScheduleId: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
            serverRejected: !result?.pending,
            syncErrorCode: result?.code || null,
            syncErrorStatus: result?.status || null
          }
        });
        setSessionWarning(result?.error || 'Não foi possível persistir a tentativa V3.');
        showClinicalToast({ variant: 'error', title: 'Tentativa não gravada', subtitle: result?.error || 'Revise o registro e tente novamente.' }, 'error');
        return;
      }
      setTrialCount((prev) => prev + 1);
      updateRecord(localRecordId, {
        syncStatus: result?.pending ? 'local' : 'synced',
        v3TrialId: result?.data?.trialId || null,
        syncErrorCode: null,
        syncErrorMessage: null,
        rawPayload: {
          source: 'session_mode_v3',
          measurementModelVersion: 'V3',
          v3ActionKey: actionKey,
          clientEventId,
          serverTrialId: result?.data?.trialId || null,
          maintenanceScheduleId: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
          activeMaintenanceProbe: isMaintenanceAttempt ? {
            scheduleId: maintenanceScheduleId,
            targetId: recordTargetId,
            source: resolvedMaintenanceProbe?.source || 'available'
          } : undefined
        }
      });
      showClinicalToast({
        variant: result?.pending ? 'info' : 'success',
        title: result?.pending ? 'Tentativa preservada para sincronização' : 'Tentativa V3 registrada',
        subtitle: `${collectionLabel} · ${actionLabel}${isPromptedCorrect && selectedPrompt?.label ? ` · ${selectedPrompt.label}` : ''}`
      });
      if (isMaintenanceAttempt) {
        if (recordTargetId) clearManualMaintenanceProbeTarget(recordTargetId);
        setActiveMaintenanceProbeTargetId(null);
        setActiveMaintenanceScheduleId(null);
        setExpandedMaintenanceProbeTargetId(null);
        setCollectionType(lastRegularTrialType || 'dtt');
      }
      onSessionRecordSaved?.();
    } catch (error: any) {
      updateRecordStatus(localRecordId, 'error');
      setSessionWarning(error?.message || 'Não foi possível persistir a tentativa V3.');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      console.error('Falha ao persistir tentativa ABA V3:', error);
    }
  };

  const retryFailedV3Trial = async (record: SessionRecord) => {
    if (record.measurementModelVersion !== 'V3' || record.syncStatus !== 'error') return;
    const clientEventId = String(record.rawPayload?.clientEventId || '').trim();
    const actionKey = record.v3ActionKey || record.rawPayload?.v3ActionKey;
    if (!clientEventId || !actionKey || !record.targetId) {
      showClinicalToast({ variant: 'error', title: 'Tentativa não pode ser reenviada', subtitle: 'O registro local não possui identidade clínica suficiente para um retry seguro.' }, 'error');
      return;
    }
    const retryLockKey = `retry-v3:${clientEventId}`;
    if (!lockAction(retryLockKey, 0)) return;
    updateRecordStatus(record.id, 'syncing');
    try {
      const result = await dataService.saveAbaV3TrialAction({
        patientId,
        sessionId,
        targetId: record.targetId,
        clientEventId,
        actionKey,
        promptTypeId: actionKey === 'PROMPTED_CORRECT' ? record.promptTypeId || null : null,
        promptKey: actionKey === 'PROMPTED_CORRECT' ? record.promptLevelKey || null : null,
        trialType: normalizeAbaCollectionType(record.collectionType),
        occurredAt: record.timestamp,
        maintenanceScheduleId: record.rawPayload?.maintenanceScheduleId || undefined,
        clientMetadata: { source: 'session_mode_v3_retry' }
      });
      if (!result?.success) {
        updateRecord(record.id, {
          syncStatus: 'error',
          syncErrorCode: result?.code || null,
          syncErrorMessage: result?.error || 'Não foi possível reenviar a tentativa V3.'
        });
        showClinicalToast({ variant: 'error', title: 'Tentativa continua não gravada', subtitle: result?.error || 'Revise a configuração e tente novamente.' }, 'error');
        return;
      }
      await dataService.discardAbaV3FailedTrial(clientEventId);
      updateRecord(record.id, {
        syncStatus: result?.pending ? 'local' : 'synced',
        v3TrialId: result?.data?.trialId || record.v3TrialId || null,
        syncErrorCode: null,
        syncErrorMessage: null,
        rawPayload: {
          ...(record.rawPayload || {}),
          serverRejected: false,
          serverTrialId: result?.data?.trialId || record.rawPayload?.serverTrialId || null,
          syncErrorCode: null,
          syncErrorStatus: null
        }
      });
      setTrialCount((prev) => prev + 1);
      showClinicalToast({
        variant: result?.pending ? 'info' : 'success',
        title: result?.pending ? 'Tentativa preservada para sincronização' : 'Tentativa recuperada',
        subtitle: result?.pending ? 'O registro continuará pendente até a conexão confirmar a gravação.' : 'A tentativa foi gravada no ABA V3 e não bloqueia mais o encerramento.'
      });
      onSessionRecordSaved?.();
    } catch (error: any) {
      updateRecord(record.id, { syncStatus: 'error', syncErrorMessage: error?.message || 'Falha ao reenviar a tentativa V3.' });
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
    } finally {
      releaseActionLock(retryLockKey);
    }
  };

  const discardFailedV3Trial = async (record: SessionRecord) => {
    if (record.measurementModelVersion !== 'V3' || record.syncStatus !== 'error') return;
    const clientEventId = String(record.rawPayload?.clientEventId || '').trim();
    const confirmed = window.confirm('Descartar esta tentativa que NÃO foi gravada no servidor? Nenhum dado clínico persistido será apagado.');
    if (!confirmed) return;
    try {
      if (clientEventId) await dataService.discardAbaV3FailedTrial(clientEventId);
      setRecords((prev) => prev.filter((item) => item.id !== record.id));
      showClinicalToast({ variant: 'info', title: 'Tentativa não gravada descartada', subtitle: 'Somente o erro local foi removido; nenhum evento clínico persistido foi apagado.' }, 'none');
    } catch (error: any) {
      showClinicalToast({ variant: 'error', title: 'Não foi possível descartar', subtitle: error?.message || 'Tente novamente.' }, 'error');
    }
  };

  const inferV3ActionKeyFromRecord = (record: SessionRecord): AbaV3TrialActionKey => {
    if (record.v3ActionKey) return record.v3ActionKey;
    if (record.trialOutcome === 'prompted') return 'PROMPTED_CORRECT';
    if (record.independent && record.correct) return 'INDEPENDENT_CORRECT';
    if (record.correct === false) return 'INDEPENDENT_INCORRECT';
    return 'NO_RESPONSE';
  };

  const openV3Revision = (record: SessionRecord, mode: 'CORRECT' | 'VOID') => {
    if (record.measurementModelVersion !== 'V3' || record.syncStatus !== 'synced') {
      showClinicalToast({ variant: 'info', title: 'Resolva a sincronização primeiro', subtitle: 'Registros ainda não confirmados pelo servidor não podem receber uma revisão clínica.' }, 'none');
      return;
    }
    const actionKey = inferV3ActionKeyFromRecord(record);
    setAbaV3RevisionRecord(record);
    setAbaV3RevisionMode(mode);
    setAbaV3RevisionActionKey(actionKey);
    setAbaV3RevisionPromptKey(actionKey === 'PROMPTED_CORRECT' ? String(record.promptLevelKey || '') : '');
    setAbaV3RevisionReason('');
  };

  const closeV3Revision = () => {
    setAbaV3RevisionRecord(null);
    setAbaV3RevisionReason('');
    setAbaV3RevisionPromptKey('');
  };

  const finalizeSuccessfulV3Revision = (record: SessionRecord, revision: any, result: any) => {
    if (revision.eventType === 'VOID') {
      setRecords((prev) => prev.filter((item) => item.id !== record.id));
      setTrialCount((prev) => Math.max(0, prev - 1));
      return;
    }
    const selectedPrompt = revision.actionKey === 'PROMPTED_CORRECT'
      ? v3PromptedPromptOptions.find((prompt) => prompt.key === revision.promptKey)
      : null;
    const actionLabel = abaV3ActionDisplayLabel(revision.actionKey);
    const collectionLabel = getAbaCollectionLabel(normalizeAbaCollectionType(record.collectionType));
    const isIndependentCorrect = revision.actionKey === 'INDEPENDENT_CORRECT';
    const isPromptedCorrect = revision.actionKey === 'PROMPTED_CORRECT';
    updateRecord(record.id, {
      detail: `${collectionLabel} · ${actionLabel}${selectedPrompt?.label ? ` · ${selectedPrompt.label}` : ''}`,
      trialOutcome: isIndependentCorrect ? 'independent' : isPromptedCorrect ? 'prompted' : 'error',
      v3ActionKey: revision.actionKey,
      v3TrialId: result?.data?.replacementTrialId || record.v3TrialId || null,
      promptTypeId: isPromptedCorrect ? selectedPrompt?.id || null : null,
      promptTypeNameSnapshot: isPromptedCorrect ? selectedPrompt?.label || selectedPrompt?.name || null : null,
      promptCategorySnapshot: isPromptedCorrect ? selectedPrompt?.category || null : null,
      promptIntrusivenessOrderSnapshot: isPromptedCorrect ? selectedPrompt?.intrusivenessOrder ?? null : null,
      promptLevelKey: isPromptedCorrect ? selectedPrompt?.key || '' : isIndependentCorrect ? 'independent' : 'error',
      promptLevelName: isPromptedCorrect ? selectedPrompt?.label || '' : actionLabel,
      correct: isIndependentCorrect || isPromptedCorrect,
      independent: isIndependentCorrect,
      syncStatus: 'synced',
      editedAt: new Date().toISOString(),
      rawPayload: {
        ...(record.rawPayload || {}),
        clientEventId: result?.data?.replacementClientEventId || revision.replacementClientEventId || record.rawPayload?.clientEventId,
        serverTrialId: result?.data?.replacementTrialId || record.rawPayload?.serverTrialId || null,
        correctedFromTrialId: result?.data?.originalTrialId || record.v3TrialId || null,
        lastRevisionId: result?.data?.revisionId || null,
        lastRevisionReason: revision.reason || null,
        lastRevisionEventType: revision.eventType || null,
        lastRevisionAt: result?.data?.occurredAt || new Date().toISOString(),
        pendingV3Revision: undefined
      }
    });
  };

  const submitV3Revision = async (record: SessionRecord, revision: any) => {
    updateRecordStatus(record.id, 'syncing');
    const selectedPrompt = revision.actionKey === 'PROMPTED_CORRECT'
      ? v3PromptedPromptOptions.find((prompt) => prompt.key === revision.promptKey)
      : null;
    const result = await dataService.saveAbaV3TrialRevision({
      patientId,
      sessionId,
      originalTrialId: record.v3TrialId || record.rawPayload?.serverTrialId || undefined,
      originalClientEventId: record.rawPayload?.clientEventId || undefined,
      eventType: revision.eventType,
      clientRevisionEventId: revision.clientRevisionEventId,
      replacementClientEventId: revision.replacementClientEventId,
      reason: revision.reason,
      actionKey: revision.eventType === 'CORRECT' ? revision.actionKey : undefined,
      promptTypeId: revision.eventType === 'CORRECT' && revision.actionKey === 'PROMPTED_CORRECT' ? selectedPrompt?.id || undefined : undefined,
      promptKey: revision.eventType === 'CORRECT' && revision.actionKey === 'PROMPTED_CORRECT' ? selectedPrompt?.key || undefined : undefined,
      clientMetadata: { source: 'session_mode_v3_revision' }
    });
    if (!result?.success) {
      updateRecord(record.id, { syncStatus: 'synced' });
      showClinicalToast({ variant: 'error', title: 'Revisão não aplicada', subtitle: result?.error || 'O registro original permanece intacto.' }, 'error');
      return result;
    }
    if (result?.pending) {
      updateRecord(record.id, {
        syncStatus: 'local',
        rawPayload: { ...(record.rawPayload || {}), pendingV3Revision: revision }
      });
      showClinicalToast({ variant: 'info', title: 'Revisão preservada para sincronização', subtitle: 'O registro original continuará visível até o servidor confirmar a revisão.' });
      return result;
    }
    finalizeSuccessfulV3Revision(record, revision, result);
    showClinicalToast({
      variant: 'success',
      title: revision.eventType === 'VOID' ? 'Registro apagado da visão clínica' : 'Registro corrigido',
      subtitle: revision.eventType === 'VOID'
        ? 'O evento original foi preservado no histórico de auditoria e marcado como anulado.'
        : 'A correção foi gravada como uma nova versão auditável, sem reescrever o evento original.'
    });
    onSessionRecordSaved?.();
    return result;
  };

  const retryPendingV3Revision = async (record: SessionRecord) => {
    const revision = record.rawPayload?.pendingV3Revision;
    if (!revision) return;
    const retryLockKey = `revision-v3:${revision.clientRevisionEventId || record.id}`;
    if (!lockAction(retryLockKey, 0)) return;
    try {
      await submitV3Revision(record, revision);
    } finally {
      releaseActionLock(retryLockKey);
    }
  };

  const saveV3Revision = async () => {
    const record = abaV3RevisionRecord;
    if (!record || abaV3RevisionSaving) return;
    const reason = abaV3RevisionReason.trim();
    if (reason.length < 3) {
      showClinicalToast({ variant: 'info', title: 'Informe o motivo', subtitle: 'A revisão clínica precisa de um motivo com pelo menos 3 caracteres.' }, 'none');
      return;
    }
    if (abaV3RevisionMode === 'CORRECT' && abaV3RevisionActionKey === 'PROMPTED_CORRECT' && !abaV3RevisionPromptKey) {
      showClinicalToast({ variant: 'info', title: 'Selecione o tipo de ajuda', subtitle: 'A correção com ajuda precisa apontar para um tipo persistido no catálogo V3.' }, 'none');
      return;
    }
    setAbaV3RevisionSaving(true);
    const revision = {
      eventType: abaV3RevisionMode,
      actionKey: abaV3RevisionActionKey,
      promptKey: abaV3RevisionPromptKey,
      reason,
      clientRevisionEventId: crypto.randomUUID(),
      replacementClientEventId: abaV3RevisionMode === 'CORRECT' ? crypto.randomUUID() : undefined
    };
    try {
      const result = await submitV3Revision(record, revision);
      if (result?.success) closeV3Revision();
    } catch (error: any) {
      updateRecord(record.id, { syncStatus: 'synced' });
      showClinicalToast({ variant: 'error', title: 'Não foi possível revisar o registro', subtitle: error?.message || 'O registro original permanece intacto.' }, 'error');
    } finally {
      setAbaV3RevisionSaving(false);
    }
  };

  const continueResolvedTrial = async ({
    goal,
    score,
    outcome,
    selectedPrompt,
    activeCollectionType,
    activeMaintenanceProbe,
    binding,
    v3ActionKey
  }: {
    goal: any;
    score: number;
    outcome: 'independent' | 'prompted' | 'error';
    selectedPrompt: any;
    activeCollectionType: string;
    activeMaintenanceProbe?: ActiveMaintenanceProbeForTarget | null;
    binding: AbaV3BindingDecision | null;
    v3ActionKey?: AbaV3TrialActionKey;
  }) => {
    const plannedModel = abaV3PlannedModelForGoal(goal);
    if (plannedModel === 'V3_BLOCKED') {
      throw new Error('A coleta V3 deste target está bloqueada por configuração incompleta. Nenhuma tentativa Legacy foi gravada.');
    }
    if (plannedModel === 'V3' && binding?.measurementModelVersion !== 'V3') {
      throw new Error('Proteção ABA V3: o target foi planejado como V3, mas o binding V3 não foi confirmado. Nenhuma tentativa Legacy foi gravada.');
    }
    if (isMaintenanceProbeCollection(activeCollectionType)) {
      const previousTrial = findPreviousTrainingTrialForGoal(goal);
      if (previousTrial) {
        setPendingMaintenanceProbeTrial({
          goal,
          score,
          outcome,
          selectedPrompt,
          previousRecordId: previousTrial.id,
          measurementModelVersion: binding?.measurementModelVersion || 'LEGACY_V2',
          v3ActionKey,
          activeMaintenanceProbe
        });
        return;
      }
    }
    if (binding?.measurementModelVersion === 'V3') {
      if (!v3ActionKey) throw new Error('A ação clínica V3 não foi definida.');
      await persistV3TrialRecord({ goal, actionKey: v3ActionKey, selectedPrompt, activeCollectionType, activeMaintenanceProbe });
      return;
    }
    await persistTrialRecord({ goal, score, outcome, selectedPrompt, activeCollectionType, activeMaintenanceProbe });
  };

  const persistTrialRecord = async ({
    goal,
    score,
    outcome,
    selectedPrompt,
    activeCollectionType,
    activeMaintenanceProbe
  }: {
    goal: any;
    score: number;
    outcome: 'independent' | 'prompted' | 'error';
    selectedPrompt: any;
    activeCollectionType: string;
    activeMaintenanceProbe?: ActiveMaintenanceProbeForTarget | null;
  }) => {
    if (isGoalPlannedForV3Ui(goal)) {
      throw new Error('Proteção ABA V3: persistência Legacy bloqueada para target planejado como V3.');
    }
    const maxScore = Number(goal?.maxScore || 1);
    const timestamp = new Date().toISOString();
    const normalizedCollectionType = normalizeAbaCollectionType(activeCollectionType);
    const isMaintenanceAttempt = isMaintenanceProbeCollection(normalizedCollectionType);
    const resolvedMaintenanceProbe = isMaintenanceAttempt
      ? activeMaintenanceProbe || getActiveMaintenanceProbeForTarget(goal)
      : null;
    const recordTargetId = String(resolvedMaintenanceProbe?.targetId || goalTargetId(goal)).trim();
    const maintenanceScheduleId = String(resolvedMaintenanceProbe?.scheduleId || activeMaintenanceScheduleId || '').trim();
    if (isMaintenanceAttempt && (
      !resolvedMaintenanceProbe ||
      !isRealClinicalId(recordTargetId) ||
      !isRealClinicalId(maintenanceScheduleId) ||
      sessionId.startsWith('draft-') ||
      !canRecordInAbaSession({ sessionCompleted, status: activeSession?.status })
    )) {
      setSessionWarning('Nao foi possivel registrar sondagem de manutencao sem meta e agenda reais na sessao ativa.');
      showClinicalToast({
        variant: 'error',
        title: 'Nao foi possivel ativar a sondagem de manutencao.',
        subtitle: 'A sondagem precisa estar disponivel nesta sessao antes da tentativa.'
      }, 'error');
      return;
    }
    const trialLockKey = `trial:${String(recordTargetId || goal?.name || 'goal')}:${outcome}:${selectedPrompt.key}`;
    if (!lockAction(trialLockKey, 600)) return;
    const isCorrect = outcome !== 'error' && score > 0;
    const isIndependent = outcome === 'independent';
    const trialId = `trial-${crypto.randomUUID()}`;
    const collectionLabel = getAbaCollectionLabel(normalizedCollectionType);
    const promptSnapshot = buildSessionPromptSnapshot(selectedPrompt);

    addRecord({
      id: trialId,
      kind: 'trial',
      title: goal.name,
      detail: formatAbaTrialHistoryLabel({
        collectionType: normalizedCollectionType,
        outcome,
        score,
        promptLevelKey: selectedPrompt.key,
        promptLevelName: selectedPrompt.label
      }),
      timestamp,
      targetId: recordTargetId || null,
      targetName: goal?.name || null,
      programId: goal?.programId || goal?.program_id || goal?.protocolId || null,
      therapistId: resolvedTherapistId || null,
      trialOutcome: outcome,
      collectionType: normalizedCollectionType,
      promptTypeId: promptSnapshot.promptTypeId,
      promptTypeNameSnapshot: promptSnapshot.promptTypeNameSnapshot,
      promptCategorySnapshot: promptSnapshot.promptCategorySnapshot,
      promptIndependenceScoreSnapshot: promptSnapshot.promptIndependenceScoreSnapshot,
      promptIntrusivenessOrderSnapshot: promptSnapshot.promptIntrusivenessOrderSnapshot,
      promptLevelKey: selectedPrompt.key,
      promptLevelName: selectedPrompt.label,
      score,
      correct: isCorrect,
      independent: isIndependent,
      rawPayload: {
        source: 'session_mode_trial',
        clientTrialId: trialId,
        targetMaxScore: maxScore,
        ...promptSnapshot,
        sessionReferenceDate: activeSession?.referenceDate || timestamp.slice(0, 10),
        maintenanceScheduleId: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
        maintenance_schedule_id: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
        activeMaintenanceProbe: isMaintenanceAttempt ? {
          scheduleId: maintenanceScheduleId,
          targetId: recordTargetId,
          source: resolvedMaintenanceProbe?.source || 'available'
        } : undefined
      }
    });
    triggerMicroFeedback(trialLockKey, 'check');
    showClinicalToast(buildClinicalActionToast({
      action: 'trial',
      outcome,
      collectionLabel,
      promptLabel: selectedPrompt.label,
      score
    }));
    updateRecordStatus(trialId, 'syncing');

    try {
      await Promise.resolve(onRecordTrial(patient.id, goal.name, score, '', {
        sessionId,
        sessionStartedAt: activeSession?.startedAt || timestamp,
        sessionReferenceDate: activeSession?.referenceDate || timestamp.slice(0, 10),
        targetId: recordTargetId || undefined,
        targetMaxScore: maxScore,
        protocolId: goal?.protocolId || null,
        protocolTitle: goal?.protocolTitle || null,
        domainId: goal?.domainId || null,
        domainName: goal?.domainName || null,
        trialId,
        maintenance_schedule_id: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
        maintenanceScheduleId: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
        schedule_id: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
        scheduleId: isMaintenanceAttempt ? maintenanceScheduleId : undefined,
        activeMaintenanceProbe: isMaintenanceAttempt ? {
          scheduleId: maintenanceScheduleId,
          targetId: recordTargetId,
          targetName: goalTargetName(goal) || null,
          source: resolvedMaintenanceProbe?.source || 'available'
        } : undefined,
        collectionType: normalizedCollectionType,
        trialType: normalizedCollectionType,
        promptLevelKey: selectedPrompt.key,
        promptLevelName: selectedPrompt.label,
        promptLevel: selectedPrompt.key,
        ...promptSnapshot,
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
      if (isMaintenanceProbeCollection(normalizedCollectionType)) {
        await persistMaintenanceProbeResultForTrial({
          goal,
          score,
          outcome,
          selectedPrompt,
          timestamp,
          trialId,
          activeProbe: resolvedMaintenanceProbe || null
        });
        if (recordTargetId) clearManualMaintenanceProbeTarget(recordTargetId);
        setActiveMaintenanceProbeTargetId(null);
        setActiveMaintenanceScheduleId(null);
        setExpandedMaintenanceProbeTargetId(null);
        setCollectionType(lastRegularTrialType || 'dtt');
      }
      onSessionRecordSaved?.();
    } catch (error) {
      updateRecordStatus(trialId, 'error');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
      console.error('Falha ao persistir tentativa ABA:', error);
    }
  };

  const handleTrialClick = async (goal: any, score: number, outcome: 'independent' | 'prompted' | 'error', promptedPromptKey?: string) => {
    if (!ensureSessionCanRecord()) return;
    if (!sessionId.startsWith('draft-') && (abaV3SessionPlanStatus === 'idle' || abaV3SessionPlanStatus === 'loading')) {
      setSessionWarning('Validando o modelo de coleta desta sessão. Tente novamente em instantes.');
      showClinicalToast({
        variant: 'info',
        title: 'Validando coleta clínica',
        subtitle: 'A Verto está confirmando se este alvo usa ABA V2 ou V3 antes de gravar.'
      });
      return;
    }
    const goalPromptedPromptOptions = promptedPromptOptionsForGoal(goal);
    const goalPromptedPromptKeySet = new Set(goalPromptedPromptOptions.map((prompt) => prompt.key));
    const selectedPrompt = outcome === 'independent'
      ? { ...resolveTrialPromptInfo({ promptLevelKey: 'independent' }, clinicPromptTypes), compactLabel: 'Independente' }
      : outcome === 'error'
        ? { ...resolveTrialPromptInfo({ promptLevelKey: 'error' }, clinicPromptTypes), compactLabel: 'Erro' }
        : goalPromptedPromptOptions.find((prompt) => prompt.key === (promptedPromptKey || promptLevelKey)) ||
          { ...resolveTrialPromptInfo({ promptLevelKey: promptedPromptKey || promptLevelKey }, clinicPromptTypes), compactLabel: 'Com ajuda' };
    if (outcome === 'prompted' && !goalPromptedPromptKeySet.has(selectedPrompt.key)) {
      setPromptWarning('Selecione visual, gestual, verbal, modelo, física parcial ou física total antes de salvar.');
      setPromptSelectionGoal(goal);
      return;
    }
    setPromptWarning('');
    const trialContext = syncTrialTypeForGoal(goal);
    const activeCollectionType = normalizeAbaCollectionType(trialContext.collectionType);

    let binding: AbaV3BindingDecision | null = null;
    const plannedModel = abaV3PlannedModelForGoal(goal);
    if (abaV3UiEnabled || Boolean(plannedModel)) {
      if (abaV3SessionPlanStatus === 'ready' && plannedModel === 'V3_BLOCKED') {
        setSessionWarning('Este target está selecionado para V3, mas a configuração clínica não está completa. Nenhuma tentativa foi gravada.');
        showClinicalToast({ variant: 'error', title: 'Coleta V3 bloqueada', subtitle: 'Revise definição, fase e passos antes de coletar.' }, 'error');
        return;
      }
      const mustResolveBinding = abaV3SessionPlanStatus !== 'ready' || plannedModel === 'V3' || plannedModel === 'EMERGENCY_LEGACY_BRIDGE';
      if (mustResolveBinding) {
        try {
          binding = await resolveAbaV3BindingForGoal(goal);
        } catch (error: any) {
          setSessionWarning(error?.message || 'Não foi possível determinar o modelo de coleta deste target.');
          showClinicalToast(buildClinicalSaveErrorToast(), 'error');
          return;
        }
      }
    }

    if (binding?.measurementModelVersion === 'V3' && goalTargetType(goal) === 'task_analysis') {
      try {
        await openAbaV3TaskAnalysis(goal);
      } catch (error: any) {
        setSessionWarning(error?.message || 'Não foi possível abrir a análise de tarefa V3.');
        showClinicalToast({ variant: 'error', title: 'Análise de tarefa indisponível', subtitle: error?.message || 'Revise a configuração do target.' }, 'error');
      }
      return;
    }

    if (binding?.measurementModelVersion === 'V3' && outcome === 'error') {
      setAbaV3ErrorSelection({
        goal,
        selectedPrompt,
        activeCollectionType,
        activeMaintenanceProbe: trialContext.activeProbe,
        binding
      });
      return;
    }

    const v3ActionKey: AbaV3TrialActionKey | undefined = binding?.measurementModelVersion === 'V3'
      ? outcome === 'independent'
        ? 'INDEPENDENT_CORRECT'
        : 'PROMPTED_CORRECT'
      : undefined;
    await continueResolvedTrial({
      goal,
      score,
      outcome,
      selectedPrompt,
      activeCollectionType,
      activeMaintenanceProbe: trialContext.activeProbe,
      binding,
      v3ActionKey
    });
  };

  const saveAbaV3ErrorOutcome = async (actionKey: 'INDEPENDENT_INCORRECT' | 'NO_RESPONSE') => {
    const selection = abaV3ErrorSelection;
    if (!selection) return;
    setAbaV3ErrorSelection(null);
    await continueResolvedTrial({
      goal: selection.goal,
      score: 0,
      outcome: 'error',
      selectedPrompt: selection.selectedPrompt,
      activeCollectionType: selection.activeCollectionType,
      activeMaintenanceProbe: selection.activeMaintenanceProbe,
      binding: selection.binding,
      v3ActionKey: actionKey
    });
  };

  const activateMaintenanceProbeMode = (goal?: any) => {
    const activeProbe = goal ? getAvailableMaintenanceProbeForTarget(goal) : null;
    const targetId = String(activeProbe?.targetId || goalTargetId(goal) || '').trim();
    const scheduleId = String(activeProbe?.scheduleId || '').trim();
    const activeProbeFromAvailable = Boolean(activeProbe && !activeProbe.manuallyActivated && activeProbe.source === 'available');
    if (
      !goal ||
      !activeProbe ||
      !activeProbeFromAvailable ||
      !isRealClinicalId(targetId) ||
      !isRealClinicalId(scheduleId) ||
      sessionId.startsWith('draft-') ||
      !canRecordInAbaSession({ sessionCompleted, status: activeSession?.status })
    ) {
      setPlanActionMessage('Sondagem de manutencao indisponivel nesta sessao.');
      showClinicalToast({
        variant: 'error',
        title: 'Nao foi possivel ativar a sondagem de manutencao.',
        subtitle: 'A sondagem precisa estar disponivel nesta sessao com target e schedule reais.'
      }, 'error');
      return false;
    }
    const maintenanceDisplay = goal ? resolveMaintenanceTargetDisplay({
      target: goal,
      schedule: activeProbe
        ? {
          ...activeProbe,
          target_id: targetId,
          target_name: goalTargetName(goal) || null
        }
        : {
          target_id: targetId || null,
          target_name: goalTargetName(goal) || null
        }
    }) : null;
    const maintenanceTargetLabel = maintenanceDisplay?.targetDisplayName || 'esta tentativa';
    if (targetId) {
      setCurrentTrialTargetKey(targetId);
      setActiveMaintenanceProbeTargetId(targetId);
      setActiveMaintenanceScheduleId(scheduleId);
      setManualRegularOverrideTargetId(null);
      setManualMaintenanceProbeTargets((prev) => ({
        ...prev,
        [targetId]: {
          targetId,
          targetName: goalTargetName(goal) || null,
          scheduleId,
          source: 'available',
          status: activeProbe?.status || 'AVAILABLE_IN_SESSION',
          dueDate: activeProbe?.dueDate || null,
          appointmentId: activeAppointmentId || null,
          sessionId,
          activatedAt: new Date().toISOString()
        }
      }));
    }
    setCollectionType('maintenance_probe');
    if (goal?.id) setActiveCriteria(goal.id);
    setPlanActionMessage('Sondagem de manutencao ativa para a proxima tentativa.');
    setMaintenanceProbeFeedback('Sondagem de manutencao ativa para a proxima tentativa.');
    if (maintenanceProbeFeedbackTimerRef.current) window.clearTimeout(maintenanceProbeFeedbackTimerRef.current);
    maintenanceProbeFeedbackTimerRef.current = window.setTimeout(() => {
      setMaintenanceProbeFeedback('');
      if (goal?.id) setActiveCriteria(null);
      maintenanceProbeFeedbackTimerRef.current = null;
    }, 1500);
    showClinicalToast({
      variant: 'success',
      title: 'Sondagem de manutencao ativa para a proxima tentativa.',
      subtitle: maintenanceTargetLabel
    }, 'none');
    return true;
  };

  const cancelActiveMaintenanceProbeMode = (goal?: any) => {
    const targetKey = String(activeMaintenanceProbeTargetId || getMaintenanceTargetKey(goal) || '').trim();
    if (targetKey) clearManualMaintenanceProbeTarget(targetKey);
    setActiveMaintenanceProbeTargetId(null);
    setActiveMaintenanceScheduleId(null);
    setExpandedMaintenanceProbeTargetId(null);
    setManualRegularOverrideTargetId(null);
    setCollectionType(lastRegularTrialType || 'dtt');
    setMaintenanceProbeFeedback('');
    setPlanActionMessage('Uso da sondagem de manutencao cancelado.');
    showClinicalToast({
      variant: 'info',
      title: 'Uso da sondagem de manutencao cancelado.',
      subtitle: 'A proxima tentativa volta ao tipo regular.'
    }, 'none');
  };

  const registerFrequency = (behaviorName = selectedBehavior.name, countDelta = 1) => {
    if (!ensureSessionCanRecord()) return;
    const behavior = sessionBehaviorPresets.find((item) => item.name === behaviorName) || selectedBehavior;
    if (!behaviorAllowsMeasurement(behavior, 'frequency')) {
      if (behaviorAllowsMeasurement(behavior, 'duration')) {
        void startDuration(behavior.name);
      } else {
        showClinicalToast({
          variant: 'info',
          title: 'Método indisponível',
          subtitle: `${behavior.name} usa ${getMeasurementLabel(getBehaviorDefaultMeasurement(behavior))}.`
        }, 'none');
      }
      return;
    }
    const frequencyLockKey = `frequency:${behavior.id}:${behaviorName}`;
    if (!lockAction(frequencyLockKey, 300)) return;
    const payload = buildBehaviorPayload(behaviorName, 'frequency', { behavior_id: behavior.id, behaviorId: behavior.id, count_delta: countDelta, countDelta });
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
      detail: formatBehaviorHistoryDetail({
        measurementType: 'frequency',
        countDelta,
        location: selectedLocation,
        severity: selectedSeverity
      }),
      timestamp: payload.timestamp,
      measurementType: 'frequency',
      countDelta,
      contextSnapshot: payload.contextSnapshot,
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

  const startDuration = async (behaviorName = selectedBehavior.name) => {
    if (!ensureSessionCanRecord()) return;
    if (openDurations.some((event) => event.behaviorName === behaviorName)) {
      showClinicalToast({
        variant: 'info',
        title: 'Duração já em andamento',
        subtitle: `${behaviorName} está sendo cronometrado.`
      }, 'none');
      return;
    }
    const behavior = sessionBehaviorPresets.find((item) => item.name === behaviorName) || selectedBehavior;
    if (!lockAction(`duration:start:${behavior.id}`, 300)) return;
    let behaviorDecision: AbaV3BehaviorDecision | null = null;
    try {
      behaviorDecision = await resolveAbaV3BehaviorForAction(behavior);
    } catch (error: any) {
      releaseActionLock(`duration:start:${behavior.id}`);
      setSessionWarning(error?.message || 'Não foi possível determinar o modelo deste comportamento.');
      showClinicalToast({ variant: 'error', title: 'Duração bloqueada', subtitle: error?.message || 'Não foi possível determinar o modelo de coleta.' }, 'error');
      return;
    }
    const startedAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const openEvent: OpenDurationEvent = {
      id,
      behaviorName,
      behaviorId: behavior.id,
      measurementModelVersion: behaviorDecision?.measurementModelVersion || 'LEGACY_V2',
      v3EpisodeEventId: behaviorDecision?.measurementModelVersion === 'V3' ? id : null,
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
      behavior_id: behavior.id,
      behaviorId: behavior.id,
      started_at: startedAt,
      startedAt,
      ended_at: null,
      endedAt: null,
      duration_seconds: null,
      durationSeconds: null,
      status: 'IN_PROGRESS',
      location: selectedLocation,
      severity: selectedSeverity,
      timestamp: startedAt,
      raw_payload: { durationLifecycleStatus: 'open', durationOnly: true }
    });
    void saveExistingBehaviorEvent(payload, {
      id,
      kind: 'behavior',
      title: behaviorName,
      detail: formatBehaviorHistoryDetail({
        measurementType: 'duration',
        durationSeconds: null,
        location: selectedLocation,
        severity: selectedSeverity,
        status: 'IN_PROGRESS'
      }),
      timestamp: startedAt,
      measurementType: 'duration',
      behaviorId: behavior.id,
      startedAt,
      durationSeconds: null,
      contextSnapshot: payload.contextSnapshot,
      location: selectedLocation,
      severity: selectedSeverity
    });
  };

  const endDuration = async (eventId: string, endedAt = new Date().toISOString(), sessionFinalization = false) => {
    const event = openDurationsRef.current.find((item) => item.id === eventId);
    if (!event) return;
    const durationEndLockKey = `duration:end:${eventId}`;
    if (!lockAction(durationEndLockKey, 0)) return;
    const durationSeconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(event.startedAt).getTime()) / 1000));
    setOpenDurations((prev) => prev.filter((item) => item.id !== eventId));
    showClinicalToast(buildClinicalActionToast({
      action: 'duration_end',
      behaviorName: event.behaviorName,
      durationSeconds
    }));
    const behavior = sessionBehaviorPresets.find((item) => item.id === event.behaviorId) || sessionBehaviorPresets.find((item) => item.name === event.behaviorName) || selectedBehavior;
    const payload = buildBehaviorPayload(event.behaviorName, 'duration', {
      id: event.id,
      behavior_id: behavior.id,
      behaviorId: behavior.id,
      started_at: event.startedAt,
      startedAt: event.startedAt,
      ended_at: endedAt,
      endedAt,
      duration_seconds: durationSeconds,
      durationSeconds,
      status: 'COMPLETED',
      location: event.location || selectedLocation,
      severity: event.severity ?? selectedSeverity,
      timestamp: event.startedAt,
      raw_payload: {
        durationLifecycleStatus: 'completed',
        isCensored: sessionFinalization,
        endReason: sessionFinalization ? 'SESSION_FINALIZATION' : null,
        durationOnly: true,
        frequencyDerivedFromDuration: true,
        derivedOccurrences: 1
      }
    });
    return await saveExistingBehaviorEvent(payload, {
      id: event.id,
      kind: 'behavior',
      title: event.behaviorName,
      detail: formatBehaviorHistoryDetail({
        measurementType: 'duration',
        durationSeconds,
        location: event.location || selectedLocation,
        severity: event.severity ?? selectedSeverity,
        status: 'COMPLETED'
      }),
      timestamp: event.startedAt,
      measurementType: 'duration',
      behaviorId: behavior.id,
      startedAt: event.startedAt,
      endedAt,
      durationSeconds,
      contextSnapshot: payload.contextSnapshot,
      location: event.location || selectedLocation,
      severity: event.severity ?? selectedSeverity
    }).finally(() => releaseActionLock(durationEndLockKey));
  };

  const discardDuration = (eventId: string) => {
    const openEvent = openDurations.find((item) => item.id === eventId);
    if (openEvent?.measurementModelVersion === 'V3') {
      showClinicalToast({
        variant: 'info',
        title: 'Duração V3 não pode ser descartada',
        subtitle: 'Finalize o episódio para preservar o fato clínico. Correções V3 serão feitas por revisão, nunca por exclusão.'
      }, 'none');
      return;
    }
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
    setBehaviorMeasurementType(getBehaviorDefaultMeasurement(behavior));
  };

  const commitIntervalQuantityInput = (value = intervalTotalIntervalsInput) => {
    const raw = String(value ?? '').trim();
    const invalid = Boolean(raw && (!/^\d+$/.test(raw) || Number(raw) < intervalQuantityMin || Number(raw) > intervalQuantityMax));
    const nextQuantity = normalizeIntervalQuantityInput(raw);
    setIntervalTotalIntervals(nextQuantity);
    setIntervalTotalIntervalsInput(String(nextQuantity));
    setIntervalQuantityError(invalid ? `Informe uma quantidade entre ${intervalQuantityMin} e ${intervalQuantityMax}.` : '');
    return nextQuantity;
  };

  const adjustIntervalQuantity = (delta: number) => {
    const currentQuantity = normalizeIntervalQuantityInput(intervalTotalIntervalsInput || intervalTotalIntervals);
    const nextQuantity = Math.min(intervalQuantityMax, Math.max(intervalQuantityMin, currentQuantity + delta));
    setIntervalTotalIntervals(nextQuantity);
    setIntervalTotalIntervalsInput(String(nextQuantity));
    setIntervalQuantityError('');
  };

  const handleSelectedBehaviorAction = () => {
    if (!ensureSessionCanRecord()) return;
    const effectiveMeasurementType = resolveBehaviorMeasurementForAction(selectedBehavior, behaviorMeasurementType);
    if (effectiveMeasurementType !== behaviorMeasurementType) setBehaviorMeasurementType(effectiveMeasurementType);
    if (effectiveMeasurementType === 'frequency') {
      registerFrequency(selectedBehavior.name, 1);
      return;
    }
    if (effectiveMeasurementType === 'duration') {
      void startDuration(selectedBehavior.name);
      return;
    }
    if (effectiveMeasurementType === 'abc') {
      openAbcModal(selectedBehavior.id);
      return;
    }
    if (isIntervalMeasurementType(effectiveMeasurementType)) {
      const committedQuantity = commitIntervalQuantityInput();
      void startIntervalRun(selectedBehavior, effectiveMeasurementType, committedQuantity);
      return;
    }
    if (effectiveMeasurementType === 'rate') {
      if (!rateWindow) startRateWindow();
      else registerRateOccurrence();
      return;
    }
  };

  const startRateWindow = async () => {
    if (!ensureSessionCanRecord()) return;
    const startedAt = new Date().toISOString();
    const windowId = crypto.randomUUID();
    try {
      const behaviorDecision = await resolveAbaV3BehaviorForAction(selectedBehavior);
      if (behaviorDecision?.measurementModelVersion === 'V3') {
        const result = await dataService.saveAbaV3BehaviorAction({
          patientId,
          sessionId,
          behaviorId: selectedBehavior.id,
          actionType: 'OBSERVATION_START',
          clientEventId: windowId,
          causalEntityId: windowId,
          occurredAt: startedAt,
          metadata: { source: 'session_mode_v3', targetId: behaviorDecision.targetId || null }
        });
        if (!result?.success) throw new Error(result?.error || 'Não foi possível iniciar a janela de taxa V3.');
        setRateWindow({
          id: windowId,
          behaviorId: selectedBehavior.id,
          behaviorName: selectedBehavior.name,
          startedAt,
          count: 0,
          measurementModelVersion: 'V3',
          v3ObservationEventId: windowId
        });
        return;
      }
      setRateWindow({ id: windowId, behaviorId: selectedBehavior.id, behaviorName: selectedBehavior.name, startedAt, count: 0 });
    } catch (error: any) {
      setSessionWarning(error?.message || 'Não foi possível iniciar a janela de taxa.');
      showClinicalToast({ variant: 'error', title: 'Coleta bloqueada', subtitle: error?.message || 'Não foi possível iniciar a janela.' }, 'error');
    }
  };

  const finishRateWindow = async (endedAt = new Date().toISOString()) => {
    const rateWindow = rateWindowRef.current;
    if (!rateWindow) return true;
    if (rateWindow.measurementModelVersion !== 'V3') {
      setRateWindow(null);
      return true;
    }
    try {
      const result = await dataService.saveAbaV3BehaviorAction({
        patientId,
        sessionId,
        behaviorId: rateWindow.behaviorId || selectedBehavior.id,
        actionType: 'OBSERVATION_STOP',
        clientEventId: crypto.randomUUID(),
        episodeEventId: rateWindow.v3ObservationEventId || rateWindow.id,
        causalEntityId: rateWindow.v3ObservationEventId || rateWindow.id,
        occurredAt: endedAt,
        metadata: { source: 'session_mode_v3' }
      });
      if (!result?.success) throw new Error(result?.error || 'Não foi possível finalizar a janela de taxa V3.');
      setRateWindow(null);
      showClinicalToast({ variant: result?.pending ? 'info' : 'success', title: result?.pending ? 'Finalização preservada para sincronização' : 'Janela de taxa finalizada', subtitle: `${rateWindow.count || 0} ocorrência(s)` });
      return true;
    } catch (error: any) {
      setSessionWarning(error?.message || 'Não foi possível finalizar a janela de taxa.');
      showClinicalToast({ variant: 'error', title: 'Não foi possível finalizar', subtitle: error?.message || 'Tente novamente.' }, 'error');
      return false;
    }
  };

  const registerRateOccurrence = () => {
    if (!ensureSessionCanRecord()) return;
    if (!rateWindow) return;
    if (!lockAction(`rate:${rateWindow.id}`, 300)) return;
    setRateWindow({ ...rateWindow, count: Number(rateWindow.count || 0) + 1 });
    const payload = buildBehaviorPayload(rateWindow.behaviorName, 'rate', {
      behavior_id: rateWindow.behaviorId || selectedBehavior.id,
      behaviorId: rateWindow.behaviorId || selectedBehavior.id,
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
      behaviorId: rateWindow.behaviorId || selectedBehavior.id,
      countDelta: 1,
      contextSnapshot: payload.contextSnapshot,
      location: selectedLocation,
      severity: selectedSeverity
    });
  };

  const persistIntervalLifecycleRecord = (run: any, status: AbaIntervalCollectionStatus, occurredAt = new Date().toISOString(), extra: any = {}) => {
    if (run?.measurementModelVersion === 'V3') return;
    const behaviorId = run.behaviorId || selectedBehavior.id;
    const intervalNumber = Math.max(1, Number(run.intervalIndex || 1));
    const intervalStartedAt = run.intervalStartedAt || run.startedAt || occurredAt;
    const intervalDurationSeconds = Math.max(1, Number(run.intervalSeconds || intervalSeconds || 1));
    const lifecycleId = `${run.id}-lifecycle-${String(status).toLowerCase()}-${Date.parse(occurredAt) || Date.now()}`;
    const contextSnapshot = buildBehaviorEventContextSnapshot({
      behaviorName: run.behaviorName,
      behaviorId,
      collectionMethod: run.measurementType || run.method || 'partial_interval',
      location: run.location || selectedLocation,
      severity: run.severity ?? selectedSeverity,
      durationSeconds: intervalDurationSeconds,
      quantity: run.totalIntervals || intervalTotalIntervals,
      alertTarget: run.alertType || intervalAlertType,
      sessionId,
      patientId,
      professionalId: resolvedTherapistId || null,
      timestamp: occurredAt
    });
    void dataService.saveAbaIntervalRecord({
      id: lifecycleId,
      clinic_id: resolvedClinicId || undefined,
      clinicId: resolvedClinicId || undefined,
      patient_id: patientId,
      patientId,
      session_id: sessionId,
      sessionId,
      appointment_id: activeAppointmentId || undefined,
      appointmentId: activeAppointmentId || undefined,
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
        contextSnapshot,
        context_snapshot: contextSnapshot,
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

  const startIntervalRun = async (behaviorOverride = selectedBehavior, measurementOverride = behaviorMeasurementType, quantityOverride?: number) => {
    if (!ensureSessionCanRecord()) return;
    if (intervalRun) {
      setSessionWarning(intervalRun.behaviorId === behaviorOverride.id
        ? 'Já existe uma coleta por intervalo em andamento para este comportamento.'
        : 'Finalize ou conclua a coleta por intervalo em andamento antes de iniciar outra.');
      return;
    }
    const startedAt = new Date().toISOString();
    const localRunId = crypto.randomUUID();
    const intervalEndsAt = new Date(new Date(startedAt).getTime() + intervalSeconds * 1000).toISOString();
    const plannedIntervalCount = Math.max(1, Math.floor(Number(quantityOverride ?? intervalTotalIntervals) || 1));
    let behaviorDecision: AbaV3BehaviorDecision | null = null;
    try {
      behaviorDecision = await resolveAbaV3BehaviorForAction(behaviorOverride);
      let v3IntervalRunId: string | null = null;
      if (behaviorDecision?.measurementModelVersion === 'V3') {
        const startResult = await dataService.startAbaV3IntervalRun({
          patientId,
          sessionId,
          behaviorId: behaviorOverride.id,
          clientRunEventId: localRunId,
          measurementMethod: String(measurementOverride || '').toUpperCase(),
          intervalSeconds,
          plannedIntervals: plannedIntervalCount,
          startedAt,
          metadata: { source: 'session_mode_v3', targetId: behaviorDecision.targetId || null }
        });
        if (!startResult?.success || !startResult?.data?.intervalRunId) {
          throw new Error(startResult?.error || 'Não foi possível iniciar a coleta por intervalo V3.');
        }
        v3IntervalRunId = String(startResult.data.intervalRunId);
      }
      const nextRun = {
        id: localRunId,
        behaviorId: behaviorOverride.id,
        behaviorName: behaviorOverride.name,
        measurementType: measurementOverride,
        method: measurementOverride,
        measurementModelVersion: behaviorDecision?.measurementModelVersion === 'V3' ? 'V3' : 'LEGACY_V2',
        v3IntervalRunId,
        location: selectedLocation,
        severity: selectedSeverity,
        startedAt,
        intervalStartedAt: startedAt,
        intervalEndsAt,
        intervalSeconds,
        intervalIndex: 1,
        totalIntervals: plannedIntervalCount,
        plannedIntervals: plannedIntervalCount,
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
      if (nextRun.measurementModelVersion !== 'V3') {
        persistIntervalLifecycleRecord(nextRun, 'RUNNING', startedAt, { lifecycleAction: 'start' });
      }
      setIntervalOptionsOpen(false);
      setIntervalCancelConfirmOpen(false);
      setIntervalZeroFinishConfirmOpen(false);
      setIntervalEndReason('');
      setIntervalCancelReason('');
      setIntervalSummary(null);
      setSessionWarning('');
    } catch (error: any) {
      setSessionWarning(error?.message || 'Não foi possível iniciar a coleta por intervalo.');
      showClinicalToast({ variant: 'error', title: 'Coleta bloqueada', subtitle: error?.message || 'Não foi possível iniciar a coleta.' }, 'error');
    }
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
      contextSnapshot: payload.contextSnapshot,
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
      contextSnapshot: payload.contextSnapshot,
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
    if (intervalRun.measurementModelVersion === 'V3') {
      setIntervalOptionsOpen(false);
      showClinicalToast({ variant: 'info', title: 'Pausa indisponível nesta coleta V3', subtitle: 'A grade de intervalos V3 é fixa. Finalize ou cancele a coleta para preservar o denominador.' }, 'none');
      return;
    }
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
    if (intervalRun.measurementModelVersion === 'V3') return;
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

  const finalizeAbaV3IntervalCollection = async (run: any, closeReason: 'CLIENT_COMPLETE' | 'MANUAL_CANCEL', endedAt: string) => {
    const runId = String(run?.v3IntervalRunId || '').trim();
    if (!runId) throw new Error('A coleta por intervalo V3 não possui identificador canônico.');
    const result = await dataService.finalizeAbaV3IntervalRun({
      patientId,
      sessionId,
      intervalRunId: runId,
      endedAt,
      closeReason,
      clientEventId: `interval-finalize-${run.id}-${closeReason}`
    });
    if (!result?.success) throw new Error(result?.error || 'Não foi possível finalizar a coleta por intervalo V3.');
    return result;
  };

  const completeAbaV3IntervalLocally = (run: any, endedAt: string, reason: string) => {
    const answered = Math.max(0, Number(run?.completedCount || 0));
    const occurred = Math.min(answered, Math.max(0, Number(run?.occurredCount || 0)));
    const notOccurred = Math.max(0, answered - occurred);
    const percent = answered > 0 ? Math.round((occurred / answered) * 100) : 0;
    setIntervalSummary({
      behaviorName: run.behaviorName,
      measurementType: run.measurementType,
      totalIntervals: answered,
      plannedTotalIntervals: Math.max(1, Number(run.totalIntervals || 1)),
      occurredCount: occurred,
      notOccurredCount: notOccurred,
      percent,
      endedAt,
      reason,
      measurementModelVersion: 'V3'
    });
    return { answeredIntervals: answered, plannedIntervals: Math.max(1, Number(run.totalIntervals || 1)), occurrencePercent: percent };
  };

  const cancelAbaV3IntervalRun = async (run: any) => {
    const cancelledAt = new Date().toISOString();
    try {
      await finalizeAbaV3IntervalCollection(run, 'MANUAL_CANCEL', cancelledAt);
      setRecords((prev) => prev.map((record) => {
        const rawPayload = record.rawPayload || {};
        const belongsToRun = rawPayload.intervalRunId === run.id || record.id.startsWith(`${run.id}-interval-`);
        return belongsToRun ? { ...record, intervalCancelled: true, collectionStatus: 'CANCELLED', status: 'CANCELLED', cancelledAt, cancelReason: intervalCancelReason } : record;
      }));
      setIntervalRun(null);
      setIntervalSummary(null);
      setIntervalCancelConfirmOpen(false);
      setIntervalZeroFinishConfirmOpen(false);
      setIntervalCancelReason('');
      setSessionWarning('');
      showClinicalToast({ variant: 'warning', title: 'Coleta V3 cancelada', subtitle: 'Não entrou no resumo clínico oficial.' }, 'none');
    } catch (error: any) {
      setSessionWarning(error?.message || 'Não foi possível cancelar a coleta por intervalo V3.');
      showClinicalToast({ variant: 'error', title: 'Cancelamento não confirmado', subtitle: error?.message || 'Tente novamente.' }, 'error');
    }
  };

  const confirmCancelIntervalRun = () => {
    if (!intervalRun) return;
    if (intervalRun.measurementModelVersion === 'V3') {
      void cancelAbaV3IntervalRun(intervalRun);
      return;
    }
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
    if (intervalRun.measurementModelVersion === 'V3' && completedTotal > 0) {
      const run = intervalRun;
      const endedAt = new Date().toISOString();
      void (async () => {
        try {
          const result = await finalizeAbaV3IntervalCollection(run, 'CLIENT_COMPLETE', endedAt);
          const aggregate = completeAbaV3IntervalLocally(run, endedAt, completedTotal >= Number(run.totalIntervals || 1) ? 'COMPLETED' : 'PARTIALLY_COMPLETED');
          setIntervalRun(null);
          setIntervalOptionsOpen(false);
          setIntervalCancelConfirmOpen(false);
          setIntervalZeroFinishConfirmOpen(false);
          setIntervalEndReason('');
          setSessionWarning('');
          showClinicalToast({ variant: result?.pending ? 'info' : 'success', title: result?.pending ? 'Finalização V3 preservada para sincronização' : '✓ Coleta V3 finalizada', subtitle: `${aggregate.answeredIntervals}/${aggregate.plannedIntervals} intervalos • ${aggregate.occurrencePercent}% ocorrência` });
        } catch (error: any) {
          setSessionWarning(error?.message || 'Não foi possível finalizar a coleta por intervalo V3.');
          showClinicalToast({ variant: 'error', title: 'Finalização não confirmada', subtitle: error?.message || 'Tente novamente.' }, 'error');
        }
      })();
      return;
    }
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

  const registerAbaV3Interval = async (run: any, occurred: boolean) => {
    const intervalNumber = Number(run.intervalIndex || 1);
    const intervalLockKey = `interval:${run.id}:${intervalNumber}`;
    if (!lockAction(intervalLockKey, 0)) return;
    const intervalEndedAt = run.intervalEndsAt || new Date().toISOString();
    const recordId = `${run.id}-interval-${intervalNumber}`;
    try {
      const result = await dataService.saveAbaV3IntervalObservation({
        patientId,
        sessionId,
        intervalRunId: run.v3IntervalRunId,
        intervalIndex: intervalNumber,
        observationCode: occurred ? 'OCCURRED' : 'NOT_OCCURRED',
        clientEventId: recordId,
        metadata: { source: 'session_mode_v3' }
      });
      if (!result?.success) throw new Error(result?.error || 'Não foi possível registrar este intervalo V3.');
      const nextCompletedCount = Number(run.completedCount || 0) + 1;
      const nextOccurredCount = Number(run.occurredCount || 0) + (occurred ? 1 : 0);
      addRecord({
        id: recordId,
        kind: 'behavior',
        title: run.behaviorName,
        detail: `intervalo ${intervalNumber}: ${occurred ? 'SIM' : 'NÃO'}`,
        timestamp: intervalEndedAt,
        measurementType: run.measurementType,
        measurementModelVersion: 'V3',
        behaviorId: run.behaviorId,
        intervalNumber,
        intervalIndex: intervalNumber,
        intervalOccurred: occurred,
        intervalStartedAt: run.intervalStartedAt || run.startedAt,
        intervalEndedAt,
        collectionStatus: 'COMPLETED',
        status: 'COMPLETED',
        rawPayload: { intervalRunId: run.id, v3IntervalRunId: run.v3IntervalRunId, intervalAggregate: false, collectionStatus: 'COMPLETED' },
        location: run.location || selectedLocation,
        severity: run.severity ?? selectedSeverity
      }, result?.pending ? 'local' : 'synced');
      showClinicalToast(buildClinicalActionToast({ action: 'interval', behaviorName: run.behaviorName, intervalNumber, occurred }));
      if (intervalNumber >= Number(run.totalIntervals || 1)) {
        const finalResult = await finalizeAbaV3IntervalCollection({ ...run, completedCount: nextCompletedCount, occurredCount: nextOccurredCount }, 'CLIENT_COMPLETE', intervalEndedAt);
        completeAbaV3IntervalLocally({ ...run, completedCount: nextCompletedCount, occurredCount: nextOccurredCount }, intervalEndedAt, 'COMPLETED');
        setIntervalRun(null);
        setIntervalOptionsOpen(false);
        showPersistResultToast(finalResult);
        onSessionRecordSaved?.();
        return;
      }
      const nextStartedAt = new Date().toISOString();
      const nextEndsAt = new Date(new Date(nextStartedAt).getTime() + Number(run.intervalSeconds || intervalSeconds) * 1000).toISOString();
      setIntervalRun({
        ...run,
        intervalIndex: intervalNumber + 1,
        intervalStartedAt: nextStartedAt,
        intervalEndsAt: nextEndsAt,
        status: 'RUNNING',
        collectionStatus: 'RUNNING',
        awaitingResponse: false,
        alertFiredAt: null,
        completedCount: nextCompletedCount,
        answeredIntervals: nextCompletedCount,
        occurredCount: nextOccurredCount,
        yesCount: nextOccurredCount,
        noCount: Math.max(0, nextCompletedCount - nextOccurredCount)
      });
      onSessionRecordSaved?.();
    } catch (error: any) {
      setSessionWarning(error?.message || 'Não foi possível registrar o intervalo V3.');
      showClinicalToast({ variant: 'error', title: 'Intervalo não confirmado', subtitle: error?.message || 'Tente novamente.' }, 'error');
    } finally {
      releaseActionLock(intervalLockKey);
    }
  };

  const registerInterval = (occurred: boolean) => {
    if (!ensureSessionCanRecord()) return;
    if (!intervalRun) return;
    if (getIntervalRunStatus(intervalRun) !== 'AWAITING_RESPONSE') return;
    if (intervalRun.measurementModelVersion === 'V3') {
      void registerAbaV3Interval(intervalRun, occurred);
      return;
    }
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
    const behavior = sessionBehaviorPresets.find((item) => item.id === behaviorId) || selectedBehavior;
    setAbcBehaviorId(behavior.id);
    setAbcModalOpen(true);
  };

  const openAbcModalForBehaviorName = (behaviorName: string) => {
    const behavior = sessionBehaviorPresets.find((item) => item.name === behaviorName) || selectedBehavior;
    openAbcModal(behavior.id);
  };

  const resolveShortcutBehavior = (shortcut: any) => (
    sessionBehaviorPresets.find((behavior) => behavior.id === shortcut?.behaviorId) || selectedBehavior
  );

  const findOpenDurationForBehavior = (behaviorName: string) => (
    openDurations.find((event) => event.behaviorName === behaviorName)
  );

  const executeBehaviorShortcut = (shortcut: any) => {
    const behavior = resolveShortcutBehavior(shortcut);
    const method = resolveBehaviorMeasurementForAction(behavior, shortcut?.method || behavior.defaultMeasurement || 'frequency');
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
      else void startDuration(behavior.name);
      return;
    }
    if (isIntervalMeasurementType(method)) {
      void startIntervalRun(behavior, method);
    }
  };

  const saveAbcEvent = async () => {
    if (!sessionCompleted && !ensureSessionCanRecord()) return;
    if (!lockAction('abc:save', 600)) return;
    const behavior = sessionBehaviorPresets.find((item) => item.id === abcBehaviorId) || selectedBehavior;
    if (sessionCompleted) {
      if (abaV3BehaviorIdSet.has(String(behavior?.id || '').trim())) {
        setSessionWarning('ABC permanece no modelo Legacy durante o piloto e não pode sobrescrever um comportamento já vinculado ao coletor V3.');
        showClinicalToast({ variant: 'info', title: 'ABC V3 ainda não liberado', subtitle: 'O complemento foi bloqueado para não misturar semânticas de coleta.' }, 'none');
        releaseActionLock('abc:save');
        return;
      }
    } else {
      try {
        const behaviorDecision = await resolveAbaV3BehaviorForAction(behavior);
        if (behaviorDecision?.measurementModelVersion === 'V3') {
          setSessionWarning('ABC ainda não possui modelo V3 próprio. A gravação Legacy foi bloqueada para preservar a separação clínica.');
          showClinicalToast({ variant: 'info', title: 'ABC V3 ainda não liberado', subtitle: 'Use um comportamento Legacy ou aguarde a superfície ABC V3 dedicada.' }, 'none');
          releaseActionLock('abc:save');
          return;
        }
      } catch (error: any) {
        setSessionWarning(error?.message || 'Não foi possível determinar o modelo deste comportamento.');
        showClinicalToast({ variant: 'error', title: 'ABC bloqueado', subtitle: error?.message || 'Não foi possível determinar o modelo de coleta.' }, 'error');
        releaseActionLock('abc:save');
        return;
      }
    }
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
      responseByTherapist: abcNote,
      clinical_complement: sessionCompleted || undefined,
      clinicalComplement: sessionCompleted || undefined,
      authorizedComplement: sessionCompleted || undefined,
      complement_type: sessionCompleted ? 'abc' : undefined,
      complementType: sessionCompleted ? 'abc' : undefined
    });
    const result = await saveAbcClinicalEvent(payload, {
      id: String(payload.id),
      kind: 'behavior',
      title: behavior.name,
      detail: formatBehaviorHistoryDetail({
        measurementType: 'abc',
        location: abcLocation,
        severity: abcSeverity
      }),
      timestamp: payload.timestamp,
      measurementType: 'abc',
      behaviorId: behavior.id,
      contextSnapshot: payload.contextSnapshot,
      location: abcLocation,
      severity: abcSeverity,
      antecedent: abcAntecedent,
      consequence: abcConsequence,
      notes: abcNote
    });
    if (result?.success) {
      showClinicalToast(buildClinicalActionToast({ action: 'abc' }));
      setAbcModalOpen(false);
      setAbcNote('');
    }
  };

  const requestEndSession = () => {
    setSessionWarning('');
    setSessionEndError('');
    if (!sessionEndPreviewAt) setSessionEndPreviewAt(new Date().toISOString());
    if (!completionIdempotencyKeyRef.current) {
      completionIdempotencyKeyRef.current = createSessionCompletionKey();
    }
    setShowSessionSummary(true);
  };

  const returnToActiveSession = () => {
    if (endingSession) return;
    setShowSessionSummary(false);
    setSessionEndPreviewAt('');
    setSessionEndError('');
    completionIdempotencyKeyRef.current = '';
    completionRequestRef.current = null;
  };

  const resolveDurationBeforeEnd = (eventId: string, action: 'end' | 'discard') => {
    const isLastOpenDuration = openDurations.length <= 1;
    if (action === 'end') endDuration(eventId);
    else discardDuration(eventId);
    if (isLastOpenDuration) {
      setDurationBlockModalOpen(false);
      requestEndSession();
    }
  };

  const getRecordAbcRequirement = (record: SessionRecord): AbcRequirement => {
    const behavior = sessionBehaviorPresets.find((item) => item.id === record.behaviorId || item.name === record.title);
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
    const records = recordsRef.current;
    const openDurations = openDurationsRef.current;
    const intervalRun = intervalRunRef.current;
    const therapeuticTimers = therapeuticTimersRef.current;
    const savingLocally = records.filter((record) => record.syncStatus === 'syncing');
    const notSyncedWithServer = records.filter((record) => record.syncStatus === 'local' || record.syncStatus === 'error');

    const closure = canCloseAbaSession({
      openDurations,
      intervalRun,
      unsavedLocalCount: savingLocally.length,
      incompleteTrial: Boolean(promptSelectionGoal)
    });
    const blockers: SessionSummaryPendingItem[] = [...closure.blockers];
    const activeTherapeuticTimers = Object.values(therapeuticTimers);
    if (activeTherapeuticTimers.length > 0) {
      blockers.push({
        key: 'therapeutic_measurement_timer_open',
        label: `${activeTherapeuticTimers.length} cronômetro(s) terapêutico(s) serão finalizados automaticamente`,
        category: 'blocker',
        blocking: true,
        count: activeTherapeuticTimers.length
      });
    }
    const warnings: SessionSummaryPendingItem[] = [];
    const isNonAttendance = NON_ATTENDANCE_STATUSES.has(attendanceStatus);

    const failedV3Trials = notSyncedWithServer.filter((record) => record.kind === 'trial' && record.measurementModelVersion === 'V3' && record.syncStatus === 'error');
    const otherUnsynced = notSyncedWithServer.length - failedV3Trials.length;
    if (failedV3Trials.length > 0) {
      blockers.push({
        key: 'v3_failed_trials_require_resolution',
        label: `${failedV3Trials.length} tentativa(s) V3 serão reenviadas ao confirmar`,
        category: 'blocker',
        blocking: true,
        count: failedV3Trials.length
      });
    }
    if (otherUnsynced > 0) {
      blockers.push({
        key: 'server_sync_required',
        label: `${otherUnsynced} registro(s) serão enviados automaticamente ao confirmar`,
        category: 'blocker',
        blocking: true,
        count: otherUnsynced
      });
    }
    if (isNonAttendance && records.filter((record) => !isCancelledIntervalClinicalRecord(record)).length > 0) {
      blockers.push({
        key: 'absence_with_clinical_records',
        label: 'Falta ou cancelamento não pode ser confirmado porque já existem registros clínicos nesta sessão',
        category: 'blocker',
        blocking: true,
        count: 1
      });
    }
    if (isNonAttendance && sessionNote.trim().length < 5) {
      blockers.push({
        key: 'absence_reason_required',
        label: 'Informe o motivo da falta ou do cancelamento com pelo menos 5 caracteres',
        category: 'blocker',
        blocking: true,
        count: 1
      });
    }

    if (!isNonAttendance) {
      // ABC remains available as an optional clinical complement. Missing ABC fields
      // never block or warn during session closure; the behavior record itself is valid.
      warnings.push({ key: 'guardian_signature_pending', label: 'Assinatura do responsável pendente', category: 'warning', count: 1 });
      if (!sessionNote.trim()) warnings.push({ key: 'session_note_pending', label: 'Observação da sessão pendente', category: 'warning', count: 1 });
    }
    return { blockers, warnings };
  };

  const confirmEndSession = async () => {
    if (endingSessionRef.current) return;
    setEndingSession(true);
    setSessionWarning('');
    setSessionEndError('');
    try {
      const endedAt = completionRequestRef.current?.payload?.endedAt || new Date().toISOString();
      let records = completionRequestRef.current?.records || recordsRef.current;
      let closureIssues = { blockers: [] as SessionSummaryPendingItem[], warnings: [] as SessionSummaryPendingItem[] };
      let hasDeferredOfflineWrites = false;
      if (!completionRequestRef.current) {
        const mandatory = buildSessionClosureIssues().blockers.filter((item) => !AUTOMATIC_SESSION_CLOSURE_KEYS.has(item.key));
        if (mandatory.length) throw new Error(mandatory.map((item) => item.label).join('. '));
        await waitForSessionWrites(() => recordsRef.current.some((record) => record.syncStatus === 'syncing'));
        for (const timer of Object.values(therapeuticTimersRef.current) as TherapeuticTimerState[]) {
          const goal = timer.goalSnapshot || sessionGoals.find((item: any) => therapeuticGoalKey(item) === timer.goalKey);
          if (!goal) throw new Error('O alvo do cronômetro não foi encontrado. O tempo foi preservado.');
          if (!await finishTherapeuticTimer(goal, endedAt, true)) throw new Error('Não foi possível salvar o tempo observado. Tente finalizar novamente.');
        }
        for (const event of [...openDurationsRef.current]) {
          // The atomic V3 completion owns censored duration finalization. A client
          // DURATION_STOP would incorrectly label an unknown endpoint as USER_STOP.
          if (event.measurementModelVersion === 'V3') continue;
          const result = await endDuration(event.id, endedAt, true);
          if (result?.success === false && !result?.durable) throw new Error('Não foi possível salvar o evento de duração. O registro foi preservado.');
        }
        if (rateWindowRef.current && rateWindowRef.current.measurementModelVersion !== 'V3' && !await finishRateWindow(endedAt)) throw new Error('Não foi possível confirmar a finalização da janela de taxa.');
        const run = intervalRunRef.current;
        if (run && run.measurementModelVersion !== 'V3') {
          saveIntervalAggregateV2(run, Number(run.completedCount || 0), Number(run.occurredCount || 0), endedAt, 'PARTIALLY_COMPLETED', 'SESSION_FINALIZATION');
          setIntervalRun(null);
        }
        await waitForSessionWrites(() => recordsRef.current.some((record) => record.syncStatus === 'syncing'));
        for (const record of recordsRef.current.filter((item) => item.kind === 'trial' && item.measurementModelVersion === 'V3' && item.syncStatus === 'error')) {
          await retryFailedV3Trial(record);
        }
        setReinforcerClosureSyncing(true);
      setSessionWarning('Sincronizando registros antes de encerrar…');
      try {
        const reinforcerFlush = await flushReinforcerDeliveries(sessionId);
        if (!reinforcerFlush.ok) {
          throw new Error(
            reinforcerFlush.terminal > 0
              ? 'Há um registro de reforçador que não pôde ser confirmado. O registro local foi preservado.'
              : 'Há registros de reforçadores aguardando sincronização. Os dados foram preservados; tente finalizar novamente quando a conexão confirmar o envio.'
          );
        }
      } finally {
        setReinforcerClosureSyncing(false);
      }

      const entityIds = recordsRef.current.flatMap((record) => [record.id, String(record.rawPayload?.clientEventId || '')]).filter(Boolean);
        await syncOfflineData({ force: true, sessionId, entityIds });
        const queued = await getSessionQueuedRecords(sessionId, entityIds);
        const { durable: durableQueued, terminal: terminalQueued } = partitionSessionQueueForClosure(queued);
        if (terminalQueued.length > 0) {
          throw new Error('Há um registro clínico preservado localmente que precisa de revisão antes da sincronização.');
        }

        const durableEntityIds = new Set(durableQueued.map((record) => String(record.entity_id || record.id)));
        const refreshedRecords = await Promise.all(recordsRef.current.map(async (record) => {
          if (record.syncStatus === 'synced') return record;
          const entityId = record.measurementModelVersion === 'V3' ? String(record.rawPayload?.clientEventId || record.id) : record.id;
          if (durableEntityIds.has(entityId)) return record;
          const cached = await getRecordById(entityId);
          return cached?.sync_status === 'synced' ? { ...record, syncStatus: 'synced' as const } : record;
        }));
        setRecords(refreshedRecords);

        const unprotectedUnsynced = recordsRef.current.filter((record) => {
          if (record.syncStatus === 'synced') return false;
          const entityId = record.measurementModelVersion === 'V3' ? String(record.rawPayload?.clientEventId || record.id) : record.id;
          return !durableEntityIds.has(entityId);
        });
        if (unprotectedUnsynced.length > 0) {
          throw new Error('Há um registro ainda não confirmado que não está protegido pela fila local. A sessão permanece aberta para evitar perda de dados.');
        }

        hasDeferredOfflineWrites = durableQueued.length > 0;
        closureIssues = buildSessionClosureIssues();
        closureIssues.blockers = closureIssues.blockers.filter((item) => {
          if (item.key === 'open_duration' && openDurationsRef.current.every((event) => event.measurementModelVersion === 'V3')) return false;
          if (item.key === 'open_interval_collection' && intervalRunRef.current?.measurementModelVersion === 'V3') return false;
          if (
            unprotectedUnsynced.length === 0 &&
            ['unsaved_local_records', 'server_sync_required', 'v3_failed_trials_require_resolution'].includes(item.key)
          ) return false;
          return true;
        });
        if (closureIssues.blockers.length) {
          throw new Error(closureIssues.blockers.map((item) => item.label).join('. '));
        }

        records = recordsRef.current.map((record) => {
          const event = openDurationsRef.current.find((item) => item.id === record.id && item.measurementModelVersion === 'V3');
          if (!event) return record;
          const durationSeconds = Math.max(0, (Date.parse(endedAt) - Date.parse(event.startedAt)) / 1000);
          return { ...record, endedAt, durationSeconds, status: 'COMPLETED', rawPayload: { ...record.rawPayload, isCensored: true, endReason: 'SESSION_FINALIZATION' } };
        });
      }
      const finalSummary = completionRequestRef.current?.payload?.summary || calculateSessionSummary(sessionId, {
        id: `summary-${sessionId}`,
        sessionId,
        patientId,
        patientName: patientDisplayName,
        therapistId: resolvedTherapistId || null,
        therapistName: therapistDisplayName,
        careSetting: (activeSessionCareSetting || null) as SessionSummary['careSetting'],
        locationNameSnapshot: activeSessionLocationName || null,
        locationContextSnapshot: {
          careSetting: activeSessionCareSetting || null,
          schoolId: activeSession?.schoolId || activeSession?.school_id || null,
          schoolUnitId: activeSession?.schoolUnitId || activeSession?.school_unit_id || null,
          locationName: activeSessionLocationName || null,
          locationSource:
            activeSession?.locationContextSnapshot?.locationSource ||
            activeSession?.location_context_snapshot?.locationSource ||
            null,
          locationTimezone:
            activeSession?.locationContextSnapshot?.locationTimezone ||
            activeSession?.location_context_snapshot?.locationTimezone ||
            maintenanceTimeZone,
        },
        startedAt: activeSession?.startedAt || activeSession?.started_at || endedAt,
        endedAt,
        createdAt: endedAt,
        trials: records.filter((record) => record.kind === 'trial' && !record.therapeuticMeasurement),
        behaviorEvents: records.filter((record) => record.kind === 'behavior' && !isCancelledIntervalClinicalRecord(record)),
        masterySummary: teachingMasteryRows,
        blockingItems: closureIssues.blockers,
        warningItems: closureIssues.warnings,
        sessionNote,
        syncStatus: hasDeferredOfflineWrites ? 'local' : 'synced'
      });
      const finalMaintenanceSummary = completionRequestRef.current?.payload?.summary?.maintenanceSummary || maintenanceProbeRows;
      const idempotencyKey = completionIdempotencyKeyRef.current || createSessionCompletionKey();
      completionIdempotencyKeyRef.current = idempotencyKey;

      const completionPayload = {
        patient_id: patientId,
        patientId,
        clinic_id: resolvedClinicId || undefined,
        clinicId: resolvedClinicId || undefined,
        appointment_id: activeAppointmentId || undefined,
        appointmentId: activeAppointmentId || undefined,
        therapist_id: resolvedTherapistId || undefined,
        therapistId: resolvedTherapistId || undefined,
        started_at: activeSession?.actualStartAt || activeSession?.actual_start_at || activeSession?.startedAt || activeSession?.started_at || finalSummary.startedAt,
        startedAt: activeSession?.actualStartAt || activeSession?.actual_start_at || activeSession?.startedAt || activeSession?.started_at || finalSummary.startedAt,
        scheduled_start: activeSession?.scheduledStart || activeSession?.scheduled_start || activeSession?.scheduledStartAt || activeSession?.scheduled_start_at || undefined,
        scheduledStart: activeSession?.scheduledStart || activeSession?.scheduled_start || activeSession?.scheduledStartAt || activeSession?.scheduled_start_at || undefined,
        scheduled_end: activeSession?.scheduledEnd || activeSession?.scheduled_end || activeSession?.scheduledEndAt || activeSession?.scheduled_end_at || undefined,
        scheduledEnd: activeSession?.scheduledEnd || activeSession?.scheduled_end || activeSession?.scheduledEndAt || activeSession?.scheduled_end_at || undefined,
        scheduled_duration_minutes: activeSession?.scheduledDurationMinutes || activeSession?.scheduled_duration_minutes || undefined,
        scheduledDurationMinutes: activeSession?.scheduledDurationMinutes || activeSession?.scheduled_duration_minutes || undefined,
        reference_date: activeSession?.referenceDate || activeSession?.reference_date || sessionClinicalDate || undefined,
        referenceDate: activeSession?.referenceDate || activeSession?.reference_date || sessionClinicalDate || undefined,
        attendance_status: attendanceStatus,
        attendanceStatus,
        ended_at: endedAt,
        endedAt,
        session_note: sessionNote,
        sessionNote,
        idempotencyKey,
        summary: {
          ...finalSummary,
          maintenanceSummary: finalMaintenanceSummary,
          attendanceStatus,
          source: 'verto_web'
        }
      };
      completionRequestRef.current ||= { payload: completionPayload, records };
      const completionResult = await dataService.completeAbaSession(sessionId, completionRequestRef.current.payload);
      if (!completionResult?.success) {
        if (completionResult?.status && completionResult.status < 500) completionRequestRef.current = null;
        const completionCode = String(completionResult?.code || completionResult?.error || '').trim();
        if (completionCode === 'APPOINTMENT_NO_SHOW_REOPEN_REQUIRED' && activeAppointmentId) {
          noShowReopenIdempotencyKeyRef.current = noShowReopenIdempotencyKeyRef.current || createSessionCompletionKey();
          setNoShowReopenError('');
          setNoShowReopenPromptOpen(true);
          completionRequestRef.current = null;
          setSessionEndError('A falta precisa ser reaberta antes de concluir esta sessão como comparecimento.');
          setSessionWarning('A sessão continua em andamento e nenhum dado clínico foi descartado.');
          return;
        }
        throw new Error(completionResult?.message || completionResult?.error || 'Não foi possível encerrar a sessão.');
      }

      const completionPending = completionResult?.pending === true || completionResult?.offline === true;
      const completionData = completionResult?.data || {};
      const resolvedOperationalClosure = completionPending
        ? { status: 'PENDING_SYNC', pendingSync: true, endedAt }
        : completionData?.closure || null;
      const persistedSummary = {
        ...finalSummary,
        maintenanceSummary: Array.isArray(completionData?.maintenanceSummary)
          ? completionData.maintenanceSummary
          : finalMaintenanceSummary,
        id: String(completionData?.summaryId || finalSummary.id),
        syncStatus: completionPending || hasDeferredOfflineWrites ? 'local' : 'synced',
        createdAt: completionData?.createdAt || finalSummary.createdAt,
        attendanceStatus: completionData?.attendanceStatus || attendanceStatus,
        billingStatus: completionData?.billingStatus || (NON_ATTENDANCE_STATUSES.has(attendanceStatus) ? 'NOT_BILLABLE' : 'PENDING_REVIEW'),
        operationalClosure: resolvedOperationalClosure
      } as SessionSummary & {
        attendanceStatus: SessionAttendanceStatus;
        billingStatus: string;
        operationalClosure?: any;
      };

      setSessionEndPreviewAt(String(completionData?.endedAt || endedAt));
      setPostClosureSummary(persistedSummary);
      setOperationalClosure(resolvedOperationalClosure);
      setSessionCompleted(true);
      setRecords(records);
      setOpenDurations([]);
      setRateWindow(null);
      setIntervalRun(null);
      setShowPostClosureReport(false);
      setShowComplementEditor(false);
      setShowSessionSummary(false);
      completionIdempotencyKeyRef.current = '';
      completionRequestRef.current = null;

      if (!completionPending && typeof onSessionSummaryPersisted === 'function') {
        void Promise.resolve(onSessionSummaryPersisted(persistedSummary)).catch((error: any) => {
          console.warn('[ABA] Não foi possível aplicar resumo de maestria no PEI local:', error);
        });
      }
      showClinicalToast(completionPending ? buildClinicalOfflineToast() : buildClinicalActionToast({ action: 'session_end' }));
    } catch (error: any) {
      console.error('Falha ao persistir encerramento atômico da sessão ABA:', error);
      setSessionEndError(error?.message || 'Não foi possível encerrar a sessão. Nenhum dado foi descartado.');
      setSessionWarning('A sessão continua em andamento. Corrija o problema e tente novamente.');
      showClinicalToast(buildClinicalSaveErrorToast(), 'error');
    } finally {
      setEndingSession(false);
    }
  };

  const handleReopenNoShowAndRetryCompletion = async () => {
    if (!activeAppointmentId || reopeningNoShow || endingSession) return;
    const reason = noShowReopenReason.trim();
    if (reason.length < 5) {
      setNoShowReopenError('Informe uma justificativa com pelo menos 5 caracteres.');
      return;
    }
    if (!canReopenNoShow) {
      setNoShowReopenError('Seu perfil não possui permissão para reabrir faltas. Solicite a um coordenador ou diretor e tente concluir novamente.');
      return;
    }

    setReopeningNoShow(true);
    setNoShowReopenError('');
    try {
      const result = await dataService.reopenAppointmentNoShow(activeAppointmentId, {
        patientId,
        patient_id: patientId,
        reason,
        idempotencyKey: noShowReopenIdempotencyKeyRef.current || createSessionCompletionKey(),
      });
      if (!result?.success) {
        throw new Error(result?.error || result?.message || 'Não foi possível reabrir a falta.');
      }
      setNoShowReopenPromptOpen(false);
      setNoShowReopenReason('');
      setSessionEndError('');
      setSessionWarning('Falta reaberta com histórico preservado. Tentando concluir a sessão novamente.');
      await confirmEndSession();
    } catch (error: any) {
      setNoShowReopenError(error?.message || 'Não foi possível reabrir a falta agora.');
    } finally {
      setReopeningNoShow(false);
    }
  };

  const sessionSummary = useMemo(() => {
    const trialTotal = records.filter((record) => record.kind === 'trial' && !record.therapeuticMeasurement).length;
    const behaviorTotal = records.filter((record) => record.kind === 'behavior' && !isCancelledIntervalClinicalRecord(record)).length;
    const errorTotal = records.filter((record) => record.syncStatus === 'error').length;
    const localTotal = records.filter((record) => record.syncStatus === 'local' || record.syncStatus === 'syncing').length;
    return { trialTotal, behaviorTotal, errorTotal, localTotal };
  }, [records]);

  const sessionClosureIssues = useMemo(() => buildSessionClosureIssues(), [attendanceStatus, records, openDurations, therapeuticTimers, intervalRun, promptSelectionGoal, sessionNote, patient?.abaBehaviorSettings, patient?.abaSettings, patient?.clinicSettings]);

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
      patientName: patientDisplayName,
      therapistId: resolvedTherapistId || null,
      therapistName: therapistDisplayName,
      startedAt: activeSession?.startedAt || endedAt,
      endedAt,
      trials: records.filter((record) => record.kind === 'trial' && !record.therapeuticMeasurement),
      behaviorEvents: records.filter((record) => record.kind === 'behavior' && !isCancelledIntervalClinicalRecord(record)),
      blockingItems: sessionClosureIssues.blockers,
      warningItems: sessionClosureIssues.warnings,
      sessionNote,
      syncStatus
    });
  }, [activeSession?.startedAt, patientDisplayName, patientId, records, resolvedTherapistId, sessionClosureIssues, sessionEndPreviewAt, sessionId, sessionNote, therapistDisplayName]);

  const overviewMaintenanceSchedules = Array.isArray(maintenanceOverview?.schedules) ? maintenanceOverview.schedules : [];
  const overviewAppointmentMaintenanceProbeSchedules = useMemo(() => {
    const appointmentId = String(activeAppointmentId || '').trim();
    if (!appointmentId) return [];
    return overviewMaintenanceSchedules.filter((schedule: any) => (
      String(schedule?.appointment_id || schedule?.appointmentId || schedule?.appointment?.id || '').trim() === appointmentId
    ));
  }, [activeAppointmentId, overviewMaintenanceSchedules]);
  const panelAppointmentMaintenanceProbeSchedules = useMemo(() => {
    const appointmentId = String(activeAppointmentId || '').trim();
    if (!appointmentId || !maintenancePanel?.sections) return [];
    const rows = [
      ...(maintenancePanel.sections.scheduled || []),
      ...(maintenancePanel.sections.waitingNextSession || []),
      ...(maintenancePanel.sections.overdue || [])
    ];
    const schedules = rows
      .map(getMaintenancePanelSchedule)
      .filter((schedule: any) => (
        schedule &&
        String(schedule?.appointment_id || schedule?.appointmentId || schedule?.appointment?.id || '').trim() === appointmentId
      ));
    return normalizeSessionMaintenanceProbeList(schedules.map((schedule: any) => ({ schedule })));
  }, [activeAppointmentId, maintenancePanel]);
  const overviewAppointmentMaintenanceProbeAvailability = useMemo(() => {
    if (!activeAppointmentId || overviewAppointmentMaintenanceProbeSchedules.length === 0) {
      return { available: [], upcoming: [], availableItems: [], upcomingItems: [], availableSchedule: null, upcomingSchedule: null };
    }
    return resolveMaintenanceProbeAvailability(overviewAppointmentMaintenanceProbeSchedules, {
      appointmentId: activeAppointmentId || null,
      sessionId,
      sessionClinicalDate,
      occurredAt: activeSession?.actualStartAt || activeSession?.actual_start_at || activeSession?.startedAt || activeSession?.started_at || new Date().toISOString(),
      timeZone: maintenanceTimeZone
    });
  }, [activeAppointmentId, activeSession?.actualStartAt, activeSession?.actual_start_at, activeSession?.startedAt, activeSession?.started_at, maintenanceTimeZone, overviewAppointmentMaintenanceProbeSchedules, sessionClinicalDate, sessionId]);
  const panelAppointmentMaintenanceProbeAvailability = useMemo(() => {
    if (!activeAppointmentId || panelAppointmentMaintenanceProbeSchedules.length === 0) {
      return { available: [], upcoming: [], availableItems: [], upcomingItems: [], availableSchedule: null, upcomingSchedule: null };
    }
    return resolveMaintenanceProbeAvailability(panelAppointmentMaintenanceProbeSchedules, {
      appointmentId: activeAppointmentId || null,
      sessionId,
      sessionClinicalDate,
      occurredAt: activeSession?.actualStartAt || activeSession?.actual_start_at || activeSession?.startedAt || activeSession?.started_at || new Date().toISOString(),
      timeZone: maintenanceTimeZone
    });
  }, [activeAppointmentId, activeSession?.actualStartAt, activeSession?.actual_start_at, activeSession?.startedAt, activeSession?.started_at, maintenanceTimeZone, panelAppointmentMaintenanceProbeSchedules, sessionClinicalDate, sessionId]);
  const sessionAvailableMaintenanceProbeSchedules = useMemo(() => {
    const serverScopedSchedules = normalizeSessionMaintenanceProbeList(sessionMaintenanceProbes?.available || []);
    if (activeTherapeuticPlanId) return serverScopedSchedules;
    return mergeMaintenanceScheduleLists(
      serverScopedSchedules,
      normalizeSessionMaintenanceProbeList(overviewAppointmentMaintenanceProbeAvailability.available || []),
      normalizeSessionMaintenanceProbeList(panelAppointmentMaintenanceProbeAvailability.available || [])
    );
  }, [activeTherapeuticPlanId, overviewAppointmentMaintenanceProbeAvailability.available, panelAppointmentMaintenanceProbeAvailability.available, sessionMaintenanceProbes]);
  const sessionUpcomingMaintenanceProbeSchedules = useMemo(() => {
    const serverScopedSchedules = normalizeSessionMaintenanceProbeList(sessionMaintenanceProbes?.upcoming || []);
    if (activeTherapeuticPlanId) return serverScopedSchedules;
    return mergeMaintenanceScheduleLists(
      serverScopedSchedules,
      normalizeSessionMaintenanceProbeList(overviewAppointmentMaintenanceProbeAvailability.upcoming || []),
      normalizeSessionMaintenanceProbeList(panelAppointmentMaintenanceProbeAvailability.upcoming || [])
    );
  }, [activeTherapeuticPlanId, overviewAppointmentMaintenanceProbeAvailability.upcoming, panelAppointmentMaintenanceProbeAvailability.upcoming, sessionMaintenanceProbes]);
  const sessionAvailableMaintenanceTargetIds = useMemo(() => new Set(
    sessionAvailableMaintenanceProbeSchedules
      .map((schedule: any) => maintenanceScheduleTargetId(schedule))
      .filter(Boolean)
  ), [sessionAvailableMaintenanceProbeSchedules]);
  const therapeuticSessionGoals = useMemo(
    () => therapeuticProgramsToSessionGoals(therapeuticPrograms),
    [therapeuticPrograms],
  );
  const activeTherapeuticProgramCount = useMemo(() => new Set(
    therapeuticSessionGoals.map((goal: any) => String(goal?.programId || goal?.program_id || '')).filter(Boolean),
  ).size, [therapeuticSessionGoals]);
  const baseSessionGoals = useMemo(
    () => mergeLegacyAndTherapeuticSessionGoals(
      activeTherapeuticPlanId ? [] : legacySessionGoals,
      therapeuticSessionGoals,
    ),
    [activeTherapeuticPlanId, legacySessionGoals, therapeuticSessionGoals],
  );
  const sessionGoals = useMemo(() => (
    mergeSessionGoalsWithAvailableMaintenance(baseSessionGoals, sessionAvailableMaintenanceProbeSchedules)
  ), [baseSessionGoals, sessionAvailableMaintenanceProbeSchedules]);
  const sessionPlanGoals = useMemo(() => {
    if (sessionPlanFilter === 'skills') {
      return sessionGoals.filter((goal: any) => !goal?.isMaintenanceProbeAvailableSessionGoal && !sessionAvailableMaintenanceTargetIds.has(goalTargetId(goal)));
    }
    if (sessionPlanFilter === 'maintenance') {
      return sessionGoals.filter((goal: any) => goal?.isMaintenanceProbeAvailableSessionGoal || sessionAvailableMaintenanceTargetIds.has(goalTargetId(goal)));
    }
    return sessionGoals;
  }, [sessionAvailableMaintenanceTargetIds, sessionGoals, sessionPlanFilter]);
  const activeTherapeuticTimerEntries = Object.values(therapeuticTimers);
  const focusTherapeuticTimerGoal = (timer: TherapeuticTimerState) => {
    const goal = sessionGoals.find((item: any) => therapeuticGoalKey(item) === timer.goalKey);
    if (!goal) return;
    const mobileGoalKey = String(goal?.id || goal?.target_id || goal?.targetId || goal?.name || 'goal');
    setSessionPlanFilter('all');
    setMobileSelectedGoalKey(mobileGoalKey);
    setClinicalDockSheetOpen(false);
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.setTimeout(() => {
        const targetCard = Array.from(document.querySelectorAll<HTMLElement>('[data-aba-mobile-goal-key]'))
          .find((element) => element.getAttribute('data-aba-mobile-goal-key') === mobileGoalKey);
        targetCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    }
  };

  const scrollClosureRefIntoView = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (typeof window === 'undefined') return;
    window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusable = ref.current?.querySelector<HTMLElement>('textarea, input, select, button:not([disabled])');
      focusable?.focus({ preventScroll: true });
    }, 0);
  };

  const focusSessionHistoryRecord = (recordId: string) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    window.setTimeout(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-aba-session-record-id]'))
        .find((element) => element.getAttribute('data-aba-session-record-id') === recordId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    }, 50);
  };

  const resolveClosureBlocker = (item: SessionSummaryPendingItem) => {
    if (endingSession) return;

    if (item.key === 'open_duration') {
      scrollClosureRefIntoView(closureDurationResolutionRef);
      return;
    }
    if (item.key === 'open_interval_collection') {
      scrollClosureRefIntoView(closureIntervalResolutionRef);
      return;
    }
    if (item.key === 'absence_with_clinical_records') {
      scrollClosureRefIntoView(closureAttendanceRef);
      return;
    }
    if (item.key === 'absence_reason_required') {
      scrollClosureRefIntoView(closureNoteRef);
      return;
    }

    if (item.key === 'v3_failed_trials_require_resolution' || item.key === 'server_sync_required' || item.key === 'unsaved_local_records') {
      const unsyncedRecord = records.find((record) => (
        record.syncStatus === 'error' || record.syncStatus === 'local' || record.syncStatus === 'syncing'
      ));
      if (unsyncedRecord) {
        setSessionHistoryOpen(true);
        returnToActiveSession();
        focusSessionHistoryRecord(unsyncedRecord.id);
        return;
      }
    }

    if (item.key === 'therapeutic_measurement_timer_open') {
      const timer = Object.values(therapeuticTimers)[0];
      returnToActiveSession();
      if (timer && typeof window !== 'undefined') {
        window.setTimeout(() => focusTherapeuticTimerGoal(timer), 50);
      }
      return;
    }

    if (item.key === 'incomplete_trial') {
      returnToActiveSession();
      return;
    }

    returnToActiveSession();
  };
  const abaV3SessionPlanTargetIds = useMemo(() => Array.from(new Set(
    sessionGoals.map((goal: any) => goalTargetId(goal)).filter(Boolean)
  )).slice(0, 200), [sessionGoals]);
  const abaV3SessionPlanTargetSignature = useMemo(() => abaV3SessionPlanTargetIds.slice().sort().join('|'), [abaV3SessionPlanTargetIds]);

  useEffect(() => {
    abaV3BindingCacheRef.current.clear();
    abaV3BindingInflightRef.current.clear();
    abaV3BehaviorBindingCacheRef.current.clear();
    if (!patientId || !sessionId || sessionId.startsWith('draft-')) {
      setAbaV3SessionPlan({ targets: [], v3_behavior_ids: [], complete: false });
      setAbaV3SessionPlanStatus('idle');
      return;
    }
    let cancelled = false;
    setAbaV3SessionPlanStatus('loading');
    dataService.getAbaV3SessionCollectionPlan({ patientId, sessionId, targetIds: abaV3SessionPlanTargetIds })
      .then((result: any) => {
        if (cancelled) return;
        if (!result?.success) {
          setAbaV3SessionPlan({ targets: [], v3_behavior_ids: [], complete: false });
          // A disabled server-side V3 read API means this is a pure Legacy
          // environment. Other failures remain visible/fail-safe.
          setAbaV3SessionPlanStatus(result?.code === 'feature_disabled' ? 'ready' : 'error');
          return;
        }
        const data = result?.data || {};
        setAbaV3SessionPlan({
          session_id: String(data?.session_id || sessionId),
          complete: data?.complete !== false,
          targets: Array.isArray(data?.targets) ? data.targets : [],
          v3_behavior_ids: Array.isArray(data?.v3_behavior_ids) ? data.v3_behavior_ids : []
        });
        setAbaV3SessionPlanStatus(data?.complete === false ? 'error' : 'ready');
      })
      .catch(() => {
        if (cancelled) return;
        setAbaV3SessionPlan({ targets: [], v3_behavior_ids: [], complete: false });
        setAbaV3SessionPlanStatus('error');
      });
    return () => { cancelled = true; };
  }, [abaV3SessionPlanTargetSignature, abaV3UiEnabled, patientId, sessionId]);

  useEffect(() => {
    if (abaV3SessionPlanStatus !== 'ready' || !mobileSelectedGoalKey) return;
    const selectedGoal = sessionGoals.find((goal: any) => (
      String(goal?.id || goal?.target_id || goal?.targetId || goal?.name || 'goal') === mobileSelectedGoalKey
    ));
    if (!selectedGoal) return;
    primeAbaV3BindingForGoal(selectedGoal);
  }, [abaV3SessionPlanStatus, mobileSelectedGoalKey, sessionGoals]);

  const planningTargetNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const goal of sessionGoals) {
      const targetId = goalTargetId(goal);
      const label = String(goal?.name || goal?.target_name || goal?.targetName || goal?.title || '').trim();
      if (targetId && label) names.set(targetId, label);
    }
    return names;
  }, [sessionGoals]);
  const planningDecisionQueue = useMemo(
    () => deduplicateAbaRecommendationsForDecisionQueue(planningRecommendations),
    [planningRecommendations]
  );
  const isPendingPlanningRecommendation = useCallback((recommendation: any) => {
    const status = String(recommendation?.status || 'SUGGESTED').toUpperCase();
    return status === 'SUGGESTED' || status === 'EDITED';
  }, []);
  const pendingPlanningRecommendations = useMemo(
    () => planningDecisionQueue.filter(isPendingPlanningRecommendation),
    [isPendingPlanningRecommendation, planningDecisionQueue]
  );
  const historyPlanningRecommendations = useMemo(
    () => planningDecisionQueue.filter((recommendation: any) => !isPendingPlanningRecommendation(recommendation)),
    [isPendingPlanningRecommendation, planningDecisionQueue]
  );
  const visiblePlanningRecommendations = useMemo(() => {
    const source = planningFilter === 'history' ? historyPlanningRecommendations : pendingPlanningRecommendations;
    if (planningFilter === 'high') return source.filter((item: any) => ['HIGH', 'CRITICAL'].includes(String(item?.priority || '').toUpperCase()));
    if (planningFilter === 'regression') return source.filter((item: any) => String(item?.recommendation_type || '').toUpperCase() === 'REGRESSION_ATTENTION');
    if (planningFilter === 'maintenance') return source.filter((item: any) => String(item?.recommendation_type || '').toUpperCase() === 'MAINTENANCE_PROBE');
    if (planningFilter === 'prompt_fading') return source.filter((item: any) => String(item?.recommendation_type || '').toUpperCase() === 'PROMPT_FADING');
    if (planningFilter === 'edited') return source.filter((item: any) => String(item?.status || '').toUpperCase() === 'EDITED');
    return source;
  }, [historyPlanningRecommendations, pendingPlanningRecommendations, planningFilter]);
  const planningRecommendationTitle = (recommendation: any) => {
    const rawTitle = formatAbaRecommendationTitle(recommendation?.title || '');
    const targetName = planningTargetNameById.get(String(recommendation?.target_id || recommendation?.targetId || '').trim());
    const type = String(recommendation?.recommendation_type || '').toUpperCase();
    if (targetName && (rawTitle === 'Ponto de atenção para regressão' || rawTitle === 'Atenção para regressão clínica')) {
      return `Atenção para regressão em “${targetName}”`;
    }
    if (targetName && rawTitle === 'Queda relevante em indicador clinico') {
      return `Queda de desempenho em “${targetName}”`;
    }
    if (targetName && rawTitle === 'Revisar reducao gradual de ajuda') {
      return `Reduzir ajuda em “${targetName}”`;
    }
    if (!rawTitle) return abaRecommendationTypeLabel(type);
    return rawTitle;
  };
  useEffect(() => {
    if (sessionPlanGoals.length === 0) {
      if (mobileSelectedGoalKey) setMobileSelectedGoalKey('');
      return;
    }
    setMobileSelectedGoalKey((current) => {
      const stillVisible = current && sessionPlanGoals.some((goal: any) => String(goal?.id || goal?.target_id || goal?.targetId || goal?.name || '') === current);
      if (stillVisible) return current;
      const first = sessionPlanGoals[0];
      return String(first?.id || first?.target_id || first?.targetId || first?.name || '');
    });
  }, [mobileSelectedGoalKey, sessionPlanGoals]);
  const maintenanceSchedules = useMemo(() => mergeMaintenanceScheduleLists(
    sessionAvailableMaintenanceProbeSchedules,
    sessionUpcomingMaintenanceProbeSchedules,
    overviewMaintenanceSchedules,
    panelAppointmentMaintenanceProbeSchedules
  ), [overviewMaintenanceSchedules, panelAppointmentMaintenanceProbeSchedules, sessionAvailableMaintenanceProbeSchedules, sessionUpcomingMaintenanceProbeSchedules]);
  const maintenanceProbeResults = Array.isArray(maintenanceOverview?.probeResults) ? maintenanceOverview.probeResults : [];
  const regressionAlerts = Array.isArray(maintenanceOverview?.alerts) ? maintenanceOverview.alerts : [];

  const targetMatchesGoal = (row: any, goalId: string) => {
    const rowTargetId = String(row?.target_id || row?.targetId || row?.target?.id || row?.schedule?.target_id || row?.schedule?.targetId || '').trim();
    return Boolean(goalId && rowTargetId && rowTargetId === goalId);
  };

  const formatMaintenanceDueLabel = (schedule: any) => (
    typeof schedule === 'object'
      ? formatMaintenanceScheduleDueLabel(schedule)
      : formatMaintenanceScheduleDueLabel({ scheduled_for: schedule })
  );

  const maintenanceStatusLabel = (status: any) => {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'MAINTAINED') return 'Mantido';
    if (normalized === 'REGRESSION_RISK') return 'Risco de regressao';
    if (normalized === 'WATCH') return 'Observar';
    return 'Sem probe recente';
  };

  const getGoalMaintenanceInfo = (goal: any) => {
    const goalId = goalTargetId(goal);
    const goalName = String(goal?.name || goal?.target_name || goal?.targetName || 'Meta').trim();
    const schedules = maintenanceSchedules
      .filter((schedule: any) => targetMatchesGoal(schedule, goalId))
      .filter((schedule: any) => isPeiClinicalRowAfterProgressReset(goal, schedule))
      .sort((a: any, b: any) => new Date(a?.scheduled_for || a?.scheduledFor || a?.target_due_date || a?.targetDueDate || 0).getTime() - new Date(b?.scheduled_for || b?.scheduledFor || b?.target_due_date || b?.targetDueDate || 0).getTime());
    const availableSchedulesForSession = sessionAvailableMaintenanceProbeSchedules
      .filter((schedule: any) => targetMatchesGoal(schedule, goalId))
      .filter((schedule: any) => isPeiClinicalRowAfterProgressReset(goal, schedule));
    const upcomingSchedulesForSession = sessionUpcomingMaintenanceProbeSchedules
      .filter((schedule: any) => targetMatchesGoal(schedule, goalId))
      .filter((schedule: any) => isPeiClinicalRowAfterProgressReset(goal, schedule));
    const probeResults = maintenanceProbeResults
      .filter((result: any) => targetMatchesGoal(result, goalId))
      .filter((result: any) => isPeiClinicalRowAfterProgressReset(goal, result))
      .sort((a: any, b: any) => new Date(b?.occurred_at || b?.occurredAt || 0).getTime() - new Date(a?.occurred_at || a?.occurredAt || 0).getTime());
    const alerts = regressionAlerts
      .filter((alert: any) => targetMatchesGoal(alert, goalId))
      .filter((alert: any) => isPeiClinicalRowAfterProgressReset(goal, alert))
      .sort((a: any, b: any) => new Date(b?.created_at || b?.createdAt || 0).getTime() - new Date(a?.created_at || a?.createdAt || 0).getTime());
    const availability = sessionId.startsWith('draft-')
      ? resolveMaintenanceProbeAvailability(schedules, {
        appointmentId: activeAppointmentId || null,
        sessionId,
        sessionClinicalDate,
        occurredAt: new Date(nowMs),
        timeZone: maintenanceTimeZone
      })
      : sessionMaintenanceProbes?.loaded === true ? {
        availableSchedule: availableSchedulesForSession[0] || null,
        upcomingSchedule: upcomingSchedulesForSession[0] || null,
        availableItems: availableSchedulesForSession.map((schedule: any) => ({ schedule, reason: schedule?.availabilityReason || 'MATCHING_APPOINTMENT' })),
        upcomingItems: upcomingSchedulesForSession.map((schedule: any) => ({ schedule, reason: schedule?.availabilityReason || 'UPCOMING_OR_DIFFERENT_SESSION' }))
      } : {
        availableSchedule: null,
        upcomingSchedule: null,
        availableItems: [],
        upcomingItems: []
      };
    const nextSchedule = availability.availableSchedule ||
      availability.upcomingSchedule ||
      schedules.find((schedule: any) => ['PENDING', 'SCHEDULED', 'UNSCHEDULED', 'DUE_TODAY', 'OVERDUE', 'MISSED'].includes(String(schedule?.status || '').toUpperCase())) ||
      schedules[0] ||
      null;
    let consecutiveFailures = 0;
    for (const result of probeResults) {
      const status = String(result?.status || '').toUpperCase();
      if (status !== 'WATCH' && status !== 'REGRESSION_RISK') break;
      consecutiveFailures += 1;
    }
    return {
      isMaintenanceTarget: isMaintenanceLikeGoal(goal) || schedules.length > 0 || probeResults.length > 0 || alerts.length > 0,
      nextSchedule,
      availableSchedule: availability.availableSchedule,
      upcomingSchedule: availability.upcomingSchedule,
      hasAvailableMaintenanceProbe: Boolean(availability.availableSchedule),
      hasUpcomingMaintenanceProbe: Boolean(availability.upcomingSchedule),
      maintenanceAvailability: availability,
      lastResult: probeResults[0] || null,
      activeAlert: alerts[0] || null,
      probeResults,
      consecutiveFailures
    };
  };

  const teachingMasteryRows = useMemo(() => sessionGoals.map((goal: any) => {
    const goalId = goalTargetId(goal);
    const peiGoalId = String(goal?.peiGoalId || goal?.pei_goal_id || goal?.goalId || goal?.goal_id || goal?.id || '').trim();
    const skillId = String(goal?.skillId || goal?.skill_id || '').trim();
    const localTargetRef = String(goal?.localTargetRef || goal?.local_target_ref || goal?.id || '').trim();
    const goalName = String(goal?.name || goal?.target_name || goal?.targetName || 'Meta').trim();
    const goalTrials = records.filter((record) => sessionRecordMatchesTeachingGoal(record, goal));
    const criterion = buildSessionGoalMasteryCriterion(goal);
    const previousGoalEvaluations = priorMasteryEvaluations.filter((row: any) => {
      const previousTargetId = String(row?.target_id || row?.targetId || '').trim();
      const previousTargetName = String(row?.target_name || row?.targetName || '').trim();
      return (goalId && previousTargetId === goalId) || (!previousTargetId && previousTargetName === goalName);
    });
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
        latency_ms: record.latencyMs ?? null,
        raw_payload: record.rawPayload || null,
        occurred_at: record.timestamp
      })),
      previousEvaluations: previousGoalEvaluations,
      evaluatedAt: sessionEndPreviewAt || new Date().toISOString()
    });
    return {
      id: goal.id || goalId || goalName,
      targetId: goalId || null,
      target_id: goalId || null,
      goalId: peiGoalId || null,
      goal_id: peiGoalId || null,
      peiGoalId: peiGoalId || null,
      pei_goal_id: peiGoalId || null,
      skillId: skillId || null,
      skill_id: skillId || null,
      localTargetRef: localTargetRef || null,
      local_target_ref: localTargetRef || null,
      name: goalName,
      criterion: evaluation.criterionLabel || formatAbaMasteryCriterion(criterion as any),
      criterionSourceLabel: criterion ? abaMasteryCriterionSourceLabel(criterion) : 'Criterio de maestria nao configurado',
      performanceText: evaluation.performanceText,
      contributes: evaluation.status === 'MET_TODAY' || evaluation.status === 'READY_FOR_REVIEW',
      status: masteryStatusLabel(evaluation.status),
      statusCode: evaluation.status,
      totalTrials: evaluation.totalTrials,
      independentTrials: evaluation.independentTrials,
      consecutiveIndependentTrials: evaluation.consecutiveIndependentTrials,
      promptedTrials: evaluation.promptedTrials,
      errorTrials: evaluation.errorTrials,
      accuracyPercent: evaluation.accuracyPercent,
      independencePercent: evaluation.independencePercent,
      consecutiveSuccessfulDays: evaluation.consecutiveSuccessfulDays,
      successfulSessions: evaluation.successfulSessions,
      criterionProgressCount: evaluation.criterionProgressCount,
      criterionRequiredCount: evaluation.criterionRequiredCount,
      criterionProgressLabel: evaluation.criterionProgressLabel,
      criterionProgressKind: evaluation.criterionProgressKind,
      criterionProgressPrefix: evaluation.criterionProgressKind === 'consecutive_independent'
        ? 'Sequência'
        : evaluation.criterionProgressKind === 'sessions'
          ? 'Sessões'
          : evaluation.criterionProgressKind === 'measurement'
            ? 'Medida'
            : 'Hoje',
      sequenceBrokenByLastTrial: evaluation.sequenceBrokenByLastTrial,
      reasons: evaluation.reasons
    };
  }), [patientId, priorMasteryEvaluations, records, resolvedClinicId, resolvedTherapistId, sessionEndPreviewAt, sessionGoals, sessionId]);

  useEffect(() => {
    if (typeof onMasteryPreviewChanged !== 'function' || isCompletedSessionReview) return;
    const evaluatedAt = sessionEndPreviewAt || new Date().toISOString();
    const previewRows = teachingMasteryRows.map((row: any) => ({
      id: `live-mastery-${sessionId}-${String(row?.targetId || row?.id || row?.name || 'target')}`,
      patient_id: patientId,
      patientId,
      session_id: sessionId,
      sessionId,
      target_id: row?.targetId || row?.target_id || null,
      targetId: row?.targetId || row?.target_id || null,
      target_name: row?.name || null,
      targetName: row?.name || null,
      status: row?.statusCode || null,
      statusCode: row?.statusCode || null,
      evaluation_status: String(row?.statusCode || '').toUpperCase() === 'MASTERED_APPROVED' ? 'mastered' : 'not_met',
      criterion_progress_count: Number(row?.criterionProgressCount || 0),
      criterionProgressCount: Number(row?.criterionProgressCount || 0),
      consecutive_successes: Number(row?.criterionProgressCount || 0),
      consecutiveSuccesses: Number(row?.criterionProgressCount || 0),
      criterion_required_count: Number(row?.criterionRequiredCount || 1),
      criterionRequiredCount: Number(row?.criterionRequiredCount || 1),
      min_consecutive_successes: Number(row?.criterionRequiredCount || 1),
      minConsecutiveSuccesses: Number(row?.criterionRequiredCount || 1),
      evaluated_at: evaluatedAt,
      evaluatedAt,
      live_preview: true,
      livePreview: true
    }));
    onMasteryPreviewChanged(previewRows);
  }, [isCompletedSessionReview, onMasteryPreviewChanged, patientId, sessionEndPreviewAt, sessionId, teachingMasteryRows]);

  const maintenanceProbeRows = useMemo(() => sessionGoals
    .map((goal: any) => {
      const goalId = String(goal?.id || goal?.target_id || goal?.targetId || '').trim();
      const goalName = String(goal?.name || goal?.target_name || goal?.targetName || 'Meta').trim();
      const goalTrials = records.filter((record) => {
        if (record.kind !== 'trial') return false;
        if (!isMaintenanceProbeCollection(record.collectionType)) return false;
        const recordTargetId = String(record.targetId || '').trim();
        if (goalId && recordTargetId && recordTargetId === goalId) return true;
        return String(record.title || record.targetName || '').trim() === goalName;
      });
      const info = getGoalMaintenanceInfo(goal);
      if (goalTrials.length === 0 && !info.isMaintenanceTarget) return null;
      const display = resolveMaintenanceTargetDisplay({
        target: goal,
        schedule: info.nextSchedule || info.lastResult || info.activeAlert || {
          target_id: goalId || null,
          target_name: goalName,
          protocolTitle: goal?.protocolTitle,
          protocol_title: goal?.protocol_title,
          domainName: goal?.domainName,
          domain_name: goal?.domain_name
        },
        recentResult: info.lastResult
      });
      const criterion = buildSessionGoalMasteryCriterion(goal);
      const evaluation = evaluateMaintenanceStatus({
        organizationId: resolvedClinicId || 'local',
        patientId,
        targetId: goalId,
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
        name: display.targetDisplayName,
        protocol: display.protocolDisplayName,
        domain: display.domainDisplayName,
        contextLabel: display.contextLabel,
        milestoneLabel: display.clinicalMilestoneLabel,
        recentResultLabel: display.recentResultLabel,
        nextSchedule: info.nextSchedule,
        availableSchedule: info.availableSchedule,
        upcomingSchedule: info.upcomingSchedule,
        hasAvailableMaintenanceProbe: info.hasAvailableMaintenanceProbe,
        hasUpcomingMaintenanceProbe: info.hasUpcomingMaintenanceProbe,
        maintenanceAvailability: info.maintenanceAvailability,
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
    .filter((row): row is any => Boolean(row)), [activeAppointmentId, maintenanceOverview, maintenanceSchedules, maintenanceTimeZone, patientId, records, resolvedClinicId, resolvedTherapistId, sessionAvailableMaintenanceProbeSchedules, sessionClinicalDate, sessionEndPreviewAt, sessionGoals, sessionId, sessionMaintenanceProbes?.loaded, sessionUpcomingMaintenanceProbeSchedules]);

  const maintenanceProbeQueueItems = useMemo(() => {
    return sessionAvailableMaintenanceProbeSchedules.map((schedule: any) => {
      const targetId = maintenanceScheduleTargetId(schedule);
      const scheduleId = String(schedule?.id || schedule?.schedule_id || schedule?.scheduleId || '').trim();
      const display = resolveMaintenanceTargetDisplay({
        target: {
          id: targetId,
          target_id: targetId,
          targetId,
          name: schedule?.targetName || schedule?.target_name || schedule?.target?.name,
          targetName: schedule?.targetName || schedule?.target_name || schedule?.target?.name,
          protocolTitle: schedule?.protocolTitle || schedule?.protocol_title,
          protocol_title: schedule?.protocol_title || schedule?.protocolTitle,
          domainName: schedule?.domainName || schedule?.domain_name,
          domain_name: schedule?.domain_name || schedule?.domainName
        },
        schedule
      });
      const registeredRecords = records.filter((record) => {
        if (record.kind !== 'trial' || !isMaintenanceProbeCollection(record.collectionType)) return false;
        const recordTargetId = String(record.targetId || '').trim();
        const recordScheduleId = String(
          record.rawPayload?.maintenanceScheduleId ||
          record.rawPayload?.maintenance_schedule_id ||
          record.rawPayload?.scheduleId ||
          record.rawPayload?.schedule_id ||
          ''
        ).trim();
        if (scheduleId && recordScheduleId && recordScheduleId === scheduleId) return true;
        return Boolean(targetId && recordTargetId && recordTargetId === targetId);
      });
      const active = Boolean(targetId && activeMaintenanceProbeTargetId === targetId && isMaintenanceProbeCollection(collectionType));
      return {
        id: scheduleId || targetId,
        scheduleId,
        targetId,
        name: display.targetDisplayName || schedule?.targetName || schedule?.target_name || 'Sondagem de manutenção',
        protocol: display.protocolDisplayName,
        domain: display.domainDisplayName,
        contextLabel: display.contextLabel,
        nextSchedule: schedule,
        registeredRecords,
        registered: registeredRecords.length > 0,
        active,
        status: active ? 'active' : registeredRecords.length > 0 ? 'registered' : 'pending'
      };
    });
  }, [activeMaintenanceProbeTargetId, collectionType, records, sessionAvailableMaintenanceProbeSchedules]);

  const maintenanceProbeRegisteredCount = maintenanceProbeQueueItems.filter((item: any) => item.registered).length;
  const maintenanceProbePendingCount = maintenanceProbeQueueItems.filter((item: any) => !item.registered).length;
  const shouldShowMaintenanceStartPrompt = Boolean(
    !sessionCompleted &&
    !isCompletedSessionReview &&
    !sessionId.startsWith('draft-') &&
    sessionMaintenanceProbes?.loaded &&
    maintenanceProbePendingCount > 0 &&
    maintenanceStartDecision === '' &&
    records.length === 0
  );

  const acceptDueMaintenanceProbesForSession = () => {
    setMaintenanceStartDecision('added');
    setSessionPlanFilter('maintenance');
    setMaintenanceProbeQueueExpanded(true);
    showClinicalToast({
      variant: 'success',
      title: `${maintenanceProbePendingCount} sondagem(ns) adicionada(s) ao foco da sessão.`,
      subtitle: 'Nada foi ativado automaticamente; escolha a sondagem quando for coletar.'
    }, 'none');
  };

  const reviewDueMaintenanceProbesForSession = () => {
    setMaintenanceStartDecision('review');
    setSessionPlanFilter('maintenance');
    setMaintenanceProbeQueueExpanded(true);
    showClinicalToast({
      variant: 'info',
      title: 'Sondagens abertas para revisão.',
      subtitle: 'Revise os alvos e ative somente o que fizer sentido nesta sessão.'
    }, 'none');
  };

  const skipDueMaintenanceProbesForSession = () => {
    setMaintenanceStartDecision('skipped');
    showClinicalToast({
      variant: 'info',
      title: 'Sondagens mantidas pendentes.',
      subtitle: 'Nenhuma sondagem foi cancelada ou marcada como concluída.'
    }, 'none');
  };
  const filteredMaintenanceProbeQueueItems = useMemo(() => {
    if (maintenanceProbeQueueFilter === 'pending') return maintenanceProbeQueueItems.filter((item: any) => !item.registered);
    if (maintenanceProbeQueueFilter === 'registered') return maintenanceProbeQueueItems.filter((item: any) => item.registered);
    return maintenanceProbeQueueItems;
  }, [maintenanceProbeQueueFilter, maintenanceProbeQueueItems]);
  const visibleMaintenanceProbeQueueItems = maintenanceProbeQueueExpanded
    ? filteredMaintenanceProbeQueueItems
    : filteredMaintenanceProbeQueueItems.slice(0, 5);

  const appointmentLinkedMaintenanceProbeCount = useMemo(() => {
    const appointmentId = String(activeAppointmentId || '').trim();
    if (!appointmentId) return 0;
    const scheduleIds = new Set<string>();
    maintenanceSchedules.forEach((schedule: any) => {
      const scheduleAppointmentId = String(schedule?.appointment_id || schedule?.appointmentId || schedule?.appointment?.id || '').trim();
      const scheduleId = String(schedule?.id || schedule?.schedule_id || schedule?.scheduleId || '').trim();
      if (scheduleAppointmentId === appointmentId && scheduleId) scheduleIds.add(scheduleId);
    });
    return scheduleIds.size;
  }, [activeAppointmentId, maintenanceSchedules]);
  const sessionMaintenanceProbeDiagnostics = sessionMaintenanceProbes?.diagnostics || null;

  const showLinkedMaintenanceProbeLoadWarning = Boolean(
    activeAppointmentId &&
    sessionMaintenanceProbes?.loaded &&
    !sessionMaintenanceProbes?.error &&
    appointmentLinkedMaintenanceProbeCount > 0 &&
    sessionAvailableMaintenanceProbeSchedules.length === 0 &&
    sessionUpcomingMaintenanceProbeSchedules.length === 0
  );

  const upcomingMaintenanceProbeItems = useMemo(() => {
    return sessionUpcomingMaintenanceProbeSchedules
      .filter((schedule: any) => !sessionAvailableMaintenanceProbeSchedules.some((available: any) => String(available?.id || available?.scheduleId || '') === String(schedule?.id || schedule?.scheduleId || '')))
      .map((schedule: any) => ({
        id: `upcoming-${String(schedule?.id || schedule?.scheduleId || schedule?.targetId || schedule?.target_id || '')}`,
        targetId: maintenanceScheduleTargetId(schedule) || null,
        name: String(schedule?.targetName || schedule?.target_name || schedule?.target?.name || 'Sondagem de manutenção').trim(),
        nextSchedule: schedule,
        availabilityReason: schedule?.availabilityReason || null
      }))
      .slice(0, 6);
  }, [sessionAvailableMaintenanceProbeSchedules, sessionUpcomingMaintenanceProbeSchedules]);
  const firstUpcomingMaintenanceProbeItem = upcomingMaintenanceProbeItems[0] || null;

  const maintenanceSessionSummaryRows = useMemo(() => {
    return maintenanceProbeRows
      .filter((row: any) => (
        row.hasAvailableMaintenanceProbe ||
        row.totalTrials > 0 ||
        Boolean(row.activeAlert || row.lastResult) ||
        row.consecutiveFailureCount > 0
      ))
      .slice(0, 3);
  }, [maintenanceProbeRows]);

  const openMaintenanceProbeQueueItem = (item: any) => {
    const targetId = String(item?.targetId || '').trim();
    const goal = sessionGoals.find((entry: any) => goalTargetId(entry) === targetId) ||
      buildSessionGoalFromAvailableMaintenanceSchedule(item?.nextSchedule);
    if (!targetId || !goal) return;
    setExpandedMaintenanceProbeTargetId(targetId);
    setMobileSelectedGoalKey(targetId);
    const activated = activateMaintenanceProbeMode(goal);
    if (!activated) setExpandedMaintenanceProbeTargetId(null);
  };

  const refreshSessionMaintenanceProbes = async () => {
    const nextState = await loadSessionMaintenanceProbeState('manual_reload');
    setSessionMaintenanceProbes(nextState);
  };

  const refreshMaintenanceOverview = async () => {
    try {
      const result = await dataService.getAbaMaintenanceOverview(patientId, { page: 1, pageSize: 20, appointmentId: activeAppointmentId || undefined });
      setMaintenanceOverview(result?.data || { schedules: [], probeResults: [], alerts: [], summary: null });
    } catch {
      setMaintenanceOverview((prev: any) => prev || { schedules: [], probeResults: [], alerts: [], summary: null });
    }
    await refreshSessionMaintenanceProbes();
  };

  useEffect(() => {
    let cancelled = false;
    if (!maintenanceScheduleModalGoal || !patientId) return;
    setMaintenanceAppointmentsState({ loading: true, error: '', items: [] });
    dataService.getAbaFutureAppointmentsForMaintenance(patientId, { limit: 20 })
      .then((result: any) => {
        if (cancelled) return;
        setMaintenanceAppointmentsState({
          loading: false,
          error: result?.success === false ? result?.error || 'Nao foi possivel carregar proximas sessoes.' : '',
          items: Array.isArray(result?.data) ? result.data : []
        });
      })
      .catch(() => {
        if (!cancelled) setMaintenanceAppointmentsState({ loading: false, error: 'Nao foi possivel carregar proximas sessoes.', items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [maintenanceScheduleModalGoal, patientId]);

  const formatMaintenanceAppointmentLine = (appointment: any) => {
    const scheduledAt = new Date(appointment?.scheduled_at || appointment?.scheduledAt || appointment?.scheduledAtIso || '');
    const date = Number.isNaN(scheduledAt.getTime())
      ? 'Data a definir'
      : scheduledAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const time = Number.isNaN(scheduledAt.getTime())
      ? ''
      : scheduledAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const type = safeDisplayValue(appointment?.type || appointment?.service_type || appointment?.approach, 'Sessao');
    const professional = safeDisplayValue(appointment?.therapistName || appointment?.therapist_name || appointment?.professionalName, 'Equipe');
    const location = safeDisplayValue(appointment?.location || appointment?.roomName || appointment?.room_name, 'Local a definir');
    const probeCount = Number(appointment?.maintenanceProbeCount ?? appointment?.maintenance_probe_count ?? 0);
    return `${date}${time ? ` as ${time}` : ''} - ${type} - ${professional} - ${location}${probeCount > 0 ? ` - ${probeCount} probe(s)` : ''}`;
  };

  const maintenanceAppointments = maintenanceAppointmentsState.items;
  const firstMaintenanceAppointment = maintenanceAppointments[0] || null;
  const selectedMaintenanceAppointment = maintenanceAppointments.find((appointment: any) => String(appointment?.id || '') === maintenanceSelectedAppointmentId) || null;
  const customDateAppointments = useMemo(() => {
    if (!maintenanceCustomDate) return { sameDay: null, nearest: null };
    const targetMs = new Date(`${maintenanceCustomDate}T12:00:00`).getTime();
    const sorted = maintenanceAppointments
      .map((appointment: any) => {
        const date = new Date(appointment?.scheduled_at || appointment?.scheduledAt || '');
        return { appointment, date, distance: Math.abs(date.getTime() - targetMs) };
      })
      .filter((item: any) => !Number.isNaN(item.date.getTime()))
      .sort((a: any, b: any) => a.distance - b.distance);
    const sameDay = sorted.find((item: any) => item.date.toISOString().slice(0, 10) === maintenanceCustomDate)?.appointment || null;
    return { sameDay, nearest: sorted[0]?.appointment || null };
  }, [maintenanceAppointments, maintenanceCustomDate]);

  const maintenancePlanPreview = useMemo(() => {
    const base = new Date();
    return [7, 14, 30, 60].map((day) => {
      const target = new Date(base);
      target.setDate(target.getDate() + day);
      const targetMs = target.getTime();
      const match = maintenanceAppointments
        .map((appointment: any) => {
          const date = new Date(appointment?.scheduled_at || appointment?.scheduledAt || '');
          return { appointment, date, distance: Math.abs(date.getTime() - targetMs) };
        })
        .filter((item: any) => !Number.isNaN(item.date.getTime()) && item.distance <= 14 * 86_400_000)
        .sort((a: any, b: any) => a.distance - b.distance)[0]?.appointment || null;
      return {
        day,
        targetDate: target.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        appointment: match
      };
    });
  }, [maintenanceAppointments]);

  const buildMaintenanceSchedulePayload = (goal: any, extra: any = {}) => {
    const explicitAppointmentId = extra.appointmentId || extra.appointment_id || (maintenanceScheduleMode === 'CUSTOM_DATE' ? maintenanceSelectedAppointmentId : '');
    return {
      patient_id: patientId,
      patientId,
      appointment_id: explicitAppointmentId || undefined,
      appointmentId: explicitAppointmentId || undefined,
      organization_id: resolvedClinicId,
      organizationId: resolvedClinicId,
      scheduleMode: maintenanceScheduleMode,
      dueDate: maintenanceCustomDate ? new Date(`${maintenanceCustomDate}T12:00:00`).toISOString() : undefined,
      intervals: [7, 14, 30, 60],
      target_name: goal?.name || goal?.target_name || goal?.targetName,
      ...extra
    };
  };

  const openMaintenanceScheduleModal = (goal: any) => {
    setMaintenanceScheduleModalGoal(goal);
    setMaintenanceScheduleMode('NEXT_PATIENT_SESSION');
    setMaintenanceCustomDate('');
    setMaintenanceSelectedAppointmentId('');
    setPlanningMessage('');
  };

  const handleScheduleMaintenanceGoal = async () => {
    if (!maintenanceScheduleModalGoal) return;
    if (maintenanceScheduleMode === 'CUSTOM_DATE' && !maintenanceCustomDate) {
      setPlanningMessage('Escolha uma data para agendar esta sondagem.');
      return;
    }
    setMaintenanceScheduleSaving(true);
    try {
      const targetId = goalTargetId(maintenanceScheduleModalGoal);
      const payload = buildMaintenanceSchedulePayload(maintenanceScheduleModalGoal);
      const result = maintenanceScheduleMode === 'NEXT_PATIENT_SESSION'
        ? await dataService.scheduleMaintenanceForNextSession(targetId, { ...payload, scheduleMode: 'NEXT_PATIENT_SESSION' })
        : await dataService.createMaintenanceScheduleForTarget(targetId, payload);
      if (result?.success === false) {
        setPlanningMessage(result?.error || 'Nao foi possivel agendar a sondagem agora.');
        return;
      }
      await refreshMaintenanceOverview();
      setMaintenanceScheduleModalGoal(null);
      const rows = Array.isArray(result?.data) ? result.data : [];
      const hasPendingNextSession = rows.some((row: any) => String(row?.status || '').toUpperCase() === 'PENDING_NEXT_SESSION');
      const hasPendingLink = rows.some((row: any) => ['PENDING_LINK', 'PENDING_SCHEDULING', 'UNSCHEDULED'].includes(String(row?.status || '').toUpperCase()));
      showClinicalToast({
        variant: 'success',
        title: hasPendingNextSession ? 'Sondagem pendente' : 'Sondagem agendada',
        subtitle: hasPendingNextSession
          ? 'Aguardando a proxima sessao do paciente para sugerir o vinculo.'
          : hasPendingLink
            ? 'Sem sessao vinculada agora; a pendencia foi preservada.'
            : 'Sondagem de manutenção salva na agenda clinica.'
      }, 'none');
    } finally {
      setMaintenanceScheduleSaving(false);
    }
  };

  const handleScheduleMaintenanceForNextSession = async (goal: any) => {
    const targetId = goalTargetId(goal);
    if (!targetId) return;
    setMaintenanceScheduleSaving(true);
    try {
      const result = await dataService.scheduleMaintenanceForNextSession(targetId, buildMaintenanceSchedulePayload(goal, { scheduleMode: 'NEXT_PATIENT_SESSION' }));
      if (result?.success === false) {
        openMaintenanceScheduleModal(goal);
        setMaintenanceScheduleMode('NEXT_PATIENT_SESSION');
        setPlanningMessage(result?.error || 'Nao foi possivel registrar a intencao para a proxima sessao.');
        return;
      }
      await refreshMaintenanceOverview();
      const rows = Array.isArray(result?.data) ? result.data : [];
      const hasPendingNextSession = rows.some((row: any) => String(row?.status || '').toUpperCase() === 'PENDING_NEXT_SESSION');
      showClinicalToast({
        variant: 'success',
        title: hasPendingNextSession ? 'Sondagem pendente' : 'Agendada para a proxima sessao',
        subtitle: hasPendingNextSession
          ? 'Nao ha proxima sessao agendada. A sondagem sera sugerida quando uma nova sessao for marcada.'
          : 'A sondagem foi vinculada ao proximo atendimento.'
      }, 'none');
    } finally {
      setMaintenanceScheduleSaving(false);
    }
  };

  const handleGeneratePlanningRecommendations = async () => {
    if (planningGenerationInFlightRef.current) return;
    planningGenerationInFlightRef.current = true;
    setPlanningLoading(true);
    setPlanningMessage('');
    try {
      const result = await dataService.generateNextSessionRecommendations(patientId, {
        sourceSessionId: postClosureSummary?.sessionId || sessionId,
        focusType: planningFocusType
      });
      if (result?.success === false) {
        setPlanningMessage(result?.error || 'Nao foi possivel gerar sugestoes agora.');
        return;
      }
      const generatedRows = Array.isArray(result?.data) ? result.data : [];
      setPlanningRecommendations((previous) => deduplicateAbaRecommendationsForDecisionQueue([
        ...generatedRows,
        ...previous
      ]));
      setPlanningFilter('pending');
      if (result?.reusedExisting) setPlanningMessage('Sugestoes existentes reutilizadas para este contexto.');
    } finally {
      planningGenerationInFlightRef.current = false;
      setPlanningLoading(false);
    }
  };

  const applyPlanningDecisionResult = (result: any, fallbackRecommendationId: string) => {
    if (!result?.data) return;
    const canonicalId = String(result.data?.id || fallbackRecommendationId);
    const groupedIds = new Set<string>(
      (Array.isArray(result?.groupedRecommendationIds) ? result.groupedRecommendationIds : [])
        .map((value: any) => String(value || ''))
        .filter(Boolean)
    );
    setPlanningRecommendations((previous) => {
      const withoutGroupedCopies = previous.filter((item) => {
        const itemId = String(item?.id || '');
        return !groupedIds.has(itemId) || itemId === canonicalId;
      });
      const hasCanonical = withoutGroupedCopies.some((item) => String(item?.id || '') === canonicalId);
      if (!hasCanonical) return [result.data, ...withoutGroupedCopies];
      return withoutGroupedCopies.map((item) => String(item?.id || '') === canonicalId ? result.data : item);
    });
  };

  const handleAcceptRecommendation = async (recommendation: any, applyToNextSession = true) => {
    const recommendationId = String(recommendation?.id || '');
    if (!recommendationId || planningDecisionInFlightRef.current.has(recommendationId)) return false;
    planningDecisionInFlightRef.current.add(recommendationId);
    setPlanningDecisionLoadingId(recommendationId);
    setPlanningMessage('');
    try {
      const result = applyToNextSession
        ? await dataService.applyAbaRecommendationToNextSession(recommendationId)
        : await dataService.acceptAbaRecommendation(recommendationId);
      if (result?.success === false) {
        applyPlanningDecisionResult(result, recommendationId);
        setPlanningMessage(result?.error || 'Nao foi possivel atualizar a sugestao agora.');
        return false;
      }
      applyPlanningDecisionResult(result, recommendationId);
      if (result?.planItem) {
        setNextSessionPlanItems((prev) => [result.planItem, ...prev.filter((item) => item.id !== result.planItem.id)]);
        setPlanningMessage('Sugestao aceita e adicionada ao plano da proxima sessao.');
      } else {
        setPlanningMessage('Sugestao aceita para a proxima sessao.');
      }
      return true;
    } finally {
      planningDecisionInFlightRef.current.delete(recommendationId);
      setPlanningDecisionLoadingId('');
    }
  };

  const handleAcceptMaintenanceRecommendation = async (
    recommendation: any,
    scheduleMode: 'NEXT_PATIENT_SESSION' | 'CUSTOM_DATE' | 'DEFAULT_SEQUENCE'
  ) => {
    const accepted = await handleAcceptRecommendation(recommendation, scheduleMode === 'NEXT_PATIENT_SESSION');
    if (!accepted) return;
    const goal = sessionGoals.find((entry: any) => (
      String(entry?.id || entry?.target_id || entry?.targetId || '') === String(recommendation.target_id || '')
    ));
    if (!goal) return;
    if (scheduleMode === 'NEXT_PATIENT_SESSION') {
      await handleScheduleMaintenanceForNextSession(goal);
      return;
    }
    openMaintenanceScheduleModal(goal);
    setMaintenanceScheduleMode(scheduleMode);
  };

  const openRejectRecommendationModal = (recommendation: any) => {
    setRejectingRecommendation(recommendation);
    setRejectRecommendationReason('');
    setRejectRecommendationNotes('');
    setPlanningMessage('');
  };

  const confirmRejectRecommendation = async () => {
    if (!rejectingRecommendation?.id) return;
    const recommendationId = String(rejectingRecommendation.id);
    if (planningDecisionInFlightRef.current.has(recommendationId)) return;
    const reason = rejectRecommendationReason.trim();
    if (!reason) {
      setPlanningMessage('Informe o motivo da recusa.');
      return;
    }
    planningDecisionInFlightRef.current.add(recommendationId);
    setPlanningDecisionLoadingId(recommendationId);
    try {
      const result = await dataService.rejectAbaRecommendation(recommendationId, {
        reason,
        notes: rejectRecommendationNotes.trim()
      });
      if (result?.success === false) {
        applyPlanningDecisionResult(result, recommendationId);
        setPlanningMessage(result?.error || 'Nao foi possivel recusar a sugestao agora.');
        return;
      }
      applyPlanningDecisionResult(result, recommendationId);
      setRejectingRecommendation(null);
      setRejectRecommendationReason('');
      setRejectRecommendationNotes('');
      setPlanningMessage('Sugestao recusada e registrada no historico.');
    } finally {
      planningDecisionInFlightRef.current.delete(recommendationId);
      setPlanningDecisionLoadingId('');
    }
  };

  const openEditRecommendationModal = (recommendation: any) => {
    setEditingRecommendation(recommendation);
    setEditRecommendationForm({
      title: translateAbaRecommendationText(recommendation?.title || ''),
      priority: String(recommendation?.priority || 'MEDIUM').toUpperCase(),
      recommendationType: String(recommendation?.recommendation_type || 'CONTINUE_TRAINING').toUpperCase(),
      targetId: String(recommendation?.target_id || recommendation?.targetId || ''),
      suggestedAction: translateAbaRecommendationText(recommendation?.suggested_action || ''),
      summary: translateAbaRecommendationText(recommendation?.summary || ''),
      rationale: translateAbaRecommendationText(recommendation?.rationale || ''),
      clinicalNote: '',
      applyForDate: '',
      responsibleProfessionalId: ''
    });
    setPlanningMessage('');
  };

  const saveEditedRecommendation = async (acceptAfterSave = false) => {
    if (!editingRecommendation?.id) return;
    const recommendationId = String(editingRecommendation.id);
    if (planningDecisionInFlightRef.current.has(recommendationId)) return;
    if (!editRecommendationForm.title.trim() || !editRecommendationForm.suggestedAction.trim()) {
      setPlanningMessage('Informe titulo e acao recomendada antes de salvar.');
      return;
    }
    planningDecisionInFlightRef.current.add(recommendationId);
    setPlanningDecisionLoadingId(recommendationId);
    try {
      const result = await dataService.updateAbaRecommendation(recommendationId, {
        title: editRecommendationForm.title.trim(),
        priority: editRecommendationForm.priority,
        recommendation_type: editRecommendationForm.recommendationType,
        target_id: editRecommendationForm.targetId || null,
        suggested_action: editRecommendationForm.suggestedAction.trim(),
        summary: editRecommendationForm.summary.trim(),
        rationale: editRecommendationForm.rationale.trim(),
        clinicalNote: editRecommendationForm.clinicalNote.trim(),
        applyForDate: editRecommendationForm.applyForDate || null,
        responsibleProfessionalId: editRecommendationForm.responsibleProfessionalId || null
      });
      if (result?.success === false) {
        applyPlanningDecisionResult(result, recommendationId);
        setPlanningMessage(result?.error || 'Nao foi possivel editar a sugestao agora.');
        return;
      }
      const edited = result.data || editingRecommendation;
      applyPlanningDecisionResult({ ...result, data: edited }, recommendationId);
      setEditingRecommendation(null);
      setPlanningMessage(acceptAfterSave ? 'Edicao salva. Aplicando sugestao...' : 'Sugestao editada e mantida como pendente.');
      planningDecisionInFlightRef.current.delete(recommendationId);
      if (acceptAfterSave) await handleAcceptRecommendation(edited, true);
    } finally {
      planningDecisionInFlightRef.current.delete(recommendationId);
      setPlanningDecisionLoadingId('');
    }
  };

  const handleApplyPlanItemNow = (item: any) => {
    if (String(item?.planned_trial_type || '').toLowerCase() === 'maintenance_probe') {
      const itemTargetId = String(item?.target_id || item?.targetId || '').trim();
      const goal = sessionGoals.find((entry: any) => goalTargetId(entry) === itemTargetId);
      const applied = activateMaintenanceProbeMode(goal);
      if (!applied) return;
      setPlanActionMessage('Sondagem de manutencao ativa para a proxima tentativa.');
    } else {
      if (item?.planned_trial_type) handleCollectionTypeChange(String(item.planned_trial_type));
      setPlanActionMessage('Item do plano selecionado para esta sessao.');
    }
    void dataService.updateAbaNextSessionPlanItem(item.id, { status: 'USED_IN_SESSION' });
  };

  const handleSkipPlanItem = async (item: any) => {
    const result = await dataService.updateAbaNextSessionPlanItem(item.id, { status: 'SKIPPED' });
    if (result?.success !== false) setNextSessionPlanItems((prev) => prev.filter((entry) => entry.id !== item.id));
  };

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

  const sessionSyncStatus = useMemo<SyncStatus>(() => {
    if (records.some((record) => record.syncStatus === 'error')) return 'error';
    if (records.some((record) => record.syncStatus === 'syncing')) return 'syncing';
    if (records.some((record) => record.syncStatus !== 'synced')) return 'local';
    return 'synced';
  }, [records]);

  const latestTrialRecord = useMemo(
    () => records.find((record) => record.kind === 'trial' && !record.therapeuticMeasurement) || null,
    [records]
  );

  const renderSyncBadge = (status: SyncStatus) => (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${syncClasses[status]}`}>
      {status === 'synced' ? <CheckCircle2 size={12} /> : status === 'error' ? <AlertCircle size={12} /> : <Clock size={12} />}
      {syncLabels[status]}
    </span>
  );

  const isIntervalHistoryRecord = (record: SessionRecord) => (
    record.kind === 'behavior' &&
    isIntervalMeasurementType(inferRecordMeasurementType(record)) &&
    (record.intervalNumber !== undefined || record.intervalIndex !== undefined || record.intervalAggregate)
  );

  const startEditingRecord = (record: SessionRecord) => {
    setEditingRecordId(record.id);
    setEditingRecordTitle(record.title);
    setEditingRecordDetail(record.detail);
    setEditingRecordCollectionType(normalizeAbaCollectionType(record.collectionType));
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
    setEditingRecordCollectionType('dtt');
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
    if (original?.measurementModelVersion === 'V3') {
      showClinicalToast({ variant: 'info', title: 'Registro V3 é imutável', subtitle: 'A edição direta foi bloqueada para preservar o histórico clínico append-only.' }, 'none');
      cancelEditingRecord();
      return;
    }
    if (!original) {
      cancelEditingRecord();
      return;
    }
    const isLockedIntervalRecord = isIntervalHistoryRecord(original);
    const editedCollectionType = original.kind === 'trial'
      ? normalizeAbaCollectionType(editingRecordCollectionType)
      : original.collectionType;
    const editedRecord: SessionRecord = {
      ...original,
      title: isLockedIntervalRecord ? original.title : (editingRecordTitle.trim() || original.title),
      detail: original.kind === 'trial'
        ? formatAbaTrialHistoryLabel({
            collectionType: editedCollectionType,
            outcome: original.trialOutcome || (original.correct ? 'independent' : 'error'),
            score: original.score ?? 0,
            promptLevelKey: original.promptLevelKey,
            promptLevelName: original.promptLevelName
          })
        : isLockedIntervalRecord ? original.detail : (editingRecordDetail.trim() || original.detail),
      collectionType: editedCollectionType,
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
      const originalCollectionType = normalizeAbaCollectionType(original.collectionType);
      if (originalCollectionType !== editedCollectionType) {
        persistTrialAudit({
          action: 'convert_trial_collection_type',
          recordId: original.id,
          targetId: original.targetId || null,
          targetName: original.targetName || original.title || null,
          fromCollectionType: originalCollectionType,
          toCollectionType: editedCollectionType
        });
        if (isMaintenanceProbeCollection(editedCollectionType)) {
          void persistConvertedTrialRecord(editedRecord, originalCollectionType);
        }
      } else if (isMaintenanceProbeCollection(editedCollectionType)) {
        void persistConvertedTrialRecord(editedRecord, originalCollectionType, 'edit');
      }
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
        appointment_id: activeAppointmentId || undefined,
        appointmentId: activeAppointmentId || undefined,
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
          appointmentId: activeAppointmentId || undefined,
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
      await dataService.updateAbaSession(sessionId, {
        notes: sessionNote,
        appointment_id: activeAppointmentId || undefined,
        appointmentId: activeAppointmentId || undefined
      });
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
      patientName: postClosureSummary.patientName || patientDisplayName,
      therapistName: postClosureSummary.therapistName || therapistDisplayName,
      sessionNote: sessionNote || postClosureSummary.sessionNote || '',
      sourceRecords: records
    });
  }, [patientDisplayName, postClosureSummary, records, sessionNote, therapistDisplayName]);
  const scheduledSessionDurationLabel = activeSession?.scheduledDurationMinutes || activeSession?.scheduled_duration_minutes
    ? `${Number(activeSession?.scheduledDurationMinutes || activeSession?.scheduled_duration_minutes)} min`
    : 'Sessao avulsa';
  const sessionOriginLabel = activeSession?.appointmentId || activeSession?.appointment_id ? 'Agenda' : 'Sessao avulsa';
  const scheduledSessionPlaceLabel =
    postClosureSummary?.locationNameSnapshot ||
    postClosureSummary?.locationContextSnapshot?.locationName ||
    activeSessionLocationName ||
    activeSession?.roomName ||
    activeSession?.room_name ||
    activeSession?.roomId ||
    activeSession?.room_id ||
    activeSession?.locationType ||
    activeSession?.location_type ||
    'Nao informado';

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
    const resolvedPersistedTherapistId = row.therapist_id ?? row.therapistId ?? fallback.therapistId ?? resolvedTherapistId ?? null;
    return {
      ...fallback,
      id: String(row.id || fallback.id || `summary-${sessionId}`),
      sessionId: String(row.session_id || row.sessionId || fallback.sessionId || sessionId),
      patientId: String(row.patient_id || row.patientId || fallback.patientId || patientId),
      therapistId: resolvedPersistedTherapistId,
      therapistName: formatTherapistLabel({
        therapistName: row.therapist_name || row.therapistName || payload.therapistName || fallback.therapistName || therapistDisplayName,
        id: resolvedPersistedTherapistId
      }),
      patientName: formatPatientLabel({ name: payload.patientName || fallback.patientName || patientDisplayName, id: row.patient_id || row.patientId || fallback.patientId || patientId }),
      careSetting: (row.care_setting || row.careSetting || payload.careSetting || fallback.careSetting || null) as SessionSummary['careSetting'],
      locationNameSnapshot: row.location_name_snapshot || row.locationNameSnapshot || payload.locationName || fallback.locationNameSnapshot || null,
      locationContextSnapshot:
        row.location_context_snapshot ||
        row.locationContextSnapshot ||
        fallback.locationContextSnapshot ||
        {
          careSetting: row.care_setting || row.careSetting || payload.careSetting || null,
          locationName: row.location_name_snapshot || row.locationNameSnapshot || payload.locationName || null,
        },
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
      console.warn('Relatório ABA persistido indisponível; usando resumo local.', error);
    } finally {
      setShowPostClosureReport(true);
    }
  };

  useEffect(() => {
    if (!isCompletedSessionReview) {
      setCompletedReviewLoading(false);
      setCompletedReviewError('');
      return;
    }
    let cancelled = false;
    const loadCompletedSessionReview = async () => {
      setCompletedReviewLoading(true);
      setCompletedReviewError('');
      try {
        const [summaryResult, recordsResult] = await Promise.all([
          dataService.getSessionReport(sessionId),
          dataService.getSessionReportRecords(sessionId, 160)
        ]);
        if (cancelled) return;
        const persistedSummary = summaryResult?.success ? normalizePersistedSessionSummary(summaryResult.data) : null;
        if (!persistedSummary) {
          throw new Error(summaryResult?.error || 'Relatório desta sessão não foi encontrado.');
        }
        const serverRecords = Array.isArray(recordsResult?.data)
          ? recordsResult.data.map(mapRecentAbaEventToSessionRecord).filter(Boolean) as SessionRecord[]
          : [];
        setPostClosureSummary(persistedSummary);
        setSessionNote(String(persistedSummary.sessionNote || ''));
        setSessionCompleted(true);
        setShowSessionSummary(false);
        setShowPostClosureReport(true);
        setShowComplementEditor(false);
        setRecords((previous) => {
          const pendingLocal = previous.filter((record) => record.syncStatus !== 'synced');
          const pendingIds = new Set(pendingLocal.map((record) => record.id));
          return [
            ...pendingLocal,
            ...serverRecords.filter((record) => !pendingIds.has(record.id))
          ]
            .sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime())
            .slice(0, 180);
        });
        setTrialCount(serverRecords.filter((record) => record.kind === 'trial' && !record.therapeuticMeasurement).length);
        if (recordsResult?.success === false) {
          setSessionWarning(recordsResult?.error || 'O relatório abriu, mas alguns registros clínicos não puderam ser carregados.');
        }
      } catch (error: any) {
        if (!cancelled) setCompletedReviewError(error?.message || 'Não foi possível carregar o relatório desta sessão.');
      } finally {
        if (!cancelled) setCompletedReviewLoading(false);
      }
    };
    void loadCompletedSessionReview();
    return () => {
      cancelled = true;
    };
  }, [completedReviewReloadKey, isCompletedSessionReview, sessionId]);

  const revalidateOperationalClosure = async () => {
    if (!activeAppointmentId) return;
    setOperationalClosureLoading(true);
    setOperationalClosureError('');
    try {
      const result = await dataService.revalidateClosureAppointment(activeAppointmentId);
      if (!result?.success) {
        setOperationalClosureError(result?.error || 'Não foi possível revalidar o fechamento agora.');
        return;
      }
      const detail = await dataService.getClosureAppointmentDetail(activeAppointmentId);
      if (detail?.success) setOperationalClosure(detail.data || null);
      else setOperationalClosureError(detail?.error || 'Não foi possível carregar o fechamento agora.');
    } catch {
      setOperationalClosureError('Não foi possível revalidar o fechamento agora.');
    } finally {
      setOperationalClosureLoading(false);
    }
  };

  const getOperationalClosureStatusMeta = (status: any) => {
    const normalized = String(status || 'UNKNOWN').toUpperCase();
    const map: Record<string, any> = {
      READY: { label: 'Pronta', icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
      PENDING: { label: 'Com pendências', icon: ShieldAlert, className: 'bg-red-50 text-red-700 border-red-100' },
      WARNING: { label: 'Atenção', icon: AlertCircle, className: 'bg-amber-50 text-amber-700 border-amber-100' },
      NOT_BILLABLE: { label: 'Não faturável', icon: ShieldAlert, className: 'bg-gray-100 text-gray-700 border-gray-200' },
      DRAFT: { label: 'Em aberto', icon: Clock, className: 'bg-sky-50 text-sky-700 border-sky-100' },
      UNKNOWN: { label: 'Dados insuficientes', icon: AlertCircle, className: 'bg-gray-100 text-gray-700 border-gray-200' }
    };
    return map[normalized] || map.UNKNOWN;
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
    if (isCompletedSessionReview) {
      onClose?.();
      return;
    }
    if (typeof onConfirmEndSession === 'function') {
      onConfirmEndSession({ alreadyPersisted: true, summary: postClosureSummary?.syncStatus === 'synced' ? postClosureSummary : null, pendingSync: postClosureSummary?.syncStatus !== 'synced' });
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

  if (isCompletedSessionReview && completedReviewLoading && !postClosureSummary) {
    const loadingContent = (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#F4F7FE] p-6">
        <Loader2 size={34} className="mb-4 animate-spin text-violet-500" />
        <p className="text-sm font-semibold text-slate-700">Carregando relatório da sessão...</p>
        <p className="mt-1 text-xs text-slate-500">Buscando o fechamento e os registros clínicos persistidos.</p>
      </div>
    );
    if (typeof document === 'undefined') return loadingContent;
    return createPortal(loadingContent, document.body);
  }

  if (isCompletedSessionReview && completedReviewError && !postClosureSummary) {
    const errorContent = (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#F4F7FE] p-6">
        <div className="w-full max-w-lg rounded-[28px] border border-red-100 bg-white p-6 text-center shadow-xl">
          <AlertCircle size={34} className="mx-auto mb-3 text-red-500" />
          <h2 className="text-xl font-semibold text-slate-900">Relatório da sessão indisponível</h2>
          <p className="mt-2 text-sm text-slate-600">{completedReviewError}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => setCompletedReviewReloadKey((value) => value + 1)} className="flex-1 rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-semibold text-white">Tentar novamente</button>
            <button type="button" onClick={() => onClose?.()} className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Voltar ao prontuário</button>
          </div>
        </div>
      </div>
    );
    if (typeof document === 'undefined') return errorContent;
    return createPortal(errorContent, document.body);
  }

  if (!isCompletedSessionReview && therapeuticPlanLoading && sessionGoals.length === 0 && upcomingMaintenanceProbeItems.length === 0) {
    const loadingContent = (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white p-6">
        <Loader2 size={34} className="mb-4 animate-spin text-violet-500" />
        <p className="text-sm text-slate-500">Preparando os programas da sessão...</p>
      </div>
    );
    if (typeof document === 'undefined') return loadingContent;
    return createPortal(loadingContent, document.body);
  }

  if (
    sessionGoals.length === 0
    && upcomingMaintenanceProbeItems.length === 0
    && !sessionMaintenanceProbes?.error
    && !showSessionSummary
    && !(sessionCompleted && postClosureSummary)
  ) {
    const emptyStateContent = (
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#F4F7FE]">
        <header className="sticky top-0 z-10 border-b border-blue-100 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
            <button onClick={onClose} className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100" aria-label="Voltar ao prontuário">
              <ChevronLeft size={28} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-semibold text-gray-900">{patientDisplayName}</p>
              <p className="text-xs text-gray-500">Sessão em andamento · {formatCountdown?.(remainingSeconds) || formatSessionDuration(remainingSeconds)}</p>
            </div>
            {activeSession && (
              <button onClick={requestEndSession} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-red-50 px-3 text-xs font-semibold uppercase tracking-wider text-red-600 transition hover:bg-red-100 sm:px-4">
                <StopCircle size={16} /> <span className="hidden sm:inline">Encerrar atendimento</span><span className="sm:hidden">Encerrar</span>
              </button>
            )}
          </div>
        </header>

        <main className="mx-auto flex min-h-[calc(100dvh-66px)] w-full max-w-5xl flex-col justify-center px-4 py-6 sm:px-6">
          <section className="rounded-[28px] border border-blue-100 bg-white p-5 shadow-xl shadow-blue-100/40 sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-[#7a32fc]">
                <FileText size={28} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc]">Atendimento clínico</p>
                <h2 className="mt-1 text-xl font-semibold text-gray-900">Registre a evolução desta sessão</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">
                  Este atendimento não possui metas ABA em treino ou prioritárias. A sessão continua válida: registre evolução, intercorrências, condutas, tarefas e próximos passos antes de encerrar.
                </p>
              </div>
            </div>

            <label className="mt-6 block text-xs font-medium text-gray-600">
              Evolução e observações da sessão
              <textarea
                value={sessionNote}
                onChange={(event) => setSessionNote(event.target.value)}
                maxLength={4000}
                placeholder="Objetivo da sessão, intervenções realizadas, resposta do paciente, tarefas combinadas e próximos passos..."
                className="mt-2 min-h-[220px] w-full resize-y rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3 text-sm font-normal leading-relaxed text-gray-700 outline-none transition focus:border-[#7a32fc]/50 focus:ring-2 focus:ring-[#7a32fc]/10"
              />
              <span className="mt-1.5 block text-right text-[11px] text-gray-400">{sessionNote.length}/4000</span>
            </label>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl bg-[#F8FAFF] p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Tentativas</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">{sessionSummary.trialTotal}</p>
              </div>
              <div className="rounded-2xl bg-[#F8FAFF] p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Comportamentos</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">{sessionSummary.behaviorTotal}</p>
              </div>
              <div className="rounded-2xl bg-[#F8FAFF] p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Sincronização</p>
                <p className={`mt-1 text-sm font-semibold ${sessionSummary.errorTotal > 0 || sessionSummary.localTotal > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {sessionSummary.errorTotal > 0 ? 'Com erro' : sessionSummary.localTotal > 0 ? 'Pendente' : 'Atualizada'}
                </p>
              </div>
              <div className="rounded-2xl bg-[#F8FAFF] p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Prontuário</p>
                <p className="mt-1 text-sm font-semibold text-gray-700">Salvamento local ativo</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button onClick={onClose} className="flex-1 rounded-2xl border border-blue-100 bg-white py-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
                Voltar ao prontuário
              </button>
              <button onClick={requestEndSession} className="flex-1 rounded-2xl bg-[#7a32fc] py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:bg-[#6425df]">
                Revisar e encerrar atendimento
              </button>
            </div>
          </section>
          {actionToastPortal}
        </main>
      </div>
    );
    if (typeof document === 'undefined') return emptyStateContent;
    return createPortal(emptyStateContent, document.body);
  }

  const abaV3RevisionModal = abaV3RevisionRecord ? (
        <div className="fixed inset-0 z-[146] flex items-end justify-center bg-black/35 p-3 backdrop-blur-sm sm:items-center sm:p-4" data-aba-v3-revision-modal>
          <div className="w-full max-w-lg rounded-[28px] border border-purple-100 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-purple-500">Revisão auditável · ABA V3</p>
                <h2 className="mt-1 text-xl font-semibold text-gray-900">{abaV3RevisionMode === 'VOID' ? 'Apagar registro' : 'Editar registro'}</h2>
                <p className="mt-1 text-sm text-gray-500">{abaV3RevisionRecord.title} · {new Date(abaV3RevisionRecord.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <button type="button" disabled={abaV3RevisionSaving} onClick={closeV3Revision} className="rounded-full bg-gray-100 p-2 text-gray-500 disabled:opacity-40" aria-label="Fechar revisão">
                <X size={18} />
              </button>
            </div>

            {abaV3RevisionMode === 'CORRECT' ? (
              <div className="mt-5 space-y-4">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Resultado correto da tentativa
                  <select
                    value={abaV3RevisionActionKey}
                    onChange={(event) => {
                      const nextAction = event.target.value as AbaV3TrialActionKey;
                      setAbaV3RevisionActionKey(nextAction);
                      if (nextAction !== 'PROMPTED_CORRECT') setAbaV3RevisionPromptKey('');
                    }}
                    className="mt-2 w-full rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3 text-sm font-semibold text-gray-800 outline-none focus:border-purple-300"
                  >
                    <option value="INDEPENDENT_CORRECT">Independente · correta</option>
                    <option value="PROMPTED_CORRECT">Com ajuda · correta</option>
                    <option value="INDEPENDENT_INCORRECT">Resposta incorreta</option>
                    <option value="NO_RESPONSE">Sem resposta</option>
                  </select>
                </label>
                {abaV3RevisionActionKey === 'PROMPTED_CORRECT' && (
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Tipo de ajuda
                    <select
                      value={abaV3RevisionPromptKey}
                      onChange={(event) => setAbaV3RevisionPromptKey(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3 text-sm font-semibold text-gray-800 outline-none focus:border-purple-300"
                    >
                      <option value="">Selecione</option>
                      {v3PromptedPromptOptions.map((prompt) => (
                        <option key={prompt.id || prompt.key} value={prompt.key}>{prompt.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="rounded-2xl border border-purple-100 bg-purple-50 p-3 text-xs leading-relaxed text-purple-700">
                  A Verto não altera a tentativa original. A correção cria uma nova tentativa V3 e vincula ambas por um evento de revisão atômico e auditável.
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm leading-relaxed text-red-700">
                O registro deixará de contar nos resultados clínicos. O evento original não será destruído: ficará preservado na auditoria como <strong>VOID</strong>.
              </div>
            )}

            {String(abaV3RevisionRecord.rawPayload?.lastRevisionReason || '').trim() && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Última revisão auditável</p>
                <p className="mt-1 text-sm text-slate-700">{String(abaV3RevisionRecord.rawPayload?.lastRevisionReason || '').trim()}</p>
              </div>
            )}

            <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Motivo da {abaV3RevisionMode === 'VOID' ? 'remoção' : 'correção'}
              <textarea
                value={abaV3RevisionReason}
                onChange={(event) => setAbaV3RevisionReason(event.target.value.slice(0, 1000))}
                placeholder="Ex.: registro selecionado por engano"
                className="mt-2 min-h-[88px] w-full resize-none rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3 text-sm text-gray-700 outline-none focus:border-purple-300"
              />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" disabled={abaV3RevisionSaving} onClick={closeV3Revision} className="rounded-2xl bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-600 disabled:opacity-50">Cancelar</button>
              <button
                type="button"
                disabled={abaV3RevisionSaving}
                onClick={() => void saveV3Revision()}
                className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 ${abaV3RevisionMode === 'VOID' ? 'bg-red-500' : 'bg-[#7a32fc]'}`}
              >
                {abaV3RevisionSaving ? <Loader2 size={16} className="animate-spin" /> : abaV3RevisionMode === 'VOID' ? <X size={16} /> : <Save size={16} />}
                {abaV3RevisionMode === 'VOID' ? 'Apagar' : 'Salvar correção'}
              </button>
            </div>
          </div>
        </div>
  ) : null;

  const abcModal = abcModalOpen ? (
        <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-[28px] sm:rounded-[32px] p-4 sm:p-6 shadow-2xl max-w-lg w-full max-h-[calc(100vh-2rem)] overflow-y-auto border border-purple-100">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">ABC rápido</p>
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
                  {sessionBehaviorPresets.map((behavior) => <option key={behavior.id} value={behavior.id}>{behavior.name}</option>)}
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
              <button onClick={() => void saveAbcEvent()} disabled={Boolean(actionLocks['abc:save'])} className="flex-1 py-3 rounded-2xl bg-[#7a32fc] text-white font-bold shadow-lg shadow-purple-500/20 transition-all active:scale-95 disabled:opacity-60">Salvar ABC</button>
            </div>
          </div>
        </div>
  ) : null;

  if (sessionCompleted && postClosureSummary && !showSessionSummary) {
    const completedAttendanceStatus = String((postClosureSummary as any).attendanceStatus || 'ATTENDED').toUpperCase();
    const completedBillingStatus = String((postClosureSummary as any).billingStatus || 'PENDING_REVIEW').toUpperCase();
    const completedWithoutAttendance = NON_ATTENDANCE_STATUSES.has(completedAttendanceStatus as SessionAttendanceStatus);
    const completionStatusLabel = completedWithoutAttendance
      ? 'Atendimento encerrado — não faturável'
      : completedBillingStatus === 'READY'
        ? 'Atendimento concluído — pronto para faturamento'
        : 'Atendimento concluído — pendências de faturamento';
    const completionStatusDescription = completedWithoutAttendance
      ? 'A falta ou o cancelamento foi registrado e não será enviado ao faturamento de convênio.'
      : completedBillingStatus === 'READY'
        ? 'O encerramento clínico foi persistido e a conferência operacional liberou o atendimento para o fluxo de faturamento.'
        : 'O encerramento clínico foi persistido. A equipe administrativa ainda deve revisar as pendências antes do faturamento.';
    const postClosureContent = (
      <div ref={postClosureScrollRef} className="fixed inset-0 z-[100] bg-[#F4F7FE] overflow-y-auto overflow-x-hidden overscroll-contain scroll-pt-4 animate-fade-in">
        <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-3 py-4 sm:px-6 sm:py-6">
          <div className="w-full rounded-[24px] sm:rounded-[32px] bg-white border border-blue-100 p-4 sm:p-8 shadow-2xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className={`text-[10px] font-semibold uppercase tracking-widest ${completedWithoutAttendance ? 'text-slate-500' : completedBillingStatus === 'READY' ? 'text-emerald-600' : 'text-amber-700'}`}>Encerramento confirmado</p>
                <h2 className="mt-2 text-3xl font-semibold text-gray-900">{showPostClosureReport ? 'Relatório do atendimento' : completionStatusLabel}</h2>
                <p className="mt-2 text-sm text-gray-500">
                  {showPostClosureReport
                    ? 'Relatório clínico estruturado, somente leitura para os dados principais do atendimento.'
                    : completionStatusDescription}
                </p>
              </div>
              <CheckCircle2 size={44} className={completedWithoutAttendance ? 'text-slate-400' : completedBillingStatus === 'READY' ? 'text-emerald-500' : 'text-amber-500'} />
            </div>

            <SessionSummaryDisclosure title="Situação operacional" meta={completionStatusLabel} tone="emerald">
<section className={`mt-6 rounded-[24px] border p-5 ${completedWithoutAttendance ? 'border-slate-200 bg-slate-50' : completedBillingStatus === 'READY' ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'}`}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Situação operacional</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{completionStatusLabel}</p>
              <p className="mt-1 text-sm text-gray-600">{completionStatusDescription}</p>
            </section>
            </SessionSummaryDisclosure>

            <SessionSummaryDisclosure title="Resumo geral" meta={`${formatSessionDuration(postClosureSummary.durationSeconds)} · ${postClosureSummary.totalTrials} tentativa(s) · ${postClosureSummary.totalBehaviorEvents} registro(s)`}>
<section className="mt-4 rounded-[24px] bg-[#F8FAFF] border border-blue-100 p-5">
              <h3 className="text-lg font-bold text-gray-900">Resumo geral</h3>
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-2xl bg-white border border-gray-100 p-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Paciente</p>
                  <p className="text-lg font-bold text-gray-900">{formatPatientLabel({ name: postClosureSummary.patientName || patientDisplayName, id: postClosureSummary.patientId })}</p>
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
            </SessionSummaryDisclosure>

            {showPostClosureReport && postClosureReport && (
              <div className="mt-5 space-y-5">
                <SessionSummaryDisclosure title="Dados da sessão">
<section className="rounded-[24px] bg-white border border-blue-100 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <h3 className="text-lg font-bold text-gray-900">Dados da sessão</h3>
                    <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${syncClasses[postClosureReport.header.syncStatus]}`}>
                      {postClosureReport.header.syncStatus === 'synced' ? 'sincronizado' : postClosureReport.header.syncStatus === 'error' ? 'erro de sincronização' : 'pendente de sincronização'}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
                    {[
                      ['Paciente', postClosureReport.header.patient],
                      ['Terapeuta', postClosureReport.header.therapist],
                      ['Data', postClosureReport.header.date],
                      ['Início', postClosureReport.header.startedAt],
                      ['Fim', postClosureReport.header.endedAt],
                      ['Duração planejada', scheduledSessionDurationLabel],
                      ['Duração total', postClosureReport.header.duration],
                      ['Contexto do atendimento', scheduledSessionPlaceLabel],
                      ['Origem', sessionOriginLabel],
                      ['Status', 'concluída']
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-4">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
                        <p className="mt-1 text-base font-bold text-gray-900">{safeDisplayValue(value, String(label) === 'Terapeuta' ? 'Terapeuta nao informado' : 'Nao informado')}</p>
                      </div>
                    ))}
                  </div>
                </section>
            </SessionSummaryDisclosure>

                {activeAppointmentId && (
                  <SessionSummaryDisclosure title="Fechamento operacional">
<section className="rounded-[24px] bg-white border border-blue-100 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Fechamento operacional</h3>
                        <p className="mt-1 text-sm text-gray-500">Conferência administrativa desta sessão para pré-faturamento.</p>
                      </div>
                      <button
                        type="button"
                        onClick={revalidateOperationalClosure}
                        disabled={operationalClosureLoading}
                        className="inline-flex w-fit items-center gap-2 rounded-2xl border border-blue-100 bg-[#F8FAFF] px-3 py-2 text-xs font-bold text-[#7a32fc] disabled:opacity-60"
                      >
                        <RotateCcw size={14} />
                        {operationalClosureLoading ? 'Revalidando' : 'Revalidar'}
                      </button>
                    </div>
                    {operationalClosureError && (
                      <p className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                        {operationalClosureError}
                      </p>
                    )}
                    {operationalClosure ? (() => {
                      const meta = getOperationalClosureStatusMeta(operationalClosure.readiness_status);
                      const Icon = meta.icon;
                      const checklist = Array.isArray(operationalClosure.checklist) ? operationalClosure.checklist : [];
                      const issues = checklist.filter((item: any) => item.status === 'FAILED' || item.status === 'WARNING').slice(0, 5);
                      return (
                        <div className="mt-4 space-y-3">
                          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${meta.className}`}>
                            <Icon size={14} />
                            {meta.label}
                          </div>
                          <div className="grid gap-2 md:grid-cols-3">
                            <div className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-3">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pendências</p>
                              <p className="text-xl font-bold text-gray-900">{operationalClosure.blocking_issues_count || 0}</p>
                            </div>
                            <div className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-3">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Alertas</p>
                              <p className="text-xl font-bold text-gray-900">{operationalClosure.warning_issues_count || 0}</p>
                            </div>
                            <div className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-3">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Realizado</p>
                              <p className="text-xl font-bold text-gray-900">{operationalClosure.actual_minutes ? `${operationalClosure.actual_minutes} min` : 'Não informado'}</p>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {issues.length === 0 ? (
                              <p className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-700">Sem pendências de fechamento.</p>
                            ) : issues.map((item: any) => (
                              <div key={item.key || item.label} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 px-4 py-3">
                                <p className="text-sm font-bold text-gray-900">{item.label}</p>
                                <p className="mt-1 text-sm text-gray-500">{item.message}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })() : (
                      <p className="mt-3 rounded-2xl bg-[#F8FAFF] border border-gray-100 px-4 py-3 text-sm font-semibold text-gray-500">
                        {operationalClosureLoading ? 'Carregando fechamento operacional.' : 'Fechamento ainda não disponível para esta sessão.'}
                      </p>
                    )}
                  </section>
            </SessionSummaryDisclosure>
                )}

                <SessionSummaryDisclosure title="Resumo geral" meta={`${postClosureReport.generalSummary.totalTeachingTrials} tentativa(s) de ensino`}>
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
                </SessionSummaryDisclosure>

                <SessionSummaryDisclosure title="Tentativas de ensino" meta={`${postClosureReport.teachingSummary.totalTrials} tentativa(s)`}>
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
            </SessionSummaryDisclosure>

                <SessionSummaryDisclosure title="Metas trabalhadas" meta={`${postClosureReport.targetSummaries.length} meta(s)`}>
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
            </SessionSummaryDisclosure>

                {Array.isArray((postClosureSummary as any).maintenanceSummary) && (postClosureSummary as any).maintenanceSummary.length > 0 && (
                  <SessionSummaryDisclosure title="Manutencao e regressao" tone="amber">
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
            </SessionSummaryDisclosure>
                )}

                <SessionSummaryDisclosure title="Comportamentos registrados">
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
            </SessionSummaryDisclosure>

                <SessionSummaryDisclosure title="ABC" meta={`${postClosureReport.abcEvents.length} registro(s)`}>
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
            </SessionSummaryDisclosure>

                <SessionSummaryDisclosure title="Pendências e complementos" tone="amber">
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
            </SessionSummaryDisclosure>

                {showComplementEditor && (
                  <SessionSummaryDisclosure title="Editar observação e ABC pendente" tone="slate">
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
                      <button type="button" onClick={() => openAbcModal(sessionBehaviorPresets[0]?.id || selectedBehavior.id)} className="rounded-2xl bg-violet-400 px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-950">
                        + Adicionar ABC
                      </button>
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
                    {clinicalHistoryRecords.some((record) => record.kind === 'trial' && record.measurementModelVersion === 'V3') && (
                      <div className="mt-5 border-t border-white/10 pt-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-violet-200">Retificações ABA V3</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-300">Editar cria uma correção auditável. Apagar anula a versão efetiva sem excluir o evento original.</p>
                        <div className="mt-3 space-y-2">
                          {clinicalHistoryRecords.filter((record) => record.kind === 'trial' && record.measurementModelVersion === 'V3').slice(0, 20).map((record) => (
                            <div key={`post-v3-${record.id}`} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">{record.title}</p>
                                <p className="mt-1 text-xs text-slate-300">{record.detail} · {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                {String(record.rawPayload?.lastRevisionReason || '').trim() && (
                                  <p className="mt-1 text-[11px] text-violet-200">Última revisão: {String(record.rawPayload?.lastRevisionReason || '').trim()}</p>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                {record.syncStatus === 'error' ? (
                                  <>
                                    <button type="button" onClick={() => void retryFailedV3Trial(record)} className="rounded-xl bg-amber-400 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-950">Reenviar</button>
                                    <button type="button" onClick={() => void discardFailedV3Trial(record)} className="rounded-xl bg-red-400/90 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white">Descartar erro</button>
                                  </>
                                ) : record.syncStatus === 'local' && record.rawPayload?.pendingV3Revision ? (
                                  <button type="button" onClick={() => void retryPendingV3Revision(record)} className="rounded-xl bg-amber-400 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-950">Sincronizar revisão</button>
                                ) : record.syncStatus === 'synced' ? (
                                  <>
                                    <button type="button" onClick={() => openV3Revision(record, 'CORRECT')} className="rounded-xl bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-900">Editar</button>
                                    <button type="button" onClick={() => openV3Revision(record, 'VOID')} className="rounded-xl bg-red-500 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white">Apagar</button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
            </SessionSummaryDisclosure>
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
                {isCompletedSessionReview ? 'Voltar ao prontuário' : 'Voltar ao paciente'}
              </button>
            </div>
          </div>
        </div>
        {editingRecommendation && (
          <div className="fixed inset-0 z-[230] flex items-end justify-center bg-gray-950/45 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center sm:p-6" data-aba-recommendation-edit-modal>
            <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-emerald-100 bg-white shadow-2xl shadow-gray-950/20">
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Editar sugestão clínica</p>
                  <h2 className="mt-1 text-xl font-black text-gray-900">{planningRecommendationTitle(editingRecommendation)}</h2>
                </div>
                <button type="button" onClick={() => setEditingRecommendation(null)} className="rounded-full bg-gray-100 p-2 text-gray-500">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 md:col-span-2">
                    Título
                    <input value={editRecommendationForm.title} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, title: event.target.value }))} className="mt-1 w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none" />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Prioridade
                    <select value={editRecommendationForm.priority} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, priority: event.target.value }))} className="mt-1 w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none">
                      {recommendationPriorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Tipo da sugestão
                    <select value={editRecommendationForm.recommendationType} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, recommendationType: event.target.value }))} className="mt-1 w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none">
                      {recommendationTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Alvo/habilidade vinculada
                    <select value={editRecommendationForm.targetId} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, targetId: event.target.value }))} className="mt-1 w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none">
                      <option value="">Sem alvo específico</option>
                      {sessionGoals.map((goal: any) => {
                        const targetId = goalTargetId(goal);
                        if (!targetId) return null;
                        return <option key={targetId} value={targetId}>{goal?.name || goal?.target_name || goal?.targetName || targetId}</option>;
                      })}
                    </select>
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Aplicar em qual data
                    <input type="date" value={editRecommendationForm.applyForDate} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, applyForDate: event.target.value }))} className="mt-1 w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none" />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 md:col-span-2">
                    Ação recomendada
                    <textarea value={editRecommendationForm.suggestedAction} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, suggestedAction: event.target.value }))} className="mt-1 min-h-[86px] w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none" />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Resumo clínico
                    <textarea value={editRecommendationForm.summary} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, summary: event.target.value }))} className="mt-1 min-h-[80px] w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none" />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Justificativa clínica
                    <textarea value={editRecommendationForm.rationale} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, rationale: event.target.value }))} className="mt-1 min-h-[80px] w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none" />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Profissional responsável
                    <input value={editRecommendationForm.responsibleProfessionalId} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, responsibleProfessionalId: event.target.value }))} className="mt-1 w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none" placeholder="Opcional" />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Observação clínica
                    <textarea value={editRecommendationForm.clinicalNote} onChange={(event) => setEditRecommendationForm((form) => ({ ...form, clinicalNote: event.target.value }))} className="mt-1 min-h-[80px] w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none" placeholder="Opcional" />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 border-t border-gray-100 bg-white px-5 py-4 sm:grid-cols-3">
                <button type="button" onClick={() => setEditingRecommendation(null)} className="min-h-[44px] rounded-2xl border border-gray-100 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500">
                  Cancelar
                </button>
                <button type="button" onClick={() => void saveEditedRecommendation(false)} disabled={Boolean(planningDecisionLoadingId)} className="min-h-[44px] rounded-2xl bg-[#7a32fc] px-4 py-2 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-60">
                  {planningDecisionLoadingId ? 'Salvando...' : 'Salvar edição'}
                </button>
                <button type="button" onClick={() => void saveEditedRecommendation(true)} disabled={Boolean(planningDecisionLoadingId)} className="min-h-[44px] rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-60">
                  Salvar e aceitar
                </button>
              </div>
            </div>
          </div>
        )}
        {rejectingRecommendation && (
          <div className="fixed inset-0 z-[230] flex items-end justify-center bg-gray-950/45 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center sm:p-6" data-aba-recommendation-reject-modal>
            <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-red-100 bg-white shadow-2xl shadow-gray-950/20">
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-500">Recusar sugestão clínica</p>
                  <h2 className="mt-1 text-lg font-black text-gray-900">{planningRecommendationTitle(rejectingRecommendation)}</h2>
                </div>
                <button type="button" onClick={() => setRejectingRecommendation(null)} className="rounded-full bg-gray-100 p-2 text-gray-500">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
                <p className="text-sm font-semibold text-gray-600">Escolha o motivo da recusa. A sugestão sairá da fila pendente, mas ficará no histórico.</p>
                <div className="mt-4 grid grid-cols-1 gap-2">
                  {rejectRecommendationReasons.map((reason) => {
                    const selected = rejectRecommendationReason === reason;
                    return (
                      <button key={reason} type="button" onClick={() => setRejectRecommendationReason(reason)} className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold transition ${selected ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-100 bg-[#F8FAFF] text-gray-700'}`}>
                        {reason}
                      </button>
                    );
                  })}
                </div>
                <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Observação opcional
                  <textarea value={rejectRecommendationNotes} onChange={(event) => setRejectRecommendationNotes(event.target.value)} className="mt-1 min-h-[90px] w-full rounded-2xl border border-gray-100 bg-[#F8FAFF] px-3 py-3 text-sm font-semibold text-gray-800 outline-none" />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-2 border-t border-gray-100 bg-white px-5 py-4 sm:grid-cols-2">
                <button type="button" onClick={() => setRejectingRecommendation(null)} className="min-h-[44px] rounded-2xl border border-gray-100 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500">
                  Cancelar
                </button>
                <button type="button" onClick={() => void confirmRejectRecommendation()} disabled={Boolean(planningDecisionLoadingId)} className="min-h-[44px] rounded-2xl bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-60">
                  {planningDecisionLoadingId ? 'Salvando...' : 'Registrar recusa'}
                </button>
              </div>
            </div>
          </div>
        )}
        {abaV3RevisionModal}
        {abcModal}
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
          <div key={event.id} className="min-w-0 overflow-hidden rounded-2xl bg-[#F4F7FE] border border-blue-100 p-3 sm:p-4 flex flex-col gap-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-gray-800" title={event.behaviorName}>{event.behaviorName}</p>
                <p className="mt-1 truncate text-xs text-gray-500" title={`${event.location || 'Sem local'} - severidade ${event.severity || '-'}`}>{event.location || 'Sem local'} - severidade {event.severity || '-'}</p>
                <p className="mt-1 truncate text-[11px] text-gray-400">Início {new Date(event.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cronômetro</p>
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
                <FileText size={14} /> ABC rápido
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
    const method = resolveBehaviorMeasurementForAction(behavior, shortcut?.method || behavior.defaultMeasurement || 'frequency');
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
    const compactLabel = compactBehaviorLabel(label);
    const fullLabel = openDuration ? `${behavior.name} ${elapsed}` : label;
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
        title={fullLabel}
        aria-label={fullLabel}
        className={`relative min-h-[44px] min-w-0 overflow-hidden rounded-[16px] border px-2 py-1.5 text-center shadow-sm transition-all active:scale-[0.98] disabled:opacity-60 ${getDockButtonClass(shortcut.color, isActive || crisisMode)} ${isActive ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-white animate-pulse' : ''} ${microFeedback[feedbackKey] ? 'scale-[0.98] ring-4 ring-white/70' : ''} ${compact ? 'min-h-[50px]' : ''}`}
      >
        {isFrequencyLike && microFeedback[feedbackKey] === 'plus' && (
          <span className="pointer-events-none absolute -top-3 right-2 z-20 animate-pop rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-white shadow-lg shadow-emerald-900/20">+1</span>
        )}
        {microFeedback[feedbackKey] === 'pulse' && (
          <span className="pointer-events-none absolute -top-3 right-2 z-20 animate-pop rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-[#1B254B] shadow-lg">ON</span>
        )}
        <span className="flex min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-medium">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
            {method === 'duration' ? (openDuration ? <Square size={13} /> : <Play size={13} />) : <Plus size={13} />}
            <span className="min-w-0 truncate">{compactLabel}</span>
          </span>
          {openDuration && <span className="ml-1 shrink-0 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px]">{elapsed}</span>}
        </span>
        <span className={`${(mobileFocusMode || compact) || openDuration ? 'hidden' : 'block'} mt-1 truncate text-[10px] font-normal opacity-75`}>
          {method === 'duration' ? 'iniciar duração' : '+1 ocorrência'}
        </span>
      </button>
    );
  };

  const clinicalDockCompact = Boolean(intervalRun);
  const clinicalDockPausedCompact = Boolean(intervalRunPaused && !intervalResponseActive);
  const clinicalDock = !sessionCompleted ? (
    <div
      ref={clinicalDockRef}
      data-aba-clinical-dock
      data-aba-clinical-dock-compact={clinicalDockCompact ? 'true' : 'false'}
      className={`fixed inset-x-0 bottom-0 z-[130] px-2 pb-[calc(0.55rem+env(safe-area-inset-bottom))] pt-2 ${clinicalDockSheetOpen ? 'pointer-events-none' : 'pointer-events-auto'}`}
    >
      <div className={`mx-auto max-w-3xl rounded-[22px] border p-1.5 shadow-xl backdrop-blur-xl ${clinicalDockCompact ? 'opacity-95' : 'shadow-xl'} ${crisisMode ? 'border-red-300 bg-slate-950/95 shadow-red-950/30' : 'border-blue-100 bg-white/95 shadow-blue-950/15'}`} data-aba-dock-bottom-bar>
        {!clinicalDockPausedCompact && activeTherapeuticTimerEntries.length > 0 && (
          <button
            type="button"
            onClick={() => setClinicalDockSheetOpen(true)}
            className={`mb-1.5 flex min-w-0 w-full items-center justify-between gap-2 overflow-hidden rounded-2xl px-3 py-2 text-xs font-medium ${crisisMode ? 'bg-white/10 text-white' : 'bg-purple-50 text-purple-800'}`}
            data-aba-dock-therapeutic-timer-badge
            title={activeTherapeuticTimerEntries.length === 1
              ? `${activeTherapeuticTimerEntries[0].targetName} · ${formatDurationSeconds(therapeuticTimerElapsedMs(activeTherapeuticTimerEntries[0]) / 1000)}`
              : `${activeTherapeuticTimerEntries.length} cronômetros terapêuticos em andamento`}
          >
            <span className="min-w-0 truncate">
              {activeTherapeuticTimerEntries.length === 1
                ? (activeTherapeuticTimerEntries[0].runningSince ? 'Alvo em andamento' : 'Cronômetro pausado')
                : `${activeTherapeuticTimerEntries.length} cronômetros de alvo`}
            </span>
            <span className="min-w-0 max-w-[58%] truncate text-right tabular-nums">
              {activeTherapeuticTimerEntries.length === 1
                ? `⏱ ${activeTherapeuticTimerEntries[0].targetName} · ${formatDurationSeconds(therapeuticTimerElapsedMs(activeTherapeuticTimerEntries[0]) / 1000)}`
                : 'Toque para revisar'}
            </span>
          </button>
        )}
        {!clinicalDockPausedCompact && openDurations.length > 0 && (
          <div
            className={`mb-1.5 flex min-w-0 items-center justify-between gap-2 overflow-hidden rounded-2xl px-3 py-2 text-xs font-medium ${crisisMode ? 'bg-white/10 text-white' : 'bg-amber-50 text-amber-800'}`}
            data-aba-dock-open-duration-badge
            title={openDurations.length === 1 ? `${openDurations[0].behaviorName} ${formatElapsed(openDurations[0].startedAt, nowMs)}` : `${openDurations.length} eventos em andamento`}
          >
            <span className="min-w-0 truncate">{openDurations.length === 1 ? 'Evento em andamento' : `${openDurations.length} eventos em andamento`}</span>
            <span className="min-w-0 max-w-[52%] truncate text-right">
              {openDurations.length === 1
                ? `⏱ ${compactBehaviorLabel(openDurations[0].behaviorName)} · ${formatElapsed(openDurations[0].startedAt, nowMs)}`
                : 'Toque em Mais'}
            </span>
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
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[18px] border border-red-100 bg-red-50 px-3 text-[11px] font-medium text-red-600 shadow-sm transition-all active:scale-[0.98]"
            >
              <Plus size={15} /> + Crise
            </button>
            <button
              type="button"
              onClick={() => {
                setCrisisMode(false);
                setClinicalDockSheetOpen(true);
              }}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[18px] border border-slate-100 bg-[#1B254B] px-3 text-[11px] font-medium text-white shadow-sm transition-all active:scale-[0.98]"
            >
              <MoreHorizontal size={15} /> Mais
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(52px,60px)] gap-1.5">
            {dockShortcuts.map((shortcut) => renderDockShortcutButton(shortcut, crisisMode))}
            <button
              type="button"
              onClick={() => {
                if (crisisMode) openAbcModal();
                else setClinicalDockSheetOpen(true);
              }}
              className={`min-h-[44px] min-w-0 overflow-hidden rounded-[16px] border px-2 text-[11px] font-medium shadow-sm transition-all active:scale-[0.98] ${crisisMode ? 'border-white/15 bg-white text-slate-950' : 'border-slate-100 bg-white text-slate-700'}`}
            >
              <span className="block truncate">{crisisMode ? 'ABC' : 'Mais'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  const selectedIntervalAlertLabel = intervalAlertOptions.find((option) => option.key === intervalAlertType)?.label || intervalAlertType;
  const selectedIntervalDurationLabel = `${Number(intervalSeconds || 0)}s`;
  const intervalQuantityCurrentValue = normalizeIntervalQuantityInput(intervalTotalIntervalsInput || intervalTotalIntervals);
  const contextSummaryItems = [
    selectedLocation,
    `Severidade ${selectedSeverity}`,
    selectedBehavior.name,
    getMeasurementLabel(behaviorMeasurementType),
    isIntervalMeasurementType(behaviorMeasurementType) ? selectedIntervalDurationLabel : null,
    isIntervalMeasurementType(behaviorMeasurementType) ? `Quantidade ${intervalTotalIntervals}` : null,
    isIntervalMeasurementType(behaviorMeasurementType) ? `Alerta ${selectedIntervalAlertLabel}` : null
  ].filter(Boolean);
  const handleQuickRegisterSubmit = () => {
    const effectiveMeasurementType = resolveBehaviorMeasurementForAction(selectedBehavior, behaviorMeasurementType);
    handleSelectedBehaviorAction();
    if (effectiveMeasurementType !== 'abc') setClinicalDockSheetOpen(false);
  };
  const renderIntervalQuantityStepper = (containerClassName = '') => (
    <div className={`text-[11px] font-medium text-slate-500 ${containerClassName}`} data-aba-dock-quantity-stepper>
      <span>Quantidade</span>
      <div className="mt-1 inline-flex min-h-[44px] items-center rounded-2xl border border-blue-100 bg-[#F8FAFF] p-1 shadow-sm">
        <button
          type="button"
          onClick={() => adjustIntervalQuantity(-1)}
          disabled={Boolean(intervalRun) || intervalQuantityCurrentValue <= intervalQuantityMin}
          aria-label="Diminuir quantidade"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-base font-semibold text-slate-600 shadow-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          -
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label="Quantidade"
          value={intervalTotalIntervalsInput}
          onChange={(event) => {
            setIntervalTotalIntervalsInput(event.target.value);
            setIntervalQuantityError('');
          }}
          onBlur={() => commitIntervalQuantityInput()}
          onFocus={(event) => event.currentTarget.select()}
          disabled={Boolean(intervalRun)}
          className="h-10 w-16 bg-transparent px-2 text-center text-base font-semibold tracking-normal text-slate-900 outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => adjustIntervalQuantity(1)}
          disabled={Boolean(intervalRun) || intervalQuantityCurrentValue >= intervalQuantityMax}
          aria-label="Aumentar quantidade"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#7a32fc] text-base font-semibold text-white shadow-sm shadow-purple-500/10 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
      {intervalQuantityError && (
        <p className="mt-1 text-[11px] font-bold normal-case tracking-normal text-red-500">{intervalQuantityError}</p>
      )}
    </div>
  );

  const clinicalDockSheet = clinicalDockSheetOpen && !intervalResponseActive ? (
    <div className="fixed inset-0 z-[210]" data-aba-clinical-dock-sheet>
      <button
        type="button"
        aria-label="Fechar dock clínico"
        onClick={() => setClinicalDockSheetOpen(false)}
        className="absolute inset-0 h-full w-full bg-slate-950/35 backdrop-blur-[2px]"
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-hidden rounded-t-[24px] border border-[#E4D8EF] bg-[#F5EFFA] shadow-2xl sm:max-h-[86vh] xl:left-1/2 xl:right-auto xl:bottom-4 xl:w-[560px] xl:-translate-x-1/2 xl:rounded-[28px]" data-aba-quick-register-sheet>
        <div className="shrink-0 border-b border-[#E7DFF0] bg-[#FBF7FF] px-4 pb-3 pt-3" data-aba-quick-register-header>
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#D9D1DF]" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight text-slate-800">Registro rápido</h2>
              <p className="mt-1 truncate text-xs font-medium text-[#7a32fc]" title={contextSummaryItems.join(' · ')}>
                {contextSummaryItems.slice(0, 3).join(' · ')}
              </p>
            </div>
            <button
              type="button"
              aria-label="Fechar registro rápido"
              onClick={() => setClinicalDockSheetOpen(false)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition-all hover:bg-white active:scale-95"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-4 sm:px-4" data-aba-quick-register-body>

        <AbaReinforcerSessionPanel
          patientId={patientId}
          sessionId={sessionId}
          readOnly={sessionCompleted || isCompletedSessionReview}
        />

        <section className="space-y-4" data-aba-dock-context-panel data-aba-quick-register-chip-panel>
          <div className="space-y-4">
            <div className="text-[11px] font-medium text-slate-500" data-aba-dock-location-chips>
              <div className="flex items-center justify-between gap-2">
                <span>Local</span>
                <button
                  type="button"
                  onClick={() => setDockLocationManagerOpen((open) => !open)}
                  disabled={sessionQuickPreferencesLoading}
                  aria-label="Adicionar local da sessão"
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-purple-100 bg-white px-2 text-[10px] font-semibold text-[#7a32fc] shadow-sm transition-all active:scale-95 disabled:opacity-50"
                >
                  <Plus size={12} /> local
                </button>
              </div>
              <div className="mt-1 flex max-h-[88px] flex-wrap gap-2 overflow-y-auto pr-1">
                {visibleDockLocationOptions.map((location) => (
                  <button
                    key={location}
                    type="button"
                    onClick={() => setSelectedLocation(location)}
                    aria-pressed={selectedLocation === location}
                    title={location}
                    className={`${dockChipClass(selectedLocation === location)} max-w-[11rem]`}
                  >
                    <span className="min-w-0 truncate">{location}</span>
                  </button>
                ))}
              </div>
              {dockLocationOptions.length > 6 && (
                <button
                  type="button"
                  onClick={() => setDockLocationsExpanded((expanded) => !expanded)}
                  className="mt-2 text-[11px] font-medium text-slate-500"
                >
                  {dockLocationsExpanded ? 'Mostrar menos' : 'Ver mais'}
                </button>
              )}
              {dockLocationManagerOpen && (
                <div className="mt-3 rounded-2xl border border-blue-100 bg-[#F8FAFF] p-3 normal-case tracking-normal" data-aba-dock-location-manager>
                  <p className="text-[11px] font-bold text-slate-600">Adicionar local</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newDockLocationName}
                      onChange={(event) => setNewDockLocationName(event.target.value)}
                      placeholder="Ex.: Cozinha"
                      className="min-h-[38px] min-w-0 flex-1 rounded-2xl border border-blue-100 bg-white px-3 text-xs font-bold text-slate-700 outline-none"
                    />
                    <button
                      type="button"
                      onClick={addDockLocation}
                      className="inline-flex min-h-[38px] items-center justify-center rounded-2xl bg-[#7a32fc] px-3 text-[11px] font-medium text-white"
                    >
                      Adicionar
                    </button>
                  </div>
                  {customDockLocations.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] font-medium text-slate-500">Locais adicionados</p>
                      {customDockLocations.map((location) => (
                        <div key={location} className="flex flex-wrap items-center gap-2 rounded-2xl border border-blue-100 bg-white p-2">
                          {editingDockLocationName === location ? (
                            <>
                              <input
                                value={editingDockLocationValue}
                                onChange={(event) => setEditingDockLocationValue(event.target.value)}
                                className="min-h-[36px] min-w-0 flex-1 rounded-xl border border-blue-100 bg-[#F4F7FE] px-3 text-xs font-bold text-slate-700 outline-none"
                              />
                              <button type="button" onClick={renameDockLocation} className="min-h-[36px] rounded-xl bg-[#7a32fc] px-3 text-[11px] font-medium text-white">Salvar</button>
                            </>
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{location}</span>
                              <button type="button" onClick={() => startRenameDockLocation(location)} className="text-[11px] font-medium text-[#7a32fc]">Renomear</button>
                              <button type="button" onClick={() => removeDockLocation(location)} className="text-[11px] font-medium text-slate-400">Remover</button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="text-[11px] font-medium text-slate-500" data-aba-dock-severity-chips>
              <span>Severidade</span>
              <div className="mt-1 flex gap-2">
                {severityOptions.map((severity) => (
                  <button
                    key={severity}
                    type="button"
                    onClick={() => setSelectedSeverity(severity)}
                    aria-pressed={selectedSeverity === severity}
                    className={`inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-full border px-3 py-2 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-red-500/25 active:scale-[0.98] ${selectedSeverity === severity ? 'border-red-600 bg-red-600 text-white shadow-sm shadow-red-900/10 ring-2 ring-red-500/10' : 'border-[#E2D9EA] bg-white text-slate-600 hover:border-slate-300 hover:bg-white'}`}
                  >
                    {severity}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[11px] font-medium text-slate-500" data-aba-dock-behavior-chips>
              <div className="flex items-center justify-between gap-2">
                <span>Comportamento</span>
                <button
                  type="button"
                  onClick={toggleSelectedBehaviorQuickShortcut}
                  disabled={sessionQuickPreferencesLoading || sessionQuickPreferencesSaving}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-purple-100 bg-white px-2 text-[10px] font-semibold text-[#7a32fc] shadow-sm transition-all active:scale-95 disabled:opacity-50"
                >
                  {personalizedDockShortcuts.some((shortcut: any) => shortcut.behaviorId === selectedBehavior.id) ? 'Desafixar' : '+ Fixar'}
                </button>
              </div>
              <div className="mt-1 flex max-h-[92px] flex-wrap gap-2 overflow-y-auto pr-1">
                {(dockMoreBehaviorsOpen ? [...visibleDockBehaviorOptions, ...extraDockBehaviorOptions] : visibleDockBehaviorOptions).map((behavior) => (
                  <button
                    key={behavior.id}
                    type="button"
                    onClick={() => selectBehavior(behavior)}
                    aria-pressed={selectedBehaviorId === behavior.id}
                    title={behavior.name}
                    className={`${dockChipClass(selectedBehaviorId === behavior.id)} max-w-[10.5rem]`}
                  >
                    <span className="min-w-0 truncate">{behavior.name}</span>
                  </button>
                ))}
                {extraDockBehaviorOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDockMoreBehaviorsOpen((open) => !open)}
                    className={`${dockChipClass(false)} max-w-[10.5rem] text-[#7a32fc]`}
                  >
                    <span className="min-w-0 truncate">{dockMoreBehaviorsOpen ? 'Mostrar menos' : '+ Mais'}</span>
                  </button>
                )}
              </div>
            </div>
            <div className="text-[11px] font-medium text-slate-500" data-aba-dock-method-chips>
              <span>Método</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {selectedBehaviorMethodOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setBehaviorMeasurementType(option.key)}
                    aria-pressed={behaviorMeasurementType === option.key}
                    title={option.label}
                    className={`${dockChipClass(behaviorMeasurementType === option.key)} max-w-[11rem]`}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="hidden mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-hidden="true">
            <label className="text-[11px] font-medium text-slate-500">
              Comportamento
              <select
                value={selectedBehaviorId}
                onChange={(event) => {
                  const behavior = sessionBehaviorPresets.find((item) => item.id === event.target.value);
                  if (behavior) selectBehavior(behavior);
                }}
                className="mt-1 w-full rounded-2xl border border-blue-100 bg-[#F4F7FE] px-3 py-3 text-xs font-bold text-slate-700 outline-none"
              >
                {sessionBehaviorPresets.map((behavior) => (
                  <option key={behavior.id} value={behavior.id}>{behavior.name}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-medium text-slate-500">
              Método de coleta
              <select
                value={behaviorMeasurementType}
                onChange={(event) => setBehaviorMeasurementType(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-blue-100 bg-[#F4F7FE] px-3 py-3 text-xs font-bold text-slate-700 outline-none"
              >
                {selectedBehaviorMethodOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          {isIntervalMeasurementType(behaviorMeasurementType) && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="text-[11px] font-medium text-slate-500 sm:col-span-2" data-aba-dock-duration-chips>
                <span>Duração</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {quickIntervalDurationOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setIntervalDurationMode(option.key)}
                      disabled={Boolean(intervalRun)}
                      aria-pressed={intervalDurationMode === option.key}
                      className={`${dockChipClass(intervalDurationMode === option.key)} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDockMoreDurationsOpen((open) => !open)}
                    disabled={Boolean(intervalRun)}
                    className="inline-flex min-h-[38px] items-center justify-center rounded-2xl border border-blue-100 bg-white px-3 py-2 text-[11px] font-medium text-[#7a32fc] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Mais durações
                  </button>
                </div>
                {dockMoreDurationsOpen && (
                  <div className="mt-2 flex flex-wrap gap-2 rounded-2xl border border-blue-100 bg-[#F8FAFF] p-2">
                    {extraIntervalDurationOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setIntervalDurationMode(option.key)}
                        disabled={Boolean(intervalRun)}
                        aria-pressed={intervalDurationMode === option.key}
                        className={`${dockChipClass(intervalDurationMode === option.key)} disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {option.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setIntervalDurationMode('custom')}
                      disabled={Boolean(intervalRun)}
                      aria-pressed={intervalDurationMode === 'custom'}
                      className={`${dockChipClass(intervalDurationMode === 'custom')} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      Personalizar
                    </button>
                  </div>
                )}
              </div>
              {intervalDurationMode === 'custom' && (
                <label className="text-[11px] font-medium text-slate-500">
                  Segundos
                  <input type="number" min={1} max={3600} value={intervalCustomSeconds} onChange={(event) => setIntervalCustomSeconds(Number(event.target.value))} disabled={Boolean(intervalRun)} className="mt-1 w-full rounded-2xl border border-blue-100 bg-[#F4F7FE] px-3 py-3 text-xs font-bold text-slate-700 outline-none disabled:opacity-60" />
                </label>
              )}
              {renderIntervalQuantityStepper()}
              <div className="text-[11px] font-medium text-slate-500" data-aba-dock-alert-chips>
                <span>Alerta</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {intervalAlertOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setIntervalAlertType(option.key)}
                      disabled={Boolean(intervalRun)}
                      aria-pressed={intervalAlertType === option.key}
                      title={option.label}
                      className={`${dockChipClass(intervalAlertType === option.key)} max-w-[11rem] disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="hidden text-[11px] font-medium text-slate-500" aria-hidden="true">
                Alerta
                <select value={intervalAlertType} onChange={(event) => setIntervalAlertType(event.target.value)} disabled={Boolean(intervalRun)} className="mt-1 w-full rounded-2xl border border-blue-100 bg-[#F4F7FE] px-3 py-3 text-xs font-bold text-slate-700 outline-none disabled:opacity-60">
                  {intervalAlertOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </label>
            </div>
          )}
          <details className="mt-1 rounded-2xl border border-[#E4D8EF] bg-white/70 p-3" data-aba-dock-advanced-options>
            <summary className="cursor-pointer text-[11px] font-medium text-slate-500">Mais opções</summary>
            <div className="mt-3 space-y-3 text-xs font-semibold text-slate-500">
              <p>Use esta área para ajustes menos frequentes, sem tirar o foco do registro rápido.</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCrisisMode((value) => !value)}
                  aria-pressed={crisisMode}
                  className={`min-h-[40px] rounded-2xl border px-3 text-[11px] font-medium ${crisisMode ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  Modo crise
                </button>
                <button
                  type="button"
                  onClick={() => { setClinicalDockSheetOpen(false); openAbcModal(); }}
                  className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-[11px] font-medium text-[#7a32fc]"
                >
                  <FileText size={13} /> ABC rápido
                </button>
                <button type="button" onClick={() => setDockLocationManagerOpen((open) => !open)} className="min-h-[40px] rounded-2xl border border-slate-200 bg-white px-3 text-[11px] font-medium text-[#7a32fc]">Gerenciar locais</button>
                <button type="button" onClick={() => setDockMoreDurationsOpen((open) => !open)} className="min-h-[40px] rounded-2xl border border-slate-200 bg-white px-3 text-[11px] font-medium text-[#7a32fc]">Mais durações</button>
              </div>

              <div className="rounded-xl border border-slate-100 bg-white/75 p-2.5" data-aba-personalized-quick-shortcuts>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-600">Seus acessos rápidos</span>
                  <span className="text-[10px] text-slate-400">{personalizedDockShortcuts.length}/3</span>
                </div>
                {personalizedDockShortcuts.length === 0 ? (
                  <p className="mt-2 text-[11px] font-normal text-slate-400">Fixe até 3 comportamentos para aparecerem na barra inferior.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {personalizedDockShortcuts.map((shortcut: any, index: number) => {
                      const behavior = resolveShortcutBehavior(shortcut);
                      return (
                        <div key={`quick-pref-${shortcut.behaviorId}`} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-2 py-2">
                          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{behavior?.name || shortcut.label}</span>
                          <button type="button" disabled={index === 0 || sessionQuickPreferencesSaving} onClick={() => movePersonalizedQuickShortcut(shortcut.behaviorId, -1)} className="h-7 w-7 rounded-lg border border-slate-100 text-[11px] text-slate-500 disabled:opacity-30" aria-label="Mover atalho para cima">↑</button>
                          <button type="button" disabled={index === personalizedDockShortcuts.length - 1 || sessionQuickPreferencesSaving} onClick={() => movePersonalizedQuickShortcut(shortcut.behaviorId, 1)} className="h-7 w-7 rounded-lg border border-slate-100 text-[11px] text-slate-500 disabled:opacity-30" aria-label="Mover atalho para baixo">↓</button>
                          <button type="button" disabled={sessionQuickPreferencesSaving} onClick={() => savePersonalizedQuickBehaviorShortcuts(personalizedDockShortcuts.filter((item: any) => item.behaviorId !== shortcut.behaviorId))} className="h-7 rounded-lg px-2 text-[10px] font-semibold text-slate-400 disabled:opacity-30">Remover</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {activeTherapeuticTimerEntries.length > 0 && (
                <div data-aba-therapeutic-timers-in-progress>
                  <p className="text-[11px] font-medium text-slate-500">Cronômetros de alvos</p>
                  <div className="mt-2 space-y-2">
                    {activeTherapeuticTimerEntries.map((timer) => {
                      const timerGoal = sessionGoals.find((goal: any) => therapeuticGoalKey(goal) === timer.goalKey);
                      const elapsedLabel = formatDurationSeconds(therapeuticTimerElapsedMs(timer) / 1000);
                      return (
                        <button
                          key={timer.goalKey}
                          type="button"
                          onClick={() => focusTherapeuticTimerGoal(timer)}
                          disabled={!timerGoal}
                          className="flex min-h-[46px] min-w-0 w-full items-center justify-between gap-2 overflow-hidden rounded-2xl border border-purple-100 bg-[#FBF9FF] px-4 text-left text-xs font-medium text-slate-800 disabled:cursor-default disabled:opacity-70"
                          title={`${timer.targetName} · ${timer.runningSince ? 'em andamento' : 'pausado'} · ${elapsedLabel}`}
                        >
                          <span className="min-w-0 truncate">{timer.targetName}</span>
                          <span className="shrink-0 tabular-nums text-[#7a32fc]">
                            {timer.runningSince ? '●' : 'Ⅱ'} {elapsedLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {openDurations.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-slate-500">Eventos em andamento</p>
                  <div className="mt-2 space-y-2">
                    {openDurations.map((event) => (
                      <button key={event.id} onClick={() => { endDuration(event.id); setClinicalDockSheetOpen(false); }} disabled={Boolean(actionLocks[`duration:end:${event.id}`])} title={`${event.behaviorName} ${formatElapsed(event.startedAt, nowMs)}`} className="flex min-h-[46px] min-w-0 w-full items-center justify-between gap-2 overflow-hidden rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 text-left text-xs font-medium text-slate-800 disabled:opacity-60">
                        <span className="min-w-0 truncate">{compactBehaviorLabel(event.behaviorName)}</span>
                        <span className="shrink-0">{formatElapsed(event.startedAt, nowMs)} ■</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[11px] font-medium text-slate-500">Últimos registros</p>
                <div className="mt-2 space-y-2">
                  {recentBehaviorRecords.length === 0 ? (
                    <p className="rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3 text-xs font-semibold text-slate-500">Nenhum comportamento registrado nesta sessão.</p>
                  ) : recentBehaviorRecords.map((record) => (
                    <div key={record.id} className="rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3">
                      <p className="text-xs font-medium text-slate-800">{record.title}</p>
                      <p className="mt-1 text-[11px] font-semibold text-slate-500">{record.detail} • {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </section>
        </div>
        <div className="shrink-0 border-t border-blue-50 bg-white px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-3 sm:px-4" data-aba-quick-register-footer>
          <button
            type="button"
            onClick={handleQuickRegisterSubmit}
            disabled={Boolean(intervalRun && isIntervalMeasurementType(behaviorMeasurementType))}
            className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 text-sm font-semibold text-white shadow-lg shadow-purple-900/10 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {behaviorMeasurementType === 'duration' ? <Play size={16} /> : behaviorMeasurementType === 'abc' ? <FileText size={16} /> : <Plus size={16} />}
            Registrar ocorrência
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const renderTherapeuticMeasurementCollector = (goal: any, compact = false) => {
    const measurementType = therapeuticMeasurementTypeFromGoal(goal);
    if (!goal?.isTherapeuticProgramTarget || measurementType === 'independent_prompted_no_response') return null;
    const goalKey = therapeuticGoalKey(goal);
    const timer = therapeuticTimers[goalKey] || null;
    const timerSeconds = timer ? therapeuticTimerElapsedMs(timer) / 1000 : 0;
    const criterion = buildSessionGoalMasteryCriterion(goal);
    const criterionCompatible = !criterion || isTherapeuticMasteryCriteriaCompatible(measurementType, criterion);
    const frequencyTotal = records
      .filter((record) => sessionRecordMatchesTeachingGoal(record, goal))
      .filter((record) => record.therapeuticMeasurement && normalizeTherapeuticMeasurementType(record.measurementType) === 'frequency')
      .reduce((sum, record) => sum + (Number(record.measuredValue) || 0), 0);
    const stop = (event: React.MouseEvent) => event.stopPropagation();
    const buttonBase = `${compact ? 'min-h-[46px] text-[11px]' : 'min-h-[56px] text-sm'} inline-flex items-center justify-center gap-2 rounded-2xl px-4 font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`;
    const recordValue = (value: number, unit: string | undefined, label: string) => async (event: React.MouseEvent) => {
      stop(event);
      await persistTherapeuticMeasurement({ goal, measurementType, measurementValue: value, measurementUnit: unit, displayLabel: label });
    };

    return (
      <div
        className={`${compact ? 'rounded-2xl border border-purple-100 bg-[#FBF9FF] p-3' : 'rounded-[24px] border border-purple-100 bg-[#FBF9FF] p-4 sm:p-5'} space-y-3`}
        data-therapeutic-measurement-collector={measurementType}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Como registrar</p>
            <p className="mt-1 text-sm font-medium text-[#1B254B]">
              {measurementType === 'duration' ? 'Duração' : measurementType === 'latency' ? 'Tempo de resposta' : measurementType === 'frequency' ? 'Frequência' : measurementType === 'correct_incorrect' ? 'Acerto / Erro' : measurementType === 'task_analysis' ? 'Etapas concluídas' : 'Percentual'}
            </p>
          </div>
          {measurementType === 'frequency' && (
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#7a32fc] shadow-sm">Nesta sessão: {Math.round(frequencyTotal * 100) / 100}</span>
          )}
        </div>

        {!criterionCompatible && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800" data-therapeutic-criterion-mismatch>
            O critério de domínio atual mede outra variável. A Verto continuará coletando conforme o programa, mas não marcará domínio até o critério ser revisado.
          </div>
        )}

        {(measurementType === 'duration' || measurementType === 'latency') && (
          <div className="rounded-2xl border border-purple-100 bg-white p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">{measurementType === 'duration' ? 'Tempo acumulado' : 'Latência'}</p>
            <p className={`${compact ? 'text-3xl' : 'text-4xl'} mt-1 font-medium tabular-nums text-[#1B254B]`}>{formatDurationSeconds(timerSeconds)}</p>
            {timer && <p className="mt-1 text-[10px] text-slate-400">Início {formatSessionTime(timer.startedAt)}</p>}
          </div>
        )}

        {measurementType === 'duration' && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {!timer ? (
              <button type="button" onClick={(event) => { stop(event); startTherapeuticTimer(goal, 'duration'); }} className={`${buttonBase} col-span-2 bg-[#7a32fc] text-white sm:col-span-4`}>
                <Play size={16} /> Iniciar
              </button>
            ) : (
              <>
                <button type="button" onClick={(event) => { stop(event); pauseResumeTherapeuticDuration(goal); }} className={`${buttonBase} bg-white text-[#7a32fc] border border-purple-200`}>
                  {timer.runningSince ? <><Pause size={16} /> Pausar</> : <><Play size={16} /> Retomar</>}
                </button>
                <button type="button" onClick={(event) => { stop(event); void finishTherapeuticTimer(goal); }} className={`${buttonBase} bg-[#1B254B] text-white`}>
                  <Square size={15} /> Finalizar
                </button>
                <button type="button" onClick={(event) => { stop(event); cancelTherapeuticTimer(goal); }} className={`${buttonBase} col-span-2 border border-slate-200 bg-white text-slate-500 sm:col-span-2`}>
                  Cancelar cronômetro
                </button>
              </>
            )}
          </div>
        )}

        {measurementType === 'latency' && (
          <div className="grid grid-cols-2 gap-2">
            {!timer ? (
              <button type="button" onClick={(event) => { stop(event); startTherapeuticTimer(goal, 'latency'); }} className={`${buttonBase} col-span-2 bg-[#7a32fc] text-white`}>
                <Play size={16} /> Iniciar
              </button>
            ) : (
              <>
                <button type="button" onClick={(event) => { stop(event); void finishTherapeuticTimer(goal); }} className={`${buttonBase} bg-emerald-500 text-white`}>
                  <CheckCircle2 size={16} /> Responder
                </button>
                <button type="button" onClick={(event) => { stop(event); cancelTherapeuticTimer(goal); }} className={`${buttonBase} border border-slate-200 bg-white text-slate-500`}>
                  Cancelar
                </button>
              </>
            )}
          </div>
        )}

        {measurementType === 'frequency' && (
          <button type="button" onClick={recordValue(1, 'count', 'Frequência · +1')} className={`${buttonBase} w-full bg-[#7a32fc] text-white`}>
            <Plus size={18} /> +1 ocorrência
          </button>
        )}

        {measurementType === 'correct_incorrect' && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={recordValue(1, 'binary', 'Resposta · Acerto')} className={`${buttonBase} bg-[#05CD99] text-white`}><CheckCircle2 size={17} /> Acerto</button>
            <button type="button" onClick={recordValue(0, 'binary', 'Resposta · Erro')} className={`${buttonBase} bg-[#F15B50] text-white`}><X size={17} /> Erro</button>
          </div>
        )}

        {measurementType === 'task_analysis' && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button type="button" onClick={recordValue(100, 'percent', 'Etapas · Concluída')} className={`${buttonBase} bg-[#05CD99] text-white`}>Concluída</button>
            <button type="button" onClick={recordValue(50, 'percent', 'Etapas · Com ajuda')} className={`${buttonBase} border border-orange-200 bg-orange-50 text-orange-700`}>Com ajuda</button>
            <button type="button" onClick={recordValue(0, 'percent', 'Etapas · Não realizada')} className={`${buttonBase} bg-[#F15B50] text-white`}>Não realizada</button>
          </div>
        )}

        {measurementType === 'percentage' && (
          <div className="grid grid-cols-3 gap-2">
            {[0, 50, 100].map((value) => (
              <button key={value} type="button" onClick={recordValue(value, 'percent', `Percentual · ${value}%`)} className={`${buttonBase} border border-purple-100 bg-white text-[#7a32fc]`}>{value}%</button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const sessionModeContent = (
    <div className="fixed inset-0 z-[100] bg-[#F4F7FE] flex flex-col overflow-hidden overflow-x-hidden animate-fade-in pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="sticky top-0 z-50 shrink-0 border-b border-purple-100 bg-white/95 backdrop-blur shadow-sm" data-aba-session-compact-header>
        <div className="flex min-h-[52px] items-center gap-2 px-3 sm:px-4 lg:px-6">
          <button onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#7a32fc] transition-all hover:bg-purple-50" aria-label="Voltar">
            <ChevronLeft size={23} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight text-gray-800 sm:text-base">
            Sessão: <span className="font-medium text-[#7a32fc]">{patient.name}</span>
          </h1>
          <button
            onClick={() => setMobileFocusMode((value) => !value)}
            className="hidden shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700 md:inline-flex"
          >
            {mobileFocusMode ? 'Foco' : 'Completo'}
          </button>
          {activeSession && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-slate-800">
              <Clock size={12} className="text-emerald-600" />
              {formatCountdown ? formatCountdown(remainingSeconds) : '00:00'}
            </span>
          )}
          <span data-aba-session-sync-status className="hidden sm:inline-flex">
            {renderSyncBadge(sessionSyncStatus)}
          </span>
          <span data-aba-session-sync-status-mobile className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border sm:hidden ${syncClasses[sessionSyncStatus]}`} title={syncLabels[sessionSyncStatus]} aria-label={`Estado de sincronização: ${syncLabels[sessionSyncStatus]}`}>
            {sessionSyncStatus === 'synced' ? <CheckCircle2 size={14} /> : sessionSyncStatus === 'error' ? <AlertCircle size={14} /> : <Clock size={14} />}
          </span>
          <button
            type="button"
            onClick={() => setSessionHistoryOpen((open) => !open)}
            aria-pressed={sessionHistoryOpen}
            data-aba-session-history-toggle
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            <HistoryIcon size={14} />
            <span className="hidden lg:inline">{sessionHistoryOpen ? 'Ocultar histórico' : `Histórico (${liveSummaryTotals.recordTotal})`}</span>
            <span className="lg:hidden">{liveSummaryTotals.recordTotal}</span>
          </button>
          {activeSession && (
            <button
              onClick={requestEndSession}
              className="min-h-[36px] shrink-0 rounded-full px-2 text-[11px] font-medium text-red-600 transition-all hover:bg-red-50"
            >
              Encerrar
            </button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 pb-2 sm:px-4 lg:px-6" data-aba-trial-type-chips>
          {collectionOptions.map((option) => {
            const selected = collectionType === option.key && !isMaintenanceProbeCollection(collectionType);
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => handleCollectionTypeChange(option.key)}
              className={`inline-flex min-h-[34px] shrink-0 items-center justify-center rounded-full border px-4 text-[11px] font-medium transition-all active:scale-95 ${selected ? 'border-[#7a32fc] bg-[#7a32fc] text-white shadow-sm shadow-purple-500/10' : 'border-purple-100 bg-white text-gray-700'}`}
                aria-pressed={selected}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {(activeSessionLocationName || activeSessionCareSetting) && (
          <div className="flex items-center gap-2 border-t border-purple-50 px-4 py-2 text-xs text-slate-600 lg:px-6" data-aba-session-location-context>
            <MapPin size={14} className="shrink-0 text-violet-500" />
            <span className="truncate">
              Contexto: {activeSessionLocationName || (activeSessionCareSetting === 'PATIENT_HOME' ? 'Domicílio do paciente' : activeSessionCareSetting === 'SCHOOL' ? 'Escola' : activeSessionCareSetting === 'ONLINE' ? 'Online' : activeSessionCareSetting === 'CLINIC' ? 'Clínica' : 'Outro local')}
            </span>
          </div>
        )}
      </div>

      <div ref={sessionScrollRef} className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden lg:overflow-hidden grid grid-cols-1 ${sessionHistoryOpen ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : 'xl:grid-cols-1'}`}>
        <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 lg:overflow-y-auto no-scrollbar" style={scrollBottomPaddingStyle}>
          {sessionWarning && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-700 flex items-center gap-3">
              <AlertCircle size={18} /> {sessionWarning}
            </div>
          )}

          {latestTrialRecord && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3" data-aba-last-trial-feedback aria-live="polite">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Última tentativa</p>
                <p className="mt-1 truncate text-sm text-slate-800" title={`${latestTrialRecord.detail} · ${formatSessionTime(latestTrialRecord.timestamp)}`}>{latestTrialRecord.detail} registrada às {formatSessionTime(latestTrialRecord.timestamp)}</p>
              </div>
              {renderSyncBadge(normalizeSyncStatus(latestTrialRecord.syncStatus))}
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
                  <div key={event.id} className="min-w-0 overflow-hidden rounded-2xl bg-[#F4F7FE] border border-blue-100 p-3 sm:p-4 flex flex-col gap-3">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-800" title={event.behaviorName}>{event.behaviorName}</p>
                        <p className="mt-1 truncate text-xs text-gray-500" title={`${event.location || 'Sem local'} - severidade ${event.severity || '-'}`}>{event.location || 'Sem local'} - severidade {event.severity || '-'}</p>
                        <p className="mt-1 truncate text-[11px] text-gray-400">Início {new Date(event.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cronômetro</p>
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
                <FileText size={14} /> ABC rápido
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {intervalRun && (
            <div
              data-aba-interval-parallel-banner
              data-aba-interval-response-active={intervalResponseActive ? 'true' : 'false'}
              className={`sticky top-0 ${intervalResponseActive ? 'z-[160]' : 'z-40'} rounded-[16px] border p-2 shadow-md transition-all sm:rounded-[20px] sm:p-2.5 ${intervalRunAwaitingResponse ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200/70' : intervalRunPaused ? 'bg-slate-50 border-slate-200 ring-1 ring-slate-200/70' : 'bg-amber-50 border-amber-100 shadow-amber-900/5'}`}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Timer size={14} className={intervalRunAwaitingResponse ? 'text-amber-600' : intervalRunPaused ? 'text-slate-500' : 'text-[#7a32fc]'} />
                    <h2 className="text-[10px] font-black uppercase tracking-wide text-amber-900">
                      {intervalRunPaused ? 'Coleta pausada' : 'Coleta por intervalo'}
                    </h2>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <h3 className="truncate text-sm font-black leading-tight text-gray-900" title={intervalRun.behaviorName}>
                      {intervalRun.behaviorName}
                    </h3>
                    <span className="shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] font-black text-amber-700">
                      {intervalRun.intervalIndex}/{intervalRun.totalIntervals}
                    </span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] font-semibold leading-tight text-amber-800">
                    <MapPin size={11} className="shrink-0" />
                    <span className="truncate" title={intervalRun.location || 'Sem local'}>{intervalRun.location || 'Sem local'}</span>
                    <span aria-hidden="true" className="shrink-0 text-amber-400">·</span>
                    <span className="shrink-0">sev. {intervalRun.severity || '-'}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-start gap-1">
                  <div className="min-w-[72px] text-right">
                    <p className="text-[9px] font-black uppercase tracking-wider text-gray-400">
                      {intervalRunAwaitingResponse ? 'Responder' : intervalRunPaused ? 'Pausado' : 'Restante'}
                    </p>
                    <p className={`mt-0.5 text-xl font-black leading-none tabular-nums ${intervalRunAwaitingResponse ? 'text-amber-700' : intervalRunPaused ? 'text-slate-600' : 'text-[#7a32fc]'}`}>
                      {intervalRunAwaitingResponse ? 'Agora' : intervalRunPaused ? '—' : formatRemainingUntil(intervalRun.intervalEndsAt, nowMs)}
                    </p>
                  </div>
                  {intervalRunAwaitingResponse && !intervalRunPaused && (
                    <button
                      type="button"
                      onClick={() => setIntervalOptionsOpen((open) => !open)}
                      data-aba-interval-options-button
                      aria-label="Opções da coleta por intervalo"
                      className="inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-xl border border-amber-200 bg-white text-amber-700 shadow-sm active:scale-95"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/80" aria-hidden="true">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${intervalRunPaused ? 'bg-slate-400' : intervalRunAwaitingResponse ? 'bg-amber-500' : 'bg-[#7a32fc]'}`}
                  style={{ width: `${intervalProgressPercent}%` }}
                />
              </div>

              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-[9px] font-black uppercase tracking-wide text-amber-700">
                  {Number(intervalRun.completedCount || 0)}/{Number(intervalRun.totalIntervals || 1)} respondidos · SIM {Number(intervalRun.occurredCount || 0)}
                </p>
                <p className="text-[10px] font-semibold leading-tight text-amber-800">
                  {getIntervalInstruction(intervalRun.measurementType)}
                </p>
              </div>

              {intervalRunAwaitingResponse && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => registerInterval(true)}
                    disabled={!intervalRunAwaitingResponse || Boolean(actionLocks[`interval:${intervalRun.id}:${Number(intervalRun.intervalIndex || 1)}`])}
                    className={`min-h-[42px] rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all active:scale-95 ${intervalRunAwaitingResponse && !actionLocks[`interval:${intervalRun.id}:${Number(intervalRun.intervalIndex || 1)}`] ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                  >
                    SIM
                  </button>
                  <button
                    onClick={() => registerInterval(false)}
                    disabled={!intervalRunAwaitingResponse || Boolean(actionLocks[`interval:${intervalRun.id}:${Number(intervalRun.intervalIndex || 1)}`])}
                    className={`min-h-[42px] rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all active:scale-95 ${intervalRunAwaitingResponse && !actionLocks[`interval:${intervalRun.id}:${Number(intervalRun.intervalIndex || 1)}`] ? 'bg-red-500 text-white shadow-sm' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                  >
                    NÃO
                  </button>
                </div>
              )}

              <div className={intervalRunPaused ? 'mt-2' : `mt-2 border-t border-amber-100 pt-2 ${intervalResponseActive ? 'pb-0.5' : ''}`}>
                {intervalRunPaused ? (
                  <div ref={intervalPausedControlsRef} className="rounded-xl border border-slate-200 bg-white p-2" data-aba-interval-paused-controls>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button onClick={resumeIntervalRun} className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-xl bg-[#1B254B] px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-white active:scale-95"><RotateCcw size={13} /> Retomar</button>
                      <button onClick={finishIntervalRunNow} className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-xl border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 active:scale-95"><Square size={12} /> Finalizar</button>
                      <button onClick={requestCancelIntervalRun} className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-xl border border-red-100 bg-red-50 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-red-600 active:scale-95"><X size={12} /> Cancelar</button>
                    </div>
                    <p className="mt-1.5 text-[10px] font-semibold text-slate-500">
                      Intervalo {intervalRun.intervalIndex}/{intervalRun.totalIntervals} preservado · respostas anteriores mantidas.
                    </p>
                  </div>
                ) : !intervalRunAwaitingResponse ? (
                  <div className="grid grid-cols-3 gap-1.5" data-aba-interval-running-controls>
                    <button
                      onClick={pauseIntervalRun}
                      className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-xl bg-[#1B254B] px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-white active:scale-95"
                    >
                      <Pause size={13} /> Pausar
                    </button>
                    <button
                      onClick={finishIntervalRunNow}
                      className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-xl bg-emerald-50 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 active:scale-95"
                    >
                      <Square size={12} /> Finalizar
                    </button>
                    <button
                      onClick={() => setIntervalOptionsOpen((open) => !open)}
                      className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-xl border border-purple-100 bg-white px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-[#7a32fc] active:scale-95"
                    >
                      <MoreHorizontal size={13} /> Opções
                    </button>
                  </div>
                ) : (
                  <p className="text-center text-[10px] font-semibold text-amber-700">SIM/NÃO são a prioridade · opções no menu acima.</p>
                )}
                {intervalOptionsOpen && !intervalRunPaused && (
                  <div className="mt-2 rounded-xl border border-blue-100 bg-white p-2 shadow-lg shadow-blue-900/5" data-aba-interval-options-panel>
                    {!intervalRunAwaitingResponse && (
                    <label className="block text-[9px] font-bold uppercase tracking-widest text-gray-400">
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
                    <div className={`grid grid-cols-2 gap-1.5 ${intervalRunAwaitingResponse ? '' : 'mt-2'}`}>
                      <button onClick={pauseIntervalRun} className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl bg-[#1B254B] px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-white active:scale-95"><Pause size={13} /> Pausar</button>
                      <button onClick={finishIntervalRunNow} className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl bg-emerald-50 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 active:scale-95"><Square size={12} /> Finalizar</button>
                      <button onClick={requestCancelIntervalRun} className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl bg-red-50 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-red-600 active:scale-95"><X size={12} /> Cancelar</button>
                      <button onClick={() => setIntervalOptionsOpen(false)} className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-gray-100 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-600 active:scale-95">Voltar</button>
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
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Método</p>
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
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Ocorrência</p>
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

          {false && (
          <div className="bg-white rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 shadow-xl shadow-blue-900/5 border border-white">
            <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Evento comportamental inteligente</p>
                <h2 className="text-xl font-bold text-gray-800">Registro rápido</h2>
              </div>
              {selectedBehaviorAllowsMultipleMethods ? (
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Método
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
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Método</p>
                  <p className="text-sm font-bold text-gray-800">{getMeasurementLabel(behaviorMeasurementType)}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
              {sessionBehaviorPresets.map((behavior) => {
                const isOpen = openDurations.some((event) => event.behaviorName === behavior.name);
                const defaultMeasurement = getBehaviorDefaultMeasurement(behavior);
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
                        {defaultMeasurement === 'duration' ? (isOpen ? <Square size={12} /> : <Play size={12} />) : defaultMeasurement === 'frequency' ? <Plus size={12} /> : <Timer size={12} />}
                        {getMeasurementLabel(defaultMeasurement)}
                      </span>
                    </button>
                    <button
                      onClick={() => openAbcModal(behavior.id)}
                      className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-1 rounded-xl bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#7a32fc] border border-white/80"
                    >
                      <FileText size={13} /> ABC rápido
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl bg-[#F4F7FE] border border-blue-100 p-4">
              <div className="grid grid-cols-1 gap-3 mb-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Comportamento
                  <select
                    value={selectedBehaviorId}
                    onChange={(event) => {
                      const behavior = sessionBehaviorPresets.find((item) => item.id === event.target.value);
                      if (behavior) selectBehavior(behavior);
                    }}
                    className="mt-1 w-full bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                  >
                    {sessionBehaviorPresets.map((behavior) => (
                      <option key={behavior.id} value={behavior.id}>{behavior.name}</option>
                    ))}
                  </select>
                </label>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Local
                  <div className="mt-1 flex flex-wrap gap-2">
                    {locationOptions.map((location) => (
                      <button
                        key={location}
                        type="button"
                        onClick={() => setSelectedLocation(location)}
                        aria-pressed={selectedLocation === location}
                        className={`min-h-[38px] rounded-xl border px-3 py-2 text-[11px] font-bold normal-case tracking-normal transition-all active:scale-95 ${selectedLocation === location ? 'border-[#7a32fc] bg-[#7a32fc] text-white shadow-md shadow-purple-500/20' : 'border-blue-100 bg-white text-gray-600 hover:border-purple-200'}`}
                      >
                        {location}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Severidade
                  <div className="mt-1 flex flex-wrap gap-2">
                    {severityOptions.map((severity) => (
                      <button
                        key={severity}
                        type="button"
                        onClick={() => setSelectedSeverity(severity)}
                        aria-pressed={selectedSeverity === severity}
                        className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-black tracking-normal transition-all active:scale-95 ${selectedSeverity === severity ? 'border-[#1B254B] bg-[#1B254B] text-white shadow-md shadow-slate-900/20' : 'border-blue-100 bg-white text-gray-600 hover:border-slate-300'}`}
                      >
                        {severity}
                      </button>
                    ))}
                  </div>
                </div>
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
                    <FileText size={16} /> ABC rápido
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
                  <button onClick={() => openAbcModal()} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-white text-[#7a32fc] border border-purple-100 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                    <FileText size={16} /> ABC rápido
                  </button>
                </div>
              )}

              {behaviorMeasurementType === 'rate' && (
                <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center">
                  {!rateWindow ? (
                    <button onClick={() => void startRateWindow()} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                      <Play size={16} /> Iniciar janela
                    </button>
                  ) : (
                    <>
                      <span className="text-sm font-bold text-gray-700">Janela {formatElapsed(rateWindow.startedAt, nowMs)} - {rateWindow.count} ocorrência(s)</span>
                      <button onClick={registerRateOccurrence} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                        <Plus size={16} /> Ocorrência
                      </button>
                      <button onClick={() => void finishRateWindow()} className="min-h-[52px] w-full sm:w-auto px-5 py-3 rounded-2xl bg-slate-700 text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                        <Square size={16} /> Finalizar janela
                      </button>
                    </>
                  )}
                </div>
              )}

              {isIntervalMeasurementType(behaviorMeasurementType) && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Duração do intervalo
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
                    {renderIntervalQuantityStepper('md:pt-0')}
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
                    <FileText size={16} /> Abrir ABC rápido
                  </button>
                </div>
              )}
            </div>
          </div>
          )}

          {nextSessionPlanItems.length > 0 && (
            <section className="rounded-[24px] sm:rounded-[28px] border border-emerald-100 bg-white p-4 sm:p-5 shadow-xl shadow-emerald-900/5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-600">Plano sugerido para hoje</p>
                  <h2 className="text-lg font-bold text-gray-900">Itens aceitos pelo supervisor</h2>
                </div>
                {planActionMessage && <span className="rounded-full bg-emerald-50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700">{planActionMessage}</span>}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {nextSessionPlanItems.slice(0, 4).map((item: any) => (
                  <div key={item.id} className="rounded-2xl border border-emerald-100 bg-[#F6FFFB] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{translateAbaRecommendationText(item.instructions || 'Sugestão para revisar na sessão')}</p>
                        <p className="mt-1 text-xs font-semibold text-gray-500">{item.planned_trial_type === 'maintenance_probe' ? 'Sondagem de manutenção' : 'Plano clínico'} - {abaRecommendationPriorityLabel(item.priority)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => handleApplyPlanItemNow(item)} className="inline-flex min-h-[36px] items-center justify-center rounded-full bg-emerald-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                        Usar agora
                      </button>
                      <button type="button" onClick={() => handleSkipPlanItem(item)} className="inline-flex min-h-[36px] items-center justify-center rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                        Pular
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {sessionMaintenanceProbes?.error && (
            <section className="rounded-[24px] sm:rounded-[28px] border border-slate-200 bg-white p-4 sm:p-5 shadow-xl shadow-slate-900/5">
              <p className="text-sm font-bold text-slate-700">Não foi possível carregar sondagens de manutenção.</p>
            </section>
          )}

          {showLinkedMaintenanceProbeLoadWarning && (
            <section className="rounded-[24px] sm:rounded-[28px] border border-amber-100 bg-white p-4 sm:p-5 shadow-xl shadow-amber-900/5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-600">Sondagens da sessão</p>
                  <h2 className="text-lg font-bold text-gray-900">Nenhuma sondagem encontrada para esta sessão.</h2>
                  <p className="mt-1 text-xs font-semibold text-gray-500">A Sessão ABA está vinculada ao agendamento clínico, mas nenhuma sondagem ativa foi carregada para este vínculo.</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                    <span className="rounded-full bg-amber-50 px-2 py-1">Sessão vinculada: sim</span>
                    <span className="rounded-full bg-amber-50 px-2 py-1">Sessão vinculada: sim</span>
                    {sessionClinicalDate && <span className="rounded-full bg-amber-50 px-2 py-1">Data clínica: {String(sessionClinicalDate).slice(0, 10)}</span>}
                    {sessionMaintenanceProbeDiagnostics?.appointmentScheduleCount !== undefined && (
                      <span className="rounded-full bg-amber-50 px-2 py-1">Sondagens da sessão na busca: {sessionMaintenanceProbeDiagnostics.appointmentScheduleCount}</span>
                    )}
                  </div>
                </div>
                <button type="button" onClick={refreshSessionMaintenanceProbes} className="inline-flex min-h-[38px] w-fit items-center justify-center rounded-full bg-amber-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                  Recarregar sondagens
                </button>
              </div>
            </section>
          )}

          {maintenanceProbeQueueItems.length > 0 && (
            <section className="rounded-[24px] sm:rounded-[28px] border border-amber-100 bg-white p-3 sm:p-4 shadow-xl shadow-amber-900/5" data-maintenance-probe-queue>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-600">Sondagens da sessão</p>
                  <h2 className="text-lg font-bold text-gray-900">Sondagens de manutenção desta sessão</h2>
                  <p className="mt-1 text-xs font-semibold text-gray-500">
                    {maintenanceProbeRegisteredCount}/{maintenanceProbeQueueItems.length} registradas · Pendentes: {maintenanceProbePendingCount}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'all', label: `Todas (${maintenanceProbeQueueItems.length})` },
                    { key: 'pending', label: `Pendentes (${maintenanceProbePendingCount})` },
                    { key: 'registered', label: `Registradas (${maintenanceProbeRegisteredCount})` }
                  ].map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setMaintenanceProbeQueueFilter(filter.key as 'all' | 'pending' | 'registered')}
                      className={`inline-flex min-h-[32px] items-center justify-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-all ${maintenanceProbeQueueFilter === filter.key ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700'}`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 divide-y divide-amber-100 rounded-2xl border border-amber-100 bg-[#FFFDF7]">
                {visibleMaintenanceProbeQueueItems.map((row: any) => {
                  const statusLabel = row.active ? 'Em registro' : row.registered ? 'Registrada nesta sessão' : 'Pendente';
                  const statusClass = row.active
                    ? 'bg-blue-50 text-blue-600'
                    : row.registered
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-amber-100 text-amber-700';
                  return (
                    <div key={`probe-row-${row.id}`} className={`flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${row.active ? 'bg-blue-50/50' : ''}`} data-maintenance-probe-row>
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-black ${row.registered ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : row.active ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-amber-200 bg-white text-amber-600'}`}>
                          {row.registered ? '✓' : row.active ? '•' : ''}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-gray-900">{row.name}</p>
                          <p className="mt-0.5 truncate text-xs font-semibold text-gray-500">
                            {[row.protocol, row.domain].filter(Boolean).join(' · ') || row.contextLabel || 'Sondagem de manutenção'}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${statusClass}`}>{statusLabel}</span>
                        {!row.registered && (
                          <button
                            type="button"
                            onClick={() => openMaintenanceProbeQueueItem(row)}
                            className="inline-flex min-h-[34px] items-center justify-center rounded-full bg-amber-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white transition-all active:scale-95"
                          >
                            {row.active ? 'Continuar' : 'Registrar'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {filteredMaintenanceProbeQueueItems.length > visibleMaintenanceProbeQueueItems.length && (
                <button
                  type="button"
                  onClick={() => setMaintenanceProbeQueueExpanded(true)}
                  className="mt-3 inline-flex min-h-[34px] items-center justify-center rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700"
                >
                  Ver todas
                </button>
              )}
              {maintenanceProbeQueueExpanded && filteredMaintenanceProbeQueueItems.length > 5 && (
                <button
                  type="button"
                  onClick={() => setMaintenanceProbeQueueExpanded(false)}
                  className="mt-3 ml-2 inline-flex min-h-[34px] items-center justify-center rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500"
                >
                  Mostrar menos
                </button>
              )}
            </section>
          )}

          {upcomingMaintenanceProbeItems.length > 0 && (
            <section className="rounded-[24px] sm:rounded-[28px] border border-slate-200 bg-white p-4 sm:p-5 shadow-xl shadow-slate-900/5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Sondagem de manutenção agendada</p>
                  <h2 className="text-lg font-bold text-gray-900">
                    Há sondagem de manutenção agendada para data futura{firstUpcomingMaintenanceProbeItem?.nextSchedule ? `: ${formatMaintenanceDueLabel(firstUpcomingMaintenanceProbeItem.nextSchedule)}` : '.'}
                  </h2>
                </div>
              </div>
            </section>
          )}

          {maintenanceSessionSummaryRows.length > 0 && (
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
                {maintenanceSessionSummaryRows.map((row: any) => (
                  <div key={row.id} className="rounded-2xl border border-amber-100 bg-[#FFFDF7] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-900">{row.name}</p>
                        {row.contextLabel && <p className="mt-1 truncate text-xs text-gray-500">{row.contextLabel}</p>}
                        <p className="mt-1 text-xs font-semibold text-gray-500">
                          {row.nextSchedule ? formatMaintenanceDueLabel(row.nextSchedule) : 'Sem sondagem agendada'}
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
                          : 'Aguardando sondagem de manutenção'}
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

          <section className="rounded-[18px] border border-purple-100 bg-white/90 p-2 shadow-sm" data-session-plan-filter>
            {activeTherapeuticProgramCount > 0 && (
              <div className="mb-2 flex items-center justify-between gap-3 px-2 py-1" data-therapeutic-programs-today>
                <div>
                  <p className="text-sm font-medium text-gray-800">Programas de hoje</p>
                  <p className="text-xs text-gray-500">Alvos ativos do Plano terapêutico</p>
                </div>
                <span className="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-[#7a32fc]">
                  {activeTherapeuticProgramCount} programa(s)
                </span>
              </div>
            )}
            {maintenanceProbeQueueItems.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-1.5">
                <p className="text-xs font-black text-amber-800">
                  Manutenções desta sessão · {maintenanceProbePendingCount} pendente(s)
                </p>
                <span className="rounded-full bg-white px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                  {maintenanceProbeRegisteredCount}/{maintenanceProbeQueueItems.length} registradas
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 overflow-x-auto" data-aba-session-plan-tabs>
              {[
                { key: 'all', label: 'Todas' },
                { key: 'skills', label: 'Habilidades' },
                { key: 'maintenance', label: 'Manutenções' }
              ].map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setSessionPlanFilter(filter.key as 'all' | 'skills' | 'maintenance')}
                  className={`inline-flex min-h-[32px] shrink-0 items-center justify-center border-b-2 px-3 text-[11px] font-medium transition-all active:scale-95 ${sessionPlanFilter === filter.key ? 'border-[#7a32fc] text-[#7a32fc]' : 'border-transparent text-gray-600'}`}
                  aria-pressed={sessionPlanFilter === filter.key}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {sessionPlanGoals.length === 0 && (
              <p className="mt-3 rounded-2xl border border-dashed border-blue-100 bg-[#F8FAFF] px-4 py-3 text-xs font-semibold text-gray-500">
                Nenhum item neste filtro. Use Todas para voltar ao plano completo da sessão.
              </p>
            )}
          </section>

          <div className="space-y-2 sm:hidden" data-aba-mobile-task-list>
            {sessionPlanGoals.map((goal: any) => {
              const goalKey = String(goal?.id || goal?.target_id || goal?.targetId || goal?.name || 'goal');
              const maintenanceTargetKey = getMaintenanceTargetKey(goal);
              const maintenanceProbeActiveForGoal = Boolean(maintenanceTargetKey && currentTrialTargetKey === maintenanceTargetKey && activeMaintenanceProbeTargetId === maintenanceTargetKey && isMaintenanceProbeCollection(collectionType));
              const masteryRow = teachingMasteryRows.find((row) => teachingMasteryRowMatchesGoal(row, goal));
              const maintenanceInfo = getGoalMaintenanceInfo(goal);
              const maintenanceProbeCanRunNow = Boolean(maintenanceInfo.hasAvailableMaintenanceProbe);
              const selected = mobileSelectedGoalKey === goalKey;
              const helpOpen = mobilePromptGridGoalKey === goalKey;
              const selectedPromptCategoryKey = helpOpen ? (mobilePromptCategoryByGoalKey[goalKey] || '') : '';
              const goalPromptCategoryBuckets = promptCategoryBucketsForGoal(goal);
              const selectedPromptCategory = goalPromptCategoryBuckets.find((bucket) => bucket.key === selectedPromptCategoryKey) || null;
              const criteriaOpen = mobileExpandedCriteriaKey === goalKey;
              const goalTherapeuticTimer = therapeuticTimers[therapeuticGoalKey(goal)] || null;
              const goalTherapeuticTimerLabel = goalTherapeuticTimer
                ? formatDurationSeconds(therapeuticTimerElapsedMs(goalTherapeuticTimer) / 1000)
                : '';
              const independentTrialLockKey = `trial:${goalKey}:independent:independent`;
              const errorTrialLockKey = `trial:${goalKey}:error:error`;
              const statusLabel = maintenanceProbeCanRunNow
                ? 'Manutenção'
                : maintenanceInfo.hasUpcomingMaintenanceProbe
                  ? 'Agendada futura'
                  : masteryRow?.contributes
                    ? 'Critério atingido'
                    : masteryRow?.statusCode === 'NOT_MET'
                      ? 'Em treino'
                      : masteryRow?.status || 'Dados insuficientes';
              const progressLabel = masteryRow?.criterionProgressLabel || 'Dados ainda não coletados';
              const progressPrefix = masteryRow?.criterionProgressPrefix || 'Hoje';
              const progressShortLabel = String(progressLabel).match(/^\s*\d+\s*\/\s*\d+/)?.[0]?.replace(/\s+/g, '') || progressLabel;
              const programName = String(goal.programName || goal.program_name || goal.protocolTitle || goal.protocol_title || '').trim();
              const targetName = String(goal.targetName || goal.target_name || goal.name || 'Alvo não identificado').trim();
              const instruction = String(goal.instruction || goal.antecedent || goal?.advanced_settings?.antecedent || '').trim();
              const expectedResponse = String(goal.expectedResponse || goal.expected_response || goal?.advanced_settings?.expectedResponse || '').trim();
              return (
                <article
                  key={`mobile-${goalKey}`}
                  data-aba-mobile-task-card
                  data-aba-mobile-goal-key={goalKey}
                  data-aba-mobile-primary-card={selected ? 'true' : 'false'}
                  onClick={() => {
                    setMobileSelectedGoalKey(goalKey);
                    syncTrialTypeForGoal(goal);
                    primeAbaV3BindingForGoal(goal);
                  }}
                  className={`min-w-0 overflow-hidden rounded-[18px] border bg-white px-3 py-3 shadow-sm transition-all ${selected ? 'border-[#7a32fc] ring-2 ring-[#7a32fc]/15' : 'border-blue-100'}`}
                >
                  <div className="space-y-2">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="max-w-[9.5rem] truncate rounded-full bg-[#7a32fc]/10 px-2 py-0.5 text-[9px] font-semibold leading-tight text-[#7a32fc]" title={goal.domainName || goal.domain_name || 'Meta'}>
                          {goal.domainName || goal.domain_name || 'Meta'}
                        </span>
                        {maintenanceProbeCanRunNow && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-700">Manutenção</span>
                        )}
                        {!maintenanceProbeCanRunNow && maintenanceInfo.hasUpcomingMaintenanceProbe && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">Manutenção agendada</span>
                        )}
                      </div>
                      <span className={`inline-flex max-w-[8.5rem] shrink-0 truncate rounded-full px-2 py-1 text-[9px] font-semibold ${maintenanceProbeCanRunNow ? 'bg-amber-100 text-amber-700' : masteryRow?.contributes ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600'}`} title={statusLabel}>
                        {statusLabel}
                      </span>
                    </div>
                    {programName && <div><p className="text-[10px] text-slate-500">Programa</p><p className="truncate text-xs text-slate-700" title={programName}>{programName}</p></div>}
                    <div><p className="text-[10px] text-slate-500">Alvo atual</p><h2 className={`${selected ? 'text-lg' : 'text-[15px]'} mt-0.5 line-clamp-2 overflow-hidden break-words font-medium leading-snug text-gray-900`}>{targetName}</h2></div>
                    {goalTherapeuticTimer && !selected && (
                      <div
                        className={`inline-flex max-w-full items-center gap-2 self-start rounded-full border px-2.5 py-1 text-[10px] font-semibold ${goalTherapeuticTimer.runningSince ? 'border-purple-100 bg-purple-50 text-[#7a32fc]' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                        data-aba-mobile-goal-running-timer
                        title={`${targetName} · ${goalTherapeuticTimer.runningSince ? 'em andamento' : 'pausado'} · ${goalTherapeuticTimerLabel}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${goalTherapeuticTimer.runningSince ? 'bg-[#7a32fc] animate-pulse' : 'bg-slate-400'}`} aria-hidden="true" />
                        <span className="min-w-0 truncate">{goalTherapeuticTimer.runningSince ? 'Cronômetro ativo' : 'Cronômetro pausado'}</span>
                        <span className="shrink-0 tabular-nums">{goalTherapeuticTimerLabel}</span>
                      </div>
                    )}
                    {selected && (instruction || expectedResponse) && <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600"><p>{instruction ? `Instrução: ${instruction}` : `Resposta esperada: ${expectedResponse}`}</p>{instruction && expectedResponse && <p>Resposta esperada: {expectedResponse}</p>}</div>}
                    {selected && (
                      <div className="inline-flex max-w-full items-center gap-2 self-start rounded-xl bg-[#F4EFFF] px-2.5 py-1.5" data-aba-mobile-progress-summary title={progressLabel}>
                        <p className="text-[10px] font-medium text-[#7a32fc]">Progresso</p>
                        <p className="text-xs font-semibold text-[#1B254B]">{progressShortLabel}</p>
                      </div>
                    )}
                    <div className="space-y-1 text-[11px] font-medium text-gray-500">
                      <p className="min-w-0 truncate" title={`${progressPrefix}: ${progressLabel}`}>{progressPrefix}: {progressLabel}</p>
                      {masteryRow?.criterion && <p className="line-clamp-2 overflow-hidden break-words" title={`Critério: ${masteryRow.criterion}`}>Critério: {masteryRow.criterion}</p>}
                    </div>
                  </div>
                  {selected && masteryRow?.statusCode === 'INSUFFICIENT_DATA' && <p className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800" data-aba-insufficient-data>Amostra ainda insuficiente para indicar tendência. Continue registrando conforme o critério configurado.</p>}
                  {selected && masteryRow?.criterionProgressKind === 'consecutive_independent' && masteryRow?.sequenceBrokenByLastTrial && (
                    <p className="mt-2 rounded-xl bg-orange-50 px-3 py-2 text-[11px] font-bold text-orange-700">
                      Última tentativa com ajuda ou erro quebrou a sequência.
                    </p>
                  )}

                  {selected && (
                    <div className="mt-3 space-y-2" data-aba-mobile-quick-actions>
                      {maintenanceProbeCanRunNow && !maintenanceProbeActiveForGoal && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            activateMaintenanceProbeMode(goal);
                          }}
                          className="inline-flex min-h-[34px] w-full items-center justify-center rounded-xl bg-amber-100 px-3 py-2 text-[11px] font-medium text-amber-800"
                        >
                          Usar sondagem
                        </button>
                      )}
                      {renderTherapeuticMeasurementCollector(goal, true) || (
                        <>
                          <p className="pt-1 text-[11px] font-medium text-slate-500">Registro de tentativa</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleTrialClick(goal, 1, 'independent');
                          }}
                          disabled={Boolean(actionLocks[independentTrialLockKey])}
                          className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#069669] px-3 text-xs font-semibold text-white transition-all disabled:opacity-75 ${microFeedback[independentTrialLockKey] === 'check' ? 'scale-[0.98] ring-4 ring-emerald-200/70' : ''}`}
                        >
                          <CheckCircle2 size={16} /> Independente
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleTrialClick(goal, 0, 'error');
                          }}
                          disabled={Boolean(actionLocks[errorTrialLockKey])}
                          className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#C91E1E] px-3 text-xs font-semibold text-white transition-all disabled:opacity-75 ${microFeedback[errorTrialLockKey] === 'check' ? 'scale-[0.98] ring-4 ring-red-200/70' : ''}`}
                        >
                          <X size={16} />
                          Erro
                        </button>
                      </div>
                      <div className="rounded-2xl border border-purple-100 bg-[#FBF7FF] p-2" data-aba-mobile-prompt-categories>
                        <p className="text-[11px] font-medium text-slate-500">Tipo de ajuda</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {goalPromptCategoryBuckets.map((bucket) => {
                            const active = selectedPromptCategoryKey === bucket.key;
                            return (
                              <button
                                key={bucket.key}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setMobilePromptGridGoalKey(goalKey);
                                  setMobilePromptCategoryByGoalKey((prev) => ({ ...prev, [goalKey]: bucket.key }));
                                }}
                                aria-pressed={active}
                                className={`min-h-[44px] rounded-xl border px-3 text-[11px] font-medium transition-all active:scale-95 ${active ? 'border-[#7a32fc] bg-white text-[#7a32fc] ring-2 ring-[#7a32fc]/10' : 'border-purple-100 bg-white text-slate-700'}`}
                              >
                                {bucket.label}
                              </button>
                            );
                          })}
                        </div>
                        {selectedPromptCategory && (
                          <div className="mt-2 grid grid-cols-2 gap-2" data-aba-mobile-help-grid data-aba-mobile-prompt-subtypes>
                            {selectedPromptCategory.prompts.map((prompt) => {
                            const promptedTrialLockKey = `trial:${goalKey}:prompted:${prompt.key}`;
                            const promptedActive = microFeedback[promptedTrialLockKey] === 'check';
                            return (
                              <button
                                key={prompt.key}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleTrialClick(goal, 0.5, 'prompted', prompt.key);
                                }}
                                disabled={Boolean(actionLocks[promptedTrialLockKey])}
                                aria-label={`Registrar ${goal.name} com ajuda ${prompt.label}`}
                                className={`min-h-[44px] rounded-xl border px-2 text-[11px] font-medium leading-tight transition-all disabled:opacity-75 ${promptedActive ? 'border-orange-300 bg-white text-orange-700 ring-4 ring-orange-200/60' : 'border-orange-100 bg-white text-orange-700'}`}
                              >
                                {prompt.compactLabel}
                              </button>
                            );
                            })}
                          </div>
                        )}
                      </div>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMobileExpandedCriteriaKey(criteriaOpen ? '' : goalKey);
                        }}
                        className="min-h-[32px] rounded-xl bg-slate-50 px-3 text-[11px] font-medium text-slate-500"
                      >
                        {criteriaOpen ? 'Ocultar critério' : 'Ver critério'}
                      </button>
                      {criteriaOpen && (
                        <div className="rounded-xl border border-blue-100 bg-[#F8FAFF] px-3 py-2 text-xs font-semibold leading-relaxed text-gray-600" data-aba-mobile-criteria-details>
                          <p>{masteryRow?.criterion || 'Critério não configurado.'}</p>
                          <p className="mt-1 text-[11px] text-gray-500">Origem: {masteryRow?.criterionSourceLabel || 'Critério de maestria não configurado'}</p>
                          <p className="mt-1 text-[11px] text-gray-500">{progressPrefix}: {progressLabel}</p>
                          {goal.criteria && <p className="mt-1 text-[11px] text-gray-500">{sanitizeDescriptionForDisplay(goal.criteria)}</p>}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="hidden space-y-5 sm:block">
            {sessionPlanGoals.map((goal: any) => {
              const goalKey = String(goal?.id || goal?.name || 'goal');
              const maintenanceTargetKey = getMaintenanceTargetKey(goal);
              const maintenanceProbeActiveForGoal = Boolean(maintenanceTargetKey && currentTrialTargetKey === maintenanceTargetKey && activeMaintenanceProbeTargetId === maintenanceTargetKey && isMaintenanceProbeCollection(collectionType));
              const masteryRow = teachingMasteryRows.find((row) => teachingMasteryRowMatchesGoal(row, goal));
              const maintenanceInfo = getGoalMaintenanceInfo(goal);
              const maintenanceProbeCanRunNow = Boolean(maintenanceInfo.hasAvailableMaintenanceProbe);
              const showMaintenanceOperationalBlock = Boolean(maintenanceProbeActiveForGoal);
              const maintenanceDisplay = showMaintenanceOperationalBlock ? resolveMaintenanceTargetDisplay({
                target: goal,
                schedule: maintenanceInfo.nextSchedule || maintenanceInfo.lastResult || maintenanceInfo.activeAlert || {
                  target_id: goalTargetId(goal) || maintenanceTargetKey || null,
                  target_name: goalTargetName(goal) || goal?.name || null,
                  protocolTitle: goal?.protocolTitle,
                  protocol_title: goal?.protocol_title,
                  domainName: goal?.domainName,
                  domain_name: goal?.domain_name
                },
                recentResult: maintenanceInfo.lastResult
              }) : null;
              const independentTrialLockKey = `trial:${goalKey}:independent:independent`;
              const errorTrialLockKey = `trial:${goalKey}:error:error`;
              const programName = String(goal.programName || goal.program_name || goal.protocolTitle || goal.protocol_title || '').trim();
              const targetName = String(goal.targetName || goal.target_name || goal.name || 'Alvo não identificado').trim();
              const instruction = String(goal.instruction || goal.antecedent || goal?.advanced_settings?.antecedent || '').trim();
              const expectedResponse = String(goal.expectedResponse || goal.expected_response || goal?.advanced_settings?.expectedResponse || '').trim();
              return (
                <div key={goal.id} onPointerDown={() => { syncTrialTypeForGoal(goal); primeAbaV3BindingForGoal(goal); }} className="bg-white rounded-[24px] sm:rounded-[32px] p-4 sm:p-6 shadow-xl shadow-blue-900/5 border border-white relative overflow-hidden">
                  <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap gap-2">
                        <span className="inline-flex bg-[#7a32fc]/10 px-3 py-1 text-[10px] font-medium text-[#7a32fc] rounded-full">
                          {goal.domainName || 'Meta'}
                        </span>
                        {maintenanceProbeCanRunNow && (
                          <span className="inline-flex bg-amber-100 px-3 py-1 text-[10px] font-medium text-amber-700 rounded-full">
                            Manutenção
                          </span>
                        )}
                      </div>
                      {programName && <div><p className="text-[11px] text-gray-500">Programa</p><p className="mt-0.5 truncate text-sm text-gray-700" title={programName}>{programName}</p></div>}
                      <div className={programName ? 'mt-3' : ''}><p className="text-[11px] text-gray-500">Alvo atual</p><h2 className="mt-0.5 text-xl font-medium tracking-tight text-gray-800 sm:text-2xl">{targetName}</h2></div>
                      {(instruction || expectedResponse) && <div className="mt-3 max-w-2xl space-y-1 rounded-2xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600"><p>{instruction ? `Instrução: ${instruction}` : `Resposta esperada: ${expectedResponse}`}</p>{instruction && expectedResponse && <p>Resposta esperada: {expectedResponse}</p>}</div>}
                    </div>
                    {(
                      <div className="text-left sm:text-right">
                        <p className="text-[10px] text-gray-400">Critério de domínio</p>
                        <p className="max-w-[220px] text-xs font-medium text-[#7a32fc] sm:ml-auto">{masteryRow?.criterion || 'Critério ainda não configurado'}</p>
                        <p className="mt-1 text-[11px] text-gray-500">Origem: {masteryRow?.criterionSourceLabel || 'Não configurado'}</p>
                        <p className="text-[11px] text-gray-500">
                          {masteryRow?.contributes ? 'Criterio concluido' : masteryRow?.criterionProgressPrefix || 'Hoje'}: {masteryRow?.criterionProgressLabel || 'Dados ainda não coletados'}
                        </p>
                        {masteryRow?.criterionProgressKind === 'consecutive_independent' && masteryRow?.sequenceBrokenByLastTrial && (
                          <p className="mt-1 text-[11px] text-orange-600">Última tentativa com ajuda ou erro quebrou a sequência.</p>
                        )}
                        <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[9px] font-medium ${masteryRow?.statusCode === 'READY_FOR_REVIEW' ? 'bg-emerald-50 text-emerald-600' : masteryRow?.statusCode === 'MET_TODAY' ? 'bg-blue-50 text-blue-600' : masteryRow?.statusCode === 'INSUFFICIENT_DATA' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                          {masteryRow?.status || 'Dados insuficientes'}
                        </span>
                      </div>
                    )}
                  </div>

                  {masteryRow?.statusCode === 'INSUFFICIENT_DATA' && (
                    <div className="mb-5 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800" data-aba-insufficient-data>
                      Amostra ainda insuficiente para indicar tendência. Continue registrando conforme o critério configurado.
                    </div>
                  )}

                  {showMaintenanceOperationalBlock && (
                    <div className="mb-5 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Este target está em manutenção.</p>
                          <p className="mt-1 text-xs font-bold text-amber-900">
                            {maintenanceProbeCanRunNow
                              ? `Tipo atual da proxima tentativa: ${getAbaCollectionLabel(collectionType)}`
                              : 'Sondagem agendada para outra data ou sessão.'}
                          </p>
                          {maintenanceDisplay?.contextLabel && (
                            <p className="mt-1 text-xs font-semibold text-amber-800">{maintenanceDisplay.contextLabel}</p>
                          )}
                          {maintenanceProbeActiveForGoal && (
                            <p className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                              Sondagem de manutenção ativa para {maintenanceDisplay?.targetDisplayName || 'esta tentativa'}
                            </p>
                          )}
                          <p className="mt-1 text-xs font-semibold text-amber-800">
                            {maintenanceProbeCanRunNow
                              ? 'Para avaliar manutencao, use a sondagem.'
                              : 'Disponivel somente na data ou sessão vinculada.'}
                          </p>
                          <p className="text-xs font-semibold text-amber-800">
                            {maintenanceInfo.nextSchedule ? formatMaintenanceDueLabel(maintenanceInfo.nextSchedule) : 'Sem sondagem agendada'}
                          </p>
                          {maintenanceDisplay?.clinicalMilestoneLabel && (
                            <p className="text-xs font-semibold text-amber-800">
                              Marco clínico: {maintenanceDisplay.clinicalMilestoneLabel}
                            </p>
                          )}
                          {!maintenanceInfo.nextSchedule && (
                            <p className="mt-1 text-xs font-semibold text-amber-800">
                              Este target esta em manutencao, mas ainda nao ha sondagem agendada.
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {maintenanceProbeCanRunNow && (
                            <button
                              type="button"
                              onClick={() => activateMaintenanceProbeMode(goal)}
                              className="inline-flex min-h-[38px] w-fit items-center justify-center rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 shadow-sm transition-all active:scale-95"
                            >
                              Usar sondagem
                            </button>
                          )}
                          {maintenanceProbeActiveForGoal && (
                            <button
                              type="button"
                              onClick={() => cancelActiveMaintenanceProbeMode(goal)}
                              className="inline-flex min-h-[38px] w-fit items-center justify-center rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-800 transition-all active:scale-95"
                            >
                              Cancelar uso da probe
                            </button>
                          )}
                        </div>
                      </div>
                      {maintenanceProbeFeedback && maintenanceProbeActiveForGoal && (
                        <p className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                          {maintenanceProbeFeedback}
                        </p>
                      )}
                      {maintenanceInfo.consecutiveFailures >= 2 && (
                        <p className="mt-2 text-xs font-bold text-red-600">{maintenanceInfo.consecutiveFailures} probes consecutivos abaixo do criterio</p>
                      )}
                      {maintenanceInfo.activeAlert && (
                        <p className="mt-2 text-xs font-bold text-red-600">Risco de regressao</p>
                      )}
                    </div>
                  )}

                  {renderTherapeuticMeasurementCollector(goal) || (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3" data-aba-trial-response-matrix>
                    <button
                      onClick={() => handleTrialClick(goal, 1, 'independent')}
                      disabled={Boolean(actionLocks[independentTrialLockKey])}
                      className={`relative flex min-h-[76px] flex-col items-center justify-center rounded-2xl bg-[#05CD99] px-4 text-white shadow-lg shadow-green-500/20 transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-90 ${maintenanceProbeActiveForGoal ? 'ring-4 ring-amber-200/80' : ''} ${microFeedback[independentTrialLockKey] === 'check' ? 'scale-[0.98] ring-4 ring-emerald-200/70' : ''}`}
                    >
                      {microFeedback[independentTrialLockKey] === 'check' && <span className="absolute right-4 top-4 rounded-full bg-white/25 p-1"><CheckCircle2 size={16} /></span>}
                      <CheckCircle2 size={22} />
                      <span className="mt-2 text-base font-medium">Independente</span>
                      <span className={`${mobileFocusMode ? 'hidden sm:block' : 'block'} text-[10px] opacity-80`}>Resposta correta sem ajuda</span>
                    </button>
                    <div className={`relative rounded-2xl border border-orange-100 bg-orange-50 p-3 shadow-lg shadow-orange-500/10 ${maintenanceProbeActiveForGoal ? 'ring-4 ring-amber-200/80' : ''}`}>
                      <div className="mb-2 flex min-h-[28px] items-center justify-center gap-2 px-2 text-orange-700">
                        <Activity size={18} />
                        <span className="text-xs font-medium">Com ajuda</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {promptedPromptOptionsForGoal(goal).map((prompt) => {
                          const promptedTrialLockKey = `trial:${goalKey}:prompted:${prompt.key}`;
                          const promptedActive = microFeedback[promptedTrialLockKey] === 'check';
                          return (
                            <button
                              key={prompt.key}
                              type="button"
                              onClick={() => handleTrialClick(goal, 0.5, 'prompted', prompt.key)}
                              disabled={Boolean(actionLocks[promptedTrialLockKey])}
                              aria-label={`Registrar ${goal.name} com ajuda ${prompt.label}`}
                              title={`Com ajuda ${prompt.label}`}
                              className={`relative flex min-h-[44px] items-center justify-center rounded-xl border px-2 text-center text-[11px] font-medium leading-tight transition-all active:scale-95 disabled:opacity-80 ${promptedActive ? 'scale-[0.98] border-orange-300 bg-white text-orange-700 ring-4 ring-orange-200/70' : 'border-orange-100 bg-white text-orange-700 shadow-sm hover:border-orange-300 hover:bg-orange-100'}`}
                            >
                              {promptedActive && <span className="absolute right-2 top-2 rounded-full bg-orange-100 p-0.5 text-orange-700"><CheckCircle2 size={12} /></span>}
                              <span className="max-w-full break-words">{prompt.compactLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      onClick={() => handleTrialClick(goal, 0, 'error')}
                      disabled={Boolean(actionLocks[errorTrialLockKey])}
                      className={`relative flex min-h-[76px] flex-col items-center justify-center rounded-2xl bg-[#EE5D50] px-4 text-white shadow-lg shadow-red-500/20 transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-90 ${maintenanceProbeActiveForGoal ? 'ring-4 ring-amber-200/80' : ''} ${microFeedback[errorTrialLockKey] === 'check' ? 'scale-[0.98] ring-4 ring-red-200/70' : ''}`}
                    >
                      {microFeedback[errorTrialLockKey] === 'check' && <span className="absolute right-4 top-4 rounded-full bg-white/25 p-1"><CheckCircle2 size={16} /></span>}
                      <X size={22} />
                      <span className="mt-2 text-base font-medium">Erro</span>
                      <span className={`${mobileFocusMode ? 'hidden sm:block' : 'block'} text-[10px] opacity-80`}>Erro ou sem resposta</span>
                    </button>
                    </div>
                  )}

                  <div className="mt-5 text-center">
                    <button
                      type="button"
                      onClick={() => setActiveCriteria((current) => current === goal.id ? null : goal.id)}
                      aria-expanded={activeCriteria === goal.id}
                      className="min-h-[36px] rounded-xl px-3 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#7a32fc]"
                    >
                      {activeCriteria === goal.id ? 'Ocultar critério' : 'Ver critério'}
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

        {sessionHistoryOpen && <><button type="button" aria-label="Fechar histórico da sessão" className="fixed inset-0 z-[108] bg-slate-950/20 xl:hidden" onClick={() => setSessionHistoryOpen(false)} /><aside className="fixed inset-x-0 bottom-0 z-[109] max-h-[76dvh] overflow-y-auto rounded-t-3xl border border-gray-100 bg-white p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:p-5 xl:static xl:z-auto xl:max-h-none xl:rounded-none xl:border-y-0 xl:border-r-0 xl:border-l xl:shadow-none xl:overflow-y-auto" style={scrollBottomPaddingStyle} data-aba-session-history-panel>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[10px] text-gray-400">Histórico da sessão</p>
              <h2 className="text-lg font-medium text-gray-800">{liveSummaryTotals.recordTotal} registro(s)</h2>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-right">
                <p className="text-[10px] text-gray-400">Tentativas hoje</p>
                <p className="text-2xl font-medium text-[#7a32fc] leading-none">{liveSummaryTotals.trialTotal}</p>
              </div>
              <button type="button" onClick={() => setSessionHistoryOpen(false)} aria-label="Fechar histórico" className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"><X size={17} /></button>
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
              <div key={record.id} data-aba-session-record-id={record.id} tabIndex={-1} className="rounded-2xl border border-gray-100 bg-[#F8FAFF] p-3 sm:p-4 outline-none focus:ring-2 focus:ring-[#7a32fc]/25">
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
                        {record.kind === 'trial' ? (
                          <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3">
                            <label className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">
                              Tipo da tentativa
                              <select
                                value={editingRecordCollectionType}
                                onChange={(event) => setEditingRecordCollectionType(event.target.value)}
                                className="mt-1 w-full rounded-xl border border-amber-100 bg-white px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                              >
                                {collectionOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                              </select>
                            </label>
                            <p className="mt-2 text-[11px] font-semibold text-amber-800">
                              Alterar o tipo pode mudar cálculos de aquisição, manutenção e gráficos.
                            </p>
                          </div>
                        ) : (
                          <textarea
                            value={editingRecordDetail}
                            onChange={(event) => setEditingRecordDetail(event.target.value)}
                            className="w-full min-h-[74px] rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs text-gray-600 outline-none resize-none focus:border-[#7a32fc]"
                          />
                        )}
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
                      {record.measurementModelVersion === 'V3' ? (
                        <div className="flex max-w-[190px] flex-wrap justify-end gap-1.5">
                          <span className="inline-flex min-h-[32px] items-center rounded-full border border-purple-100 bg-purple-50 px-3 py-1 text-[10px] uppercase tracking-widest text-purple-600">V3 · auditável</span>
                          {record.kind === 'trial' && record.syncStatus === 'error' && (
                            <>
                              <button type="button" onClick={() => void retryFailedV3Trial(record)} className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                                <RotateCcw size={11} /> Tentar novamente
                              </button>
                              <button type="button" onClick={() => void discardFailedV3Trial(record)} className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-red-100 bg-red-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-red-600">
                                <X size={11} /> Descartar erro
                              </button>
                            </>
                          )}
                          {record.kind === 'trial' && record.syncStatus === 'local' && record.rawPayload?.pendingV3Revision && (
                            <button type="button" onClick={() => void retryPendingV3Revision(record)} className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                              <RotateCcw size={11} /> Sincronizar revisão
                            </button>
                          )}
                          {record.kind === 'trial' && record.syncStatus === 'synced' && (
                            <>
                              <button type="button" onClick={() => openV3Revision(record, 'CORRECT')} className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-gray-100 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:text-[#7a32fc]">
                                <Pencil size={11} /> Editar
                              </button>
                              <button type="button" onClick={() => openV3Revision(record, 'VOID')} className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-red-100 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-red-500">
                                <X size={11} /> Apagar
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <button onClick={() => startEditingRecord(record)} className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-white border border-gray-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-[#7a32fc]">
                          <Pencil size={11} /> Editar
                        </button>
                      )}
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
        </aside></>}
      </div>

      {maintenanceScheduleModalGoal && (
        <div className="fixed inset-0 z-[218] flex items-end justify-center bg-gray-950/40 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center sm:p-6">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[24px] border border-amber-100 bg-white p-5 shadow-2xl shadow-gray-950/20 custom-scrollbar">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Agendar sondagem de manutencao</p>
                <h2 className="mt-1 text-xl font-black text-gray-900">Target: {maintenanceScheduleModalGoal.name || maintenanceScheduleModalGoal.target_name || maintenanceScheduleModalGoal.targetName}</h2>
              </div>
              <button type="button" onClick={() => setMaintenanceScheduleModalGoal(null)} className="rounded-full bg-gray-100 p-2 text-gray-500">
                <X size={18} />
              </button>
            </div>

            <p className="mt-4 text-sm font-bold text-gray-800">Quando deseja sondar este target?</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              {[
                {
                  mode: 'NEXT_PATIENT_SESSION',
                  title: 'Na proxima sessao',
                  description: 'A sondagem sera feita na proxima sessao agendada deste paciente.'
                },
                {
                  mode: 'DEFAULT_SEQUENCE',
                  title: 'Plano 7/14/30/60',
                  description: 'Cria checagens em 7, 14, 30 e 60 dias e tenta vincular cada uma a sessao mais proxima.'
                },
                {
                  mode: 'CUSTOM_DATE',
                  title: 'Escolher uma data',
                  description: 'Escolha manualmente uma data para esta sondagem.'
                }
              ].map((option) => {
                const selected = maintenanceScheduleMode === option.mode;
                return (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => {
                      setMaintenanceScheduleMode(option.mode);
                      setPlanningMessage('');
                      if (option.mode !== 'CUSTOM_DATE') setMaintenanceSelectedAppointmentId('');
                    }}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all ${selected ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-500/15' : 'border-gray-100 bg-white hover:border-amber-200'}`}
                  >
                    <span className="text-sm font-black text-gray-900">{option.title}</span>
                    <span className="mt-1 block text-xs font-semibold leading-relaxed text-gray-500">{option.description}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Proximas sessoes do paciente</p>
              {maintenanceAppointmentsState.loading ? (
                <p className="mt-2 text-xs font-semibold text-gray-500">Carregando proximas sessoes...</p>
              ) : maintenanceAppointments.length > 0 ? (
                <div className="mt-2 max-h-36 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                  {maintenanceAppointments.slice(0, 20).map((appointment: any) => {
                    const selected = maintenanceSelectedAppointmentId === String(appointment.id || '');
                    return (
                      <button
                        key={appointment.id}
                        type="button"
                        onClick={() => setMaintenanceSelectedAppointmentId(selected ? '' : String(appointment.id || ''))}
                        className={`w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold ${selected ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-white bg-white text-gray-600'}`}
                      >
                        {formatMaintenanceAppointmentLine(appointment)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs font-semibold text-gray-500">Este paciente ainda nao possui proximas sessoes.</p>
              )}
              {maintenanceAppointmentsState.error && <p className="mt-2 text-xs font-bold text-amber-700">{maintenanceAppointmentsState.error}</p>}
            </div>

            {maintenanceScheduleMode === 'NEXT_PATIENT_SESSION' && (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Proxima sessao</p>
                {firstMaintenanceAppointment ? (
                  <p className="mt-2 text-sm font-bold text-amber-950">{formatMaintenanceAppointmentLine(firstMaintenanceAppointment)}</p>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-amber-900">
                    Nao ha proxima sessao agendada. A sondagem ficara pendente e sera sugerida quando uma nova sessao for marcada.
                  </p>
                )}
              </div>
            )}

            {maintenanceScheduleMode === 'DEFAULT_SEQUENCE' && (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Plano de manutencao 7/14/30/60</p>
                <p className="mt-2 text-xs font-semibold text-amber-900">
                  O plano cria quatro checagens apos a maestria. O sistema tenta vincular cada checagem a sessao mais proxima do paciente.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {maintenancePlanPreview.map((item) => (
                    <div key={item.day} className="rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold text-amber-950">
                      Marco {item.day} dias &gt; {item.targetDate} &gt; {item.appointment ? formatMaintenanceAppointmentLine(item.appointment) : 'pendente'}
                    </div>
                  ))}
                </div>
                {maintenanceAppointments.length === 0 && (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Nenhuma sessao futura encontrada. O plano sera criado como pendente e podera ser vinculado quando novas sessoes forem agendadas.
                  </p>
                )}
              </div>
            )}

            {maintenanceScheduleMode === 'CUSTOM_DATE' && (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                  Data especifica
                  <input type="date" value={maintenanceCustomDate} onChange={(event) => { setMaintenanceCustomDate(event.target.value); setMaintenanceSelectedAppointmentId(''); }} className="mt-1 w-full rounded-xl border border-amber-100 bg-white px-3 py-3 text-xs font-bold text-gray-700 outline-none" />
                </label>
                {maintenanceCustomDate && (
                  <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold text-amber-900">
                    {customDateAppointments.sameDay ? (
                      <div>
                        <p>Sessao encontrada nesta data: {formatMaintenanceAppointmentLine(customDateAppointments.sameDay)}</p>
                        <button type="button" onClick={() => setMaintenanceSelectedAppointmentId(String(customDateAppointments.sameDay.id || ''))} className="mt-2 rounded-full bg-amber-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                          Vincular a sessao sugerida
                        </button>
                      </div>
                    ) : customDateAppointments.nearest ? (
                      <div>
                        <p>Nao ha sessao nesta data. Sessao proxima: {formatMaintenanceAppointmentLine(customDateAppointments.nearest)}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" onClick={() => setMaintenanceSelectedAppointmentId(String(customDateAppointments.nearest.id || ''))} className="rounded-full bg-amber-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                            Vincular a sessao sugerida
                          </button>
                          <button type="button" onClick={() => setMaintenanceSelectedAppointmentId('')} className="rounded-full border border-amber-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                            Salvar como pendente
                          </button>
                          <button type="button" onClick={() => { setMaintenanceCustomDate(''); setMaintenanceSelectedAppointmentId(''); }} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                            Escolher outra data
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p>Nao ha sessao proxima. Salve como pendente para preservar a intencao clinica.</p>
                    )}
                    {selectedMaintenanceAppointment && (
                      <p className="mt-2 text-amber-800">Sessao selecionada: {formatMaintenanceAppointmentLine(selectedMaintenanceAppointment)}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {planningMessage && <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">{planningMessage}</p>}

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={handleScheduleMaintenanceGoal} disabled={maintenanceScheduleSaving} className="min-h-[46px] rounded-2xl bg-amber-600 px-4 py-3 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-60">
                {maintenanceScheduleSaving
                  ? 'Agendando...'
                  : maintenanceScheduleMode === 'NEXT_PATIENT_SESSION'
                    ? 'Agendar na proxima sessao'
                    : maintenanceScheduleMode === 'DEFAULT_SEQUENCE'
                      ? 'Criar plano de manutencao'
                      : 'Agendar nesta data'}
              </button>
              <button type="button" onClick={() => setMaintenanceScheduleModalGoal(null)} className="min-h-[46px] rounded-2xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-500">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingMaintenanceProbeTrial && (
        <div className="fixed inset-0 z-[220] flex items-end justify-center bg-gray-950/40 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center sm:p-6">
          <div className="w-full max-w-lg rounded-[28px] border border-amber-100 bg-white p-5 shadow-2xl shadow-gray-950/20">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Possível duplicidade</p>
            <h2 className="mt-2 text-xl font-black text-gray-900">
              Já existe uma tentativa registrada para este target nesta sessão.
            </h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-gray-600">
              Você quer registrar uma nova sondagem de manutenção ou converter a tentativa anterior?
            </p>
            {(() => {
              const previousRecord = records.find((record) => record.id === pendingMaintenanceProbeTrial.previousRecordId);
              return previousRecord ? (
                <div className="mt-4 rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Tentativa anterior</p>
                  <p className="mt-1 text-sm font-bold text-gray-800">{previousRecord.title}</p>
                  <p className="mt-1 text-xs font-semibold text-gray-500">{previousRecord.detail}</p>
                </div>
              ) : null;
            })()}
            <div className={`mt-5 grid grid-cols-1 gap-2 ${pendingMaintenanceProbeTrial.measurementModelVersion === 'V3' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
              <button
                type="button"
                onClick={() => {
                  const pending = pendingMaintenanceProbeTrial;
                  setPendingMaintenanceProbeTrial(null);
                  if (!pending) return;
                  if (pending.measurementModelVersion === 'V3' && pending.v3ActionKey) {
                    void persistV3TrialRecord({
                      goal: pending.goal,
                      actionKey: pending.v3ActionKey,
                      selectedPrompt: pending.selectedPrompt,
                      activeCollectionType: 'maintenance_probe',
                      activeMaintenanceProbe: pending.activeMaintenanceProbe || getActiveMaintenanceProbeForTarget(pending.goal)
                    });
                  } else {
                    void persistTrialRecord({
                      goal: pending.goal,
                      score: pending.score,
                      outcome: pending.outcome,
                      selectedPrompt: pending.selectedPrompt,
                      activeCollectionType: 'maintenance_probe',
                      activeMaintenanceProbe: getActiveMaintenanceProbeForTarget(pending.goal)
                    });
                  }
                }}
                className="min-h-[48px] rounded-2xl bg-emerald-500 px-4 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-lg shadow-emerald-500/20"
              >
                Registrar nova tentativa
              </button>
              {pendingMaintenanceProbeTrial.measurementModelVersion !== 'V3' && (
                <button
                  type="button"
                  onClick={() => convertPreviousTrialToMaintenanceProbe(pendingMaintenanceProbeTrial.previousRecordId)}
                  className="min-h-[48px] rounded-2xl bg-[#7a32fc] px-4 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-lg shadow-purple-500/20"
                >
                  Converter tentativa anterior
                </button>
              )}
              <button
                type="button"
                onClick={() => setPendingMaintenanceProbeTrial(null)}
                className="min-h-[48px] rounded-2xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-500"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {abaV3RevisionModal}

      {abcModal}

      {abaV3TaskAnalysisModal && (
        <div className="fixed inset-0 z-[143] flex items-end justify-center bg-black/30 p-3 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-purple-100 bg-white p-4 shadow-2xl sm:rounded-[32px] sm:p-6 custom-scrollbar">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-purple-500">Análise de tarefa · ABA V3</p>
                <h2 className="mt-1 text-xl font-semibold text-gray-800">{goalTargetName(abaV3TaskAnalysisModal.goal) || 'Análise de tarefa'}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">Registre cada passo como fato observado. Passos não avaliados permanecem como “Não observado”.</p>
              </div>
              <button type="button" onClick={() => { setAbaV3TaskAnalysisModal(null); setAbaV3TaskAnalysisResults({}); }} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Fechar análise de tarefa">
                <X size={20} />
              </button>
            </div>
            <div className="mt-5 space-y-3">
              {abaV3TaskAnalysisModal.steps.map((step) => {
                const value = abaV3TaskAnalysisResults[Number(step.sequence_no)] || { performanceCode: 'NOT_OBSERVED', promptKey: null };
                return (
                  <div key={step.id || step.sequence_no} className="rounded-2xl border border-gray-100 bg-[#F8FAFF] p-4">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-semibold text-purple-700">{step.sequence_no}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-800">{step.label}</p>
                        {step.description && <p className="mt-1 text-xs leading-relaxed text-gray-500">{step.description}</p>}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="text-xs text-gray-500">
                        Resultado
                        <select
                          value={value.performanceCode}
                          onChange={(event) => setAbaV3TaskAnalysisResults((prev) => ({ ...prev, [Number(step.sequence_no)]: { performanceCode: event.target.value, promptKey: event.target.value === 'PROMPTED' ? prev[Number(step.sequence_no)]?.promptKey || null : null } }))}
                          className="mt-1 w-full rounded-xl border border-blue-100 bg-white px-3 py-3 text-sm text-gray-700 outline-none"
                        >
                          <option value="NOT_OBSERVED">Não observado</option>
                          <option value="INDEPENDENT">Independente</option>
                          <option value="PROMPTED">Com ajuda</option>
                          <option value="INCORRECT">Resposta incorreta</option>
                          <option value="NO_RESPONSE">Sem resposta</option>
                          <option value="NOT_APPLICABLE">Não aplicável</option>
                        </select>
                      </label>
                      {value.performanceCode === 'PROMPTED' && (
                        <label className="text-xs text-gray-500">
                          Tipo de ajuda
                          <select
                            value={value.promptKey || ''}
                            onChange={(event) => setAbaV3TaskAnalysisResults((prev) => ({ ...prev, [Number(step.sequence_no)]: { performanceCode: 'PROMPTED', promptKey: event.target.value || null } }))}
                            className="mt-1 w-full rounded-xl border border-purple-100 bg-white px-3 py-3 text-sm text-gray-700 outline-none"
                          >
                            <option value="">Selecione</option>
                            {v3PromptedPromptOptions.map((prompt) => <option key={prompt.key} value={prompt.key}>{prompt.label}</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => void saveAbaV3TaskAnalysis()} disabled={abaV3TaskAnalysisSaving} className="min-h-[48px] rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {abaV3TaskAnalysisSaving ? 'Salvando…' : 'Salvar análise de tarefa'}
              </button>
              <button type="button" onClick={() => { setAbaV3TaskAnalysisModal(null); setAbaV3TaskAnalysisResults({}); }} disabled={abaV3TaskAnalysisSaving} className="min-h-[48px] rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-600 disabled:opacity-60">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {abaV3ErrorSelection && (
        <div className="fixed inset-0 z-[142] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-[28px] sm:rounded-[32px] p-4 sm:p-6 shadow-2xl max-w-lg w-full border border-red-100">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Resultado da tentativa · ABA V3</p>
                <h2 className="mt-1 text-xl font-semibold text-gray-800">O que aconteceu com {abaV3ErrorSelection.goal?.name || 'este target'}?</h2>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-gray-500">A V3 não mistura resposta incorreta com ausência de resposta. Escolha o fato observado.</p>
              </div>
              <button type="button" onClick={() => setAbaV3ErrorSelection(null)} className="p-2 rounded-full hover:bg-gray-100" aria-label="Fechar">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void saveAbaV3ErrorOutcome('INDEPENDENT_INCORRECT')}
                className="min-h-[72px] rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-left transition-all hover:border-red-300 hover:bg-red-100"
              >
                <span className="block text-sm font-semibold text-red-700">Resposta incorreta</span>
                <span className="mt-1 block text-xs font-semibold text-red-600/80">Houve uma resposta independente, mas ela estava incorreta.</span>
              </button>
              <button
                type="button"
                onClick={() => void saveAbaV3ErrorOutcome('NO_RESPONSE')}
                className="min-h-[72px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition-all hover:border-slate-300 hover:bg-slate-100"
              >
                <span className="block text-sm font-semibold text-slate-700">Sem resposta</span>
                <span className="mt-1 block text-xs font-semibold text-slate-500">A oportunidade ocorreu, mas não houve resposta observável.</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                // NO_OPPORTUNITY is an exposure state, never a NO_RESPONSE
                // clinical trial or a zero score. Do not invent a trial locally.
                setAbaV3ErrorSelection(null);
                showClinicalToast({
                  variant: 'info',
                  title: 'Não houve oportunidade de tentativa',
                  subtitle: 'Nenhuma tentativa foi registrada ou contabilizada. Use esta opção somente quando a oportunidade realmente não ocorreu.'
                }, 'none');
              }}
              className="mt-3 w-full min-h-[48px] rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-left text-sm font-semibold text-blue-800"
            >
              Não houve oportunidade — não contabilizar tentativa
            </button>
            <button type="button" onClick={() => setAbaV3ErrorSelection(null)} className="mt-3 w-full py-3 rounded-2xl bg-gray-100 text-gray-600 font-semibold">
              Cancelar
            </button>
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
              {promptedPromptOptionsForGoal(promptSelectionGoal).map((prompt) => (
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
        <div ref={sessionSummaryScrollRef} className="fixed inset-0 z-[145] flex items-start justify-center overflow-y-auto overflow-x-hidden overscroll-contain scroll-pt-3 p-3 sm:p-4 bg-slate-900/30 backdrop-blur-sm">
          <div className="my-0 sm:my-2 bg-[#F4F7FE] rounded-[28px] sm:rounded-[32px] p-4 sm:p-6 shadow-2xl max-w-6xl w-full border border-blue-100">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-[10px] font-semibold text-[#7a32fc] uppercase tracking-widest">Encerramento do atendimento</p>
                <h3 className="text-2xl font-semibold text-gray-900 mt-1">Conferência final</h3>
                <p className="text-sm text-gray-500 mt-1">Confirme presença, dados clínicos e pendências operacionais antes de finalizar.</p>
              </div>
              <button onClick={returnToActiveSession} disabled={endingSession} className="p-2 rounded-full hover:bg-white text-gray-500 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Voltar para o atendimento">
                <X size={20} />
              </button>
            </div>

            <div ref={closureAttendanceRef}>
            <SessionSummaryDisclosure title="Presença no atendimento" meta={SESSION_ATTENDANCE_OPTIONS.find((option) => option.value === attendanceStatus)?.label || 'Selecione'}>
<section className="rounded-[24px] bg-white border border-blue-100 p-5">
              <h4 className="text-lg font-semibold text-gray-900">Presença no atendimento</h4>
              <p className="mt-1 text-sm text-gray-500">Essa classificação define o fechamento operacional e a elegibilidade para faturamento.</p>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Presença no atendimento">
                {SESSION_ATTENDANCE_OPTIONS.map((option) => {
                  const selected = attendanceStatus === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={endingSession}
                      onClick={() => {
                        setAttendanceStatus(option.value);
                        setSessionEndError('');
                        setSessionWarning('');
                      }}
                      className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-[#7a32fc] bg-violet-50 shadow-sm' : 'border-gray-100 bg-[#F8FAFF] hover:border-violet-200'}`}
                    >
                      <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-gray-500">{option.description}</span>
                    </button>
                  );
                })}
              </div>
              {NON_ATTENDANCE_STATUSES.has(attendanceStatus) && (
                <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Informe o motivo abaixo. Faltas e cancelamentos não seguem para faturamento de convênio e não podem conter registros clínicos de atendimento realizado.
                </div>
              )}
            </section>
            </SessionSummaryDisclosure>
            </div>

            <SessionSummaryDisclosure title="Resumo geral" meta={`${formatSessionDuration(sessionClosureSummary.durationSeconds)} · ${sessionClosureSummary.totalTrials} tentativa(s) · ${sessionClosureSummary.totalBehaviorEvents} registro(s)`}>
<section className="mt-4 rounded-[24px] bg-white border border-blue-100 p-5">
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
            </SessionSummaryDisclosure>

            <SessionSummaryDisclosure title="Resumo de comportamentos" meta={`${sessionClosureSummary.totalBehaviorEvents} registro(s)`}>
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
            </SessionSummaryDisclosure>

            <SessionSummaryDisclosure title="Tentativas de ensino" meta={`${sessionClosureSummary.totalTrials} tentativa(s)`}>
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
            </SessionSummaryDisclosure>

            <SessionSummaryDisclosure title="Critérios de maestria" meta={`${teachingMasteryRows.length} alvo(s)`}>
<section className="mt-4 rounded-[24px] bg-white border border-blue-100 p-5">
              <h4 className="text-lg font-bold text-gray-900">Critérios de maestria</h4>
              <div className="mt-3 space-y-2">
                {teachingMasteryRows.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhum critério de maestria relacionado à meta atual.</p>
                ) : teachingMasteryRows.map((row) => (
                  <div key={row.id} className="rounded-2xl bg-[#F8FAFF] border border-gray-100 p-3">
                    <p className="font-bold text-gray-900">{row.name}</p>
                    <p className="text-xs text-gray-500">critério: {row.criterion}</p>
                    <p className="text-xs text-gray-500">origem: {row.criterionSourceLabel || 'Criterio de maestria nao configurado'}</p>
                    <p className="text-xs text-gray-500">desempenho: {row.performanceText}</p>
                    <p className="text-xs text-gray-500">tentativas: {row.totalTrials ?? 0} - acurácia {row.accuracyPercent ?? 0}% - independência {row.independencePercent ?? 0}%</p>
                    <p className="text-xs text-gray-500">progresso do critério: {row.criterionProgressLabel || `${row.consecutiveSuccessfulDays ?? 0} dias consecutivos`}</p>
                    <p className="text-xs text-gray-500">contribuiu para o critério: {row.contributes ? 'sim' : 'não'}</p>
                    <p className="text-xs font-bold text-[#7a32fc]">{row.status}</p>
                    {Array.isArray(row.reasons) && row.reasons.length > 0 && (
                      <p className="mt-1 text-xs text-gray-500">{row.reasons.map((reason: any) => reason?.message || reason).filter(Boolean).join(' ')}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
            </SessionSummaryDisclosure>

            <SessionSummaryDisclosure title="Manutencao e regressao" meta={`${maintenanceProbeRows.length} alvo(s)`} tone="amber">
<section className="mt-4 rounded-[24px] bg-white border border-amber-100 p-5">
              <h4 className="text-lg font-bold text-amber-700">Manutencao e regressao</h4>
              <div className="mt-3 space-y-2">
                {maintenanceProbeRows.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhum target em manutencao relacionado a esta sessao.</p>
                ) : maintenanceProbeRows.map((row: any) => (
                  <div key={row.id} className="rounded-2xl bg-[#FFFDF7] border border-amber-100 p-3">
                    <p className="font-bold text-gray-900">{row.name}</p>
                    {row.contextLabel && <p className="text-xs text-gray-500">{row.contextLabel}</p>}
                    <p className="text-xs text-gray-500">{row.nextSchedule ? formatMaintenanceDueLabel(row.nextSchedule) : 'Sem sondagem agendada'}</p>
                    <p className="text-xs text-gray-500">status: {row.status}</p>
                    <p className="text-xs text-gray-500">probes hoje: {row.totalTrials ?? 0} - acuracia {row.accuracyPercent ?? 0}% - independencia {row.independencePercent ?? 0}%</p>
                    {row.consecutiveFailureCount >= 2 && <p className="text-xs font-bold text-red-600">{row.consecutiveFailureCount} probes consecutivos abaixo do criterio</p>}
                    {row.activeAlert && <p className="text-xs font-bold text-red-600">Risco de regressao</p>}
                  </div>
                ))}
              </div>
            </section>
            </SessionSummaryDisclosure>

            <SessionSummaryDisclosure title="Preparação do encerramento" meta={`${closureBlockers.length} pendência(s)`} tone="default">
<section className="mt-4 rounded-[24px] bg-white border border-blue-100 p-5">
              <h4 className="text-lg font-bold text-gray-800">Preparação do encerramento</h4>
              {hasClosureBlockers && (
                <p className="mt-2 rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-sm font-semibold text-red-700">
                  Ao confirmar, cronômetros e estados transitórios serão finalizados automaticamente; registros pendentes serão sincronizados antes da confirmação.
                </p>
              )}
              <div className="mt-3 space-y-2">
                {closureBlockers.length === 0 ? (
                  <p className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-700">Nenhum bloqueio. O encerramento está liberado.</p>
                ) : closureBlockers.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => resolveClosureBlocker(item)}
                    disabled={endingSession}
                    className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-left text-sm font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-100/70 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={`Resolver bloqueio: ${item.label}`}
                  >
                    <span className="min-w-0 flex-1">{item.label}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-red-600 shadow-sm">
                      Resolver <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
              {openDurations.length > 0 && (
                <div ref={closureDurationResolutionRef} className="mt-4 space-y-3">
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
                          <button onClick={returnToActiveSession} className="rounded-xl bg-gray-100 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">Voltar para sessão</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {intervalRun && (
                <div ref={closureIntervalResolutionRef} className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4">
                  <p className="font-bold text-red-700">Há uma coleta por intervalo em andamento</p>
                  <p className="mt-1 text-sm text-red-700">{intervalRun.behaviorName} - {getMeasurementLabel(intervalRun.measurementType)} - intervalo {intervalRun.intervalIndex}/{intervalRun.totalIntervals}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {intervalRunPaused && <button onClick={resumeIntervalRun} className="rounded-xl bg-[#1B254B] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white">Retomar coleta</button>}
                    <button onClick={finishIntervalRunNow} className="rounded-xl bg-emerald-500 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white">Finalizar coleta agora</button>
                    <button onClick={requestCancelIntervalRun} className="rounded-xl bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-600 border border-red-100">Cancelar coleta</button>
                    <button onClick={returnToActiveSession} className="rounded-xl bg-gray-100 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">Voltar para sessão</button>
                  </div>
                </div>
              )}
            </section>
            </SessionSummaryDisclosure>

            <SessionSummaryDisclosure title="Avisos de encerramento" meta={`${closureWarnings.length} aviso(s)`} tone="amber">
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
            </SessionSummaryDisclosure>

            <div ref={closureNoteRef}>
            <SessionSummaryDisclosure
              title={NON_ATTENDANCE_STATUSES.has(attendanceStatus) ? 'Motivo da falta ou do cancelamento' : 'Observação do atendimento'}
              meta={sessionNote.trim() ? 'preenchida' : NON_ATTENDANCE_STATUSES.has(attendanceStatus) ? 'toque para informar' : 'opcional'}
            >
<section className="mt-4 rounded-[24px] bg-white border border-blue-100 p-5">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                {NON_ATTENDANCE_STATUSES.has(attendanceStatus) ? 'Motivo da falta ou do cancelamento' : 'Observação do atendimento'}
                <textarea
                  value={sessionNote}
                  onChange={(event) => setSessionNote(event.target.value.slice(0, 4000))}
                  maxLength={4000}
                  disabled={endingSession}
                  placeholder={NON_ATTENDANCE_STATUSES.has(attendanceStatus)
                    ? 'Descreva o motivo informado pelo paciente, responsável, clínica ou profissional...'
                    : 'Resumo clínico do atendimento, intercorrências, resposta do paciente e orientações relevantes...'}
                  className="mt-2 w-full min-h-[104px] rounded-2xl border border-blue-100 bg-[#F8FAFF] px-4 py-3 text-sm text-gray-700 outline-none resize-none focus:border-[#7a32fc] disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span className="mt-1 block text-right text-[10px] font-normal normal-case tracking-normal text-gray-400">{sessionNote.length}/4000</span>
              </label>
            </section>
            </SessionSummaryDisclosure>
            </div>

            {sessionEndError && (
              <div role="alert" className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {sessionEndError}
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button onClick={returnToActiveSession} disabled={endingSession || reinforcerClosureSyncing} className="flex-1 py-3 rounded-2xl bg-white border border-blue-100 text-gray-600 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Voltar para o atendimento</button>
              <button
                onClick={confirmEndSession}
                disabled={endingSession || reinforcerClosureSyncing}
                className={`flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold shadow-lg transition-all ${endingSession || reinforcerClosureSyncing ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' : 'bg-[#7a32fc] text-white shadow-purple-500/20 hover:bg-[#6425df]'}`}
              >
                {(endingSession || reinforcerClosureSyncing) && <Loader2 size={18} className="animate-spin" />}
                {reinforcerClosureSyncing ? 'Sincronizando registros antes de encerrar…' : endingSession ? 'Encerrando com segurança...' : NON_ATTENDANCE_STATUSES.has(attendanceStatus) ? 'Confirmar ausência e encerrar' : 'Confirmar encerramento do atendimento'}
              </button>
            </div>
          </div>
        </div>
      )}
      {noShowReopenPromptOpen && (
        <div className="fixed inset-0 z-[212] flex items-end justify-center bg-slate-950/40 px-3 pb-4 backdrop-blur-[2px] sm:items-center sm:pb-0" data-aba-no-show-reopen>
          <div className="w-full max-w-lg rounded-[24px] border border-amber-100 bg-white p-5 shadow-2xl shadow-slate-950/20">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                <RotateCcw size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">Reabrir falta antes de concluir</h3>
                <p className="mt-1 text-sm text-slate-600">Este agendamento foi classificado como falta. A reabertura preserva o histórico da falta e permite concluir depois como comparecimento.</p>
              </div>
            </div>
            {canReopenNoShow ? (
              <label className="mt-4 block text-xs font-semibold text-slate-600">
                Justificativa da reabertura
                <textarea
                  value={noShowReopenReason}
                  onChange={(event) => setNoShowReopenReason(event.target.value.slice(0, 1000))}
                  maxLength={1000}
                  disabled={reopeningNoShow}
                  className="mt-2 min-h-[96px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal text-slate-800 outline-none focus:border-[#7a32fc]"
                  placeholder="Ex.: presença confirmada posteriormente e atendimento realizado."
                />
              </label>
            ) : (
              <p className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">Seu perfil não pode reabrir faltas. Solicite a reabertura a um coordenador ou diretor; depois, retorne a esta sessão e conclua novamente.</p>
            )}
            {noShowReopenError && <p role="alert" className="mt-3 text-sm font-semibold text-red-600">{noShowReopenError}</p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={reopeningNoShow} onClick={() => setNoShowReopenPromptOpen(false)} className="min-h-[44px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 disabled:opacity-50">Manter sessão aberta</button>
              {canReopenNoShow && (
                <button type="button" disabled={reopeningNoShow || noShowReopenReason.trim().length < 5} onClick={() => void handleReopenNoShowAndRetryCompletion()} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
                  {reopeningNoShow && <Loader2 size={16} className="animate-spin" />}
                  {reopeningNoShow ? 'Reabrindo...' : 'Reabrir falta e concluir'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {shouldShowMaintenanceStartPrompt && (
        <div className="fixed inset-0 z-[205] flex items-end justify-center bg-slate-950/30 px-3 pb-4 backdrop-blur-[2px] sm:items-center sm:pb-0" data-aba-maintenance-start-prompt>
          <div className="w-full max-w-md rounded-[24px] border border-amber-100 bg-white p-5 shadow-2xl shadow-slate-950/20">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                <RotateCcw size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">Sondagens previstas para hoje</h3>
                <p className="mt-1 text-sm text-slate-500">Há {maintenanceProbePendingCount} sondagem(ns) disponível(is). Elas não serão ativadas automaticamente.</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button type="button" onClick={acceptDueMaintenanceProbesForSession} className="min-h-[44px] rounded-2xl bg-[#7a32fc] px-3 text-xs font-semibold text-white shadow-sm">Adicionar</button>
              <button type="button" onClick={reviewDueMaintenanceProbesForSession} className="min-h-[44px] rounded-2xl border border-purple-100 bg-purple-50 px-3 text-xs font-semibold text-[#7a32fc]">Revisar</button>
              <button type="button" onClick={skipDueMaintenanceProbesForSession} className="min-h-[44px] rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-500">Agora não</button>
            </div>
            <p className="mt-3 text-[11px] text-slate-400">“Agora não” mantém as sondagens pendentes. Não cancela o planejamento clínico.</p>
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
