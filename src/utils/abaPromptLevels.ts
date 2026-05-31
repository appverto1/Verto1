export type AbaPromptLevel = {
  key: string;
  label: string;
  isIndependent: boolean;
  isError: boolean;
};

export const ABA_PROMPTED_PROMPT_KEYS = ['visual', 'gestural', 'verbal', 'model', 'partial_physical', 'full_physical'] as const;
export type AbaPromptedPromptKey = typeof ABA_PROMPTED_PROMPT_KEYS[number];

const PROMPTED_LEVEL: AbaPromptLevel = {
  key: 'prompted',
  label: 'Com ajuda',
  isIndependent: false,
  isError: false
};

export const ABA_PROMPT_LEVEL_OPTIONS: AbaPromptLevel[] = [
  { key: 'independent', label: 'Independente', isIndependent: true, isError: false },
  { key: 'visual', label: 'Visual', isIndependent: false, isError: false },
  { key: 'gestural', label: 'Gestual', isIndependent: false, isError: false },
  { key: 'verbal', label: 'Verbal', isIndependent: false, isError: false },
  { key: 'model', label: 'Modelo', isIndependent: false, isError: false },
  { key: 'partial_physical', label: 'Física parcial', isIndependent: false, isError: false },
  { key: 'full_physical', label: 'Física total', isIndependent: false, isError: false },
  { key: 'other', label: 'Outro', isIndependent: false, isError: false },
  { key: 'error', label: 'Erro / sem resposta', isIndependent: false, isError: true }
];

export const ABA_PROMPTED_PROMPT_OPTIONS = ABA_PROMPT_LEVEL_OPTIONS.filter((level) => (
  ABA_PROMPTED_PROMPT_KEYS.includes(level.key as AbaPromptedPromptKey)
));

const ABA_PROMPT_LEVELS: AbaPromptLevel[] = [
  ...ABA_PROMPT_LEVEL_OPTIONS,
  PROMPTED_LEVEL
];

const PROMPT_BY_KEY = new Map(ABA_PROMPT_LEVELS.map((level) => [level.key, level]));

const normalizePromptToken = (value: unknown) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
};

const compactPromptToken = (value: unknown) => normalizePromptToken(value).replace(/_/g, '');

const PROMPT_ALIASES: Record<string, string> = {
  independent: 'independent',
  independente: 'independent',
  sem_prompt: 'independent',
  sem_dica: 'independent',
  no_prompt: 'independent',
  visual: 'visual',
  gestural: 'gestural',
  gestual: 'gestural',
  gesture: 'gestural',
  verbal: 'verbal',
  oral: 'verbal',
  model: 'model',
  modelo: 'model',
  modeled: 'model',
  partial_physical: 'partial_physical',
  physical_partial: 'partial_physical',
  fisica_parcial: 'partial_physical',
  ajuda_fisica_parcial: 'partial_physical',
  full_physical: 'full_physical',
  physical_full: 'full_physical',
  fisica_total: 'full_physical',
  ajuda_fisica_total: 'full_physical',
  other: 'other',
  outro: 'other',
  outra: 'other',
  outros: 'other',
  prompted: 'prompted',
  prompt: 'prompted',
  com_ajuda: 'prompted',
  ajuda: 'prompted',
  error: 'error',
  erro: 'error',
  erro_sem_resposta: 'error',
  sem_resposta: 'error',
  incorreto: 'error',
  incorrect: 'error'
};

const PROMPT_COMPACT_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(PROMPT_ALIASES).map(([alias, key]) => [alias.replace(/_/g, ''), key])
);

const toFiniteNumber = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

export function getAbaPromptLevel(value: unknown): AbaPromptLevel | null {
  const normalized = normalizePromptToken(value);
  if (!normalized) return null;
  const key = PROMPT_ALIASES[normalized] || PROMPT_COMPACT_ALIASES[compactPromptToken(value)] || normalized;
  return PROMPT_BY_KEY.get(key) || null;
}

export function resolveAbaPromptLevel(input: {
  promptLevelKey?: unknown;
  promptLevelName?: unknown;
  score?: unknown;
  maxScore?: unknown;
  correct?: unknown;
  independent?: unknown;
} = {}): AbaPromptLevel {
  const explicitLevel = getAbaPromptLevel(input.promptLevelKey) || getAbaPromptLevel(input.promptLevelName);
  if (explicitLevel) return explicitLevel;

  if (input.independent === true) return PROMPT_BY_KEY.get('independent')!;

  const score = toFiniteNumber(input.score);
  const maxScore = toFiniteNumber(input.maxScore);
  const correct = typeof input.correct === 'boolean'
    ? input.correct
    : score !== null && maxScore !== null
      ? score >= maxScore
      : undefined;

  if (score !== null && score > 0 && (maxScore === null || score < maxScore)) return PROMPTED_LEVEL;
  if (correct === true || (score !== null && maxScore !== null && score >= maxScore)) return PROMPT_BY_KEY.get('independent')!;
  if (correct === false || score === 0) return PROMPT_BY_KEY.get('error')!;
  return PROMPT_BY_KEY.get('independent')!;
}

export function getAbaPromptLabel(value: unknown, fallback = 'Com ajuda') {
  return getAbaPromptLevel(value)?.label || fallback;
}
