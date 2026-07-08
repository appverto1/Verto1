export type AbaPromptLevel = {
  key: string;
  label: string;
  isIndependent: boolean;
  isError: boolean;
};

export type AbaPromptTypeConfig = {
  id?: string | null;
  key: string;
  name: string;
  label: string;
  category: string;
  independenceScore: number;
  intrusivenessOrder: number;
  countsAsIndependent: boolean;
  showInSession: boolean;
  active: boolean;
  description?: string | null;
  isSystemDefault?: boolean;
};

export type ResolvedAbaPromptInfo = {
  promptTypeId?: string | null;
  key: string;
  label: string;
  category?: string | null;
  independenceScore: number | null;
  intrusivenessOrder?: number | null;
  countsAsIndependent: boolean;
  isIndependent: boolean;
  isError: boolean;
  hasScoreSnapshot: boolean;
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

export const ABA_DEFAULT_PROMPT_TYPES: AbaPromptTypeConfig[] = [
  {
    key: 'independent',
    name: 'Independente',
    label: 'Independente',
    category: 'Independente',
    independenceScore: 100,
    intrusivenessOrder: 0,
    countsAsIndependent: true,
    showInSession: true,
    active: true,
    description: 'Resposta sem ajuda.',
    isSystemDefault: true
  },
  {
    key: 'visual_partial',
    name: 'Visual parcial',
    label: 'Visual parcial',
    category: 'Visual',
    independenceScore: 80,
    intrusivenessOrder: 1,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Dica visual parcial sem entregar a resposta completa.',
    isSystemDefault: true
  },
  {
    key: 'visual_total',
    name: 'Visual total',
    label: 'Visual total',
    category: 'Visual',
    independenceScore: 60,
    intrusivenessOrder: 2,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Ajuda visual completa.',
    isSystemDefault: true
  },
  {
    key: 'gestural',
    name: 'Gestual',
    label: 'Gestual',
    category: 'Gestual',
    independenceScore: 70,
    intrusivenessOrder: 3,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Gestos, apontamentos ou indicação corporal.',
    isSystemDefault: true
  },
  {
    key: 'verbal_partial',
    name: 'Verbal parcial',
    label: 'Verbal parcial',
    category: 'Verbal',
    independenceScore: 60,
    intrusivenessOrder: 4,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Dica verbal parcial.',
    isSystemDefault: true
  },
  {
    key: 'verbal_total',
    name: 'Verbal total',
    label: 'Verbal total',
    category: 'Verbal',
    independenceScore: 40,
    intrusivenessOrder: 5,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Dica verbal completa.',
    isSystemDefault: true
  },
  {
    key: 'model',
    name: 'Modelo',
    label: 'Modelo',
    category: 'Modelo',
    independenceScore: 50,
    intrusivenessOrder: 6,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Modelo demonstrado pelo terapeuta.',
    isSystemDefault: true
  },
  {
    key: 'partial_physical',
    name: 'Física parcial',
    label: 'Física parcial',
    category: 'Física',
    independenceScore: 30,
    intrusivenessOrder: 7,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Ajuda física parcial.',
    isSystemDefault: true
  },
  {
    key: 'full_physical',
    name: 'Física total',
    label: 'Física total',
    category: 'Física',
    independenceScore: 0,
    intrusivenessOrder: 8,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Ajuda física total.',
    isSystemDefault: true
  },
  {
    key: 'error_block',
    name: 'Bloqueio de erro',
    label: 'Bloqueio de erro',
    category: 'Bloqueio',
    independenceScore: 0,
    intrusivenessOrder: 9,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Bloqueio preventivo ou correção segura do erro.',
    isSystemDefault: true
  },
  {
    key: 'positional_cue',
    name: 'Dica posicional',
    label: 'Dica posicional',
    category: 'Posicional',
    independenceScore: 70,
    intrusivenessOrder: 10,
    countsAsIndependent: false,
    showInSession: true,
    active: true,
    description: 'Organização posicional dos estímulos para favorecer resposta.',
    isSystemDefault: true
  }
];

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
  visual_parcial: 'visual_partial',
  visualpartial: 'visual_partial',
  visual_partial: 'visual_partial',
  visual_total: 'visual_total',
  visualtotal: 'visual_total',
  gestural: 'gestural',
  gestual: 'gestural',
  gesture: 'gestural',
  verbal: 'verbal',
  verbal_parcial: 'verbal_partial',
  verbalpartial: 'verbal_partial',
  verbal_partial: 'verbal_partial',
  verbal_total: 'verbal_total',
  verbaltotal: 'verbal_total',
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
  incorrect: 'error',
  bloqueio_de_erro: 'error_block',
  bloqueio_erro: 'error_block',
  error_block: 'error_block',
  dica_posicional: 'positional_cue',
  positional_cue: 'positional_cue'
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

const clampScore = (value: unknown, fallback = 0) => {
  const numberValue = toFiniteNumber(value);
  if (numberValue === null) return fallback;
  return Math.max(0, Math.min(100, Math.round(numberValue * 100) / 100));
};

const readPromptValue = (input: any, ...keys: string[]) => {
  for (const key of keys) {
    if (input?.[key] !== undefined && input?.[key] !== null && input?.[key] !== '') return input[key];
  }
  const rawPayload = input?.raw_payload || input?.rawPayload || {};
  for (const key of keys) {
    if (rawPayload?.[key] !== undefined && rawPayload?.[key] !== null && rawPayload?.[key] !== '') return rawPayload[key];
  }
  return undefined;
};

const promptTypeKeyFrom = (row: any) => {
  const rawKey = readPromptValue(row, 'key', 'prompt_key', 'promptKey', 'prompt_type_key', 'promptTypeKey');
  const fallbackName = readPromptValue(row, 'name', 'label', 'prompt_type_name_snapshot', 'promptTypeNameSnapshot', 'prompt_level_name', 'promptLevelName');
  return normalizePromptToken(rawKey || fallbackName);
};

export function normalizeAbaPromptTypeConfig(rows?: any[] | null): AbaPromptTypeConfig[] {
  const sourceRows = Array.isArray(rows) && rows.length > 0
    ? [...ABA_DEFAULT_PROMPT_TYPES, ...rows]
    : ABA_DEFAULT_PROMPT_TYPES;
  const byKey = new Map<string, AbaPromptTypeConfig>();
  sourceRows.forEach((row, index) => {
    const key = promptTypeKeyFrom(row) || `prompt_${index + 1}`;
    const name = String(readPromptValue(row, 'name', 'label', 'prompt_type_name_snapshot', 'promptTypeNameSnapshot') || key).trim();
    const category = String(readPromptValue(row, 'category', 'prompt_category_snapshot', 'promptCategorySnapshot') || 'Geral').trim();
    const promptType: AbaPromptTypeConfig = {
      id: readPromptValue(row, 'id', 'prompt_type_id', 'promptTypeId') || null,
      key,
      name,
      label: String(readPromptValue(row, 'label') || name).trim(),
      category,
      independenceScore: clampScore(readPromptValue(row, 'independence_score', 'independenceScore', 'prompt_independence_score_snapshot', 'promptIndependenceScoreSnapshot'), 0),
      intrusivenessOrder: Math.max(0, Math.round(Number(readPromptValue(row, 'intrusiveness_order', 'intrusivenessOrder', 'prompt_intrusiveness_order_snapshot', 'promptIntrusivenessOrderSnapshot') ?? index))),
      countsAsIndependent: Boolean(readPromptValue(row, 'counts_as_independent', 'countsAsIndependent', 'isIndependent')),
      showInSession: readPromptValue(row, 'show_in_session', 'showInSession') !== false,
      active: readPromptValue(row, 'active') !== false,
      description: readPromptValue(row, 'description') || null,
      isSystemDefault: Boolean(readPromptValue(row, 'is_system_default', 'isSystemDefault'))
    };
    byKey.set(key, promptType);
  });
  return Array.from(byKey.values()).sort((a, b) => (
    a.intrusivenessOrder - b.intrusivenessOrder ||
    a.label.localeCompare(b.label, 'pt-BR')
  ));
}

export function resolveTrialPromptInfo(input: any = {}, promptTypes?: any[] | null): ResolvedAbaPromptInfo {
  const normalizedPromptTypes = normalizeAbaPromptTypeConfig(promptTypes);
  const promptTypeId = readPromptValue(input, 'prompt_type_id', 'promptTypeId') || null;
  const explicitScore = readPromptValue(input, 'prompt_independence_score_snapshot', 'promptIndependenceScoreSnapshot');
  const explicitName = readPromptValue(input, 'prompt_type_name_snapshot', 'promptTypeNameSnapshot');
  const explicitCategory = readPromptValue(input, 'prompt_category_snapshot', 'promptCategorySnapshot');
  const explicitOrder = readPromptValue(input, 'prompt_intrusiveness_order_snapshot', 'promptIntrusivenessOrderSnapshot');
  const keyInput = readPromptValue(input, 'prompt_type_key', 'promptTypeKey', 'prompt_level_key', 'promptLevelKey', 'promptLevel', 'prompt_level') || explicitName;
  const key = normalizePromptToken(keyInput);
  const matchedType = normalizedPromptTypes.find((promptType) => (
    (promptTypeId && promptType.id === promptTypeId) ||
    promptType.key === key ||
    normalizePromptToken(promptType.name) === key ||
    normalizePromptToken(promptType.label) === key
  ));
  const legacyLevel = resolveAbaPromptLevel({
    promptLevelKey: keyInput,
    promptLevelName: readPromptValue(input, 'prompt_level_name', 'promptLevelName') || explicitName,
    score: readPromptValue(input, 'response_score', 'responseScore', 'score'),
    maxScore: readPromptValue(input, 'max_score', 'maxScore'),
    correct: readPromptValue(input, 'correct', 'isCorrect'),
    independent: readPromptValue(input, 'independent', 'isIndependent')
  });
  const hasScoreSnapshot = toFiniteNumber(explicitScore) !== null;
  const resolvedLabel = String(explicitName || matchedType?.label || matchedType?.name || legacyLevel.label).trim();
  const resolvedScore = hasScoreSnapshot
    ? clampScore(explicitScore, 0)
    : matchedType
      ? matchedType.independenceScore
      : legacyLevel.isIndependent
        ? 100
        : legacyLevel.isError
          ? 0
          : null;
  return {
    promptTypeId: promptTypeId || matchedType?.id || null,
    key: matchedType?.key || key || legacyLevel.key,
    label: resolvedLabel,
    category: explicitCategory || matchedType?.category || null,
    independenceScore: resolvedScore,
    intrusivenessOrder: toFiniteNumber(explicitOrder) ?? matchedType?.intrusivenessOrder ?? null,
    countsAsIndependent: Boolean(matchedType?.countsAsIndependent || legacyLevel.isIndependent),
    isIndependent: Boolean(matchedType?.countsAsIndependent || legacyLevel.isIndependent),
    isError: legacyLevel.isError || matchedType?.key === 'error' || matchedType?.key === 'error_block',
    hasScoreSnapshot
  };
}

export function buildAbaPromptSnapshot(input: any = {}, promptTypes?: any[] | null) {
  const resolved = resolveTrialPromptInfo(input, promptTypes);
  return {
    promptTypeId: resolved.promptTypeId || null,
    prompt_type_id: resolved.promptTypeId || null,
    promptTypeNameSnapshot: resolved.label,
    prompt_type_name_snapshot: resolved.label,
    promptCategorySnapshot: resolved.category || null,
    prompt_category_snapshot: resolved.category || null,
    promptIndependenceScoreSnapshot: resolved.independenceScore,
    prompt_independence_score_snapshot: resolved.independenceScore,
    promptIntrusivenessOrderSnapshot: resolved.intrusivenessOrder ?? null,
    prompt_intrusiveness_order_snapshot: resolved.intrusivenessOrder ?? null
  };
}
