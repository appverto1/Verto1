import { getAbaPromptLabel } from './abaPromptLevels';

export type AbaTrialOutcome = 'independent' | 'prompted' | 'error' | string | null | undefined;

const COLLECTION_LABELS: Record<string, string> = {
  dtt: 'DTT',
  net: 'NET',
  cold_probe: 'Cold Probe',
  baseline_probe: 'Baseline Probe',
  maintenance_probe: 'Maintenance Probe'
};

const HISTORY_PREFIX_LABELS: Record<string, string> = {
  dtt: 'DTT',
  net: 'NET',
  cold_probe: 'Cold Probe',
  baseline_probe: 'Baseline Probe',
  maintenance_probe: 'Maintenance Probe'
};

const OUTCOME_LABELS: Record<string, string> = {
  independent: 'Independente',
  prompted: 'Com ajuda',
  error: 'Erro'
};

export const normalizeAbaCollectionType = (value: unknown, fallback = 'dtt') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
};

const humanizeUnknownCollectionType = (value: string) => {
  return value
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'DTT';
};

export const getAbaCollectionLabel = (value: unknown, fallback = 'DTT') => {
  const normalized = normalizeAbaCollectionType(value, '');
  if (!normalized) return fallback;
  return COLLECTION_LABELS[normalized] || humanizeUnknownCollectionType(normalized);
};

export const isMaintenanceProbeCollection = (value: unknown) => {
  return normalizeAbaCollectionType(value) === 'maintenance_probe';
};

export const isDuplicateRiskTrainingCollection = (value: unknown) => {
  return ['dtt', 'net', 'cold_probe'].includes(normalizeAbaCollectionType(value));
};

export const getAbaTrialOutcomeLabel = (outcome: AbaTrialOutcome) => {
  const normalized = String(outcome || '').trim().toLowerCase();
  return OUTCOME_LABELS[normalized] || 'Tentativa';
};

export const formatAbaScoreLabel = (score: unknown) => {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return '0';
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
};

export const formatAbaTrialHistoryLabel = ({
  collectionType,
  outcome,
  score,
  promptLevelKey,
  promptLevelName,
  promptLabel
}: {
  collectionType: unknown;
  outcome: AbaTrialOutcome;
  score: unknown;
  promptLevelKey?: unknown;
  promptLevelName?: unknown;
  promptLabel?: unknown;
}) => {
  const normalized = normalizeAbaCollectionType(collectionType);
  const prefix = HISTORY_PREFIX_LABELS[normalized] || getAbaCollectionLabel(normalized);
  const normalizedOutcome = String(outcome || '').trim().toLowerCase();
  const resolvedPromptLabel = normalizedOutcome === 'prompted'
    ? getAbaPromptLabel(promptLevelKey || promptLevelName || promptLabel, '')
    : '';
  const outcomeLabel = normalizedOutcome === 'prompted' && resolvedPromptLabel && resolvedPromptLabel !== 'Com ajuda'
    ? `Ajuda ${resolvedPromptLabel.toLowerCase()}`
    : getAbaTrialOutcomeLabel(outcome);
  return `${prefix} · ${outcomeLabel} · ${formatAbaScoreLabel(score)}`;
};
