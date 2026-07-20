const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RescheduleRecommendation = 'best' | 'good' | 'attention' | 'unavailable';

export type ParsedRescheduleAssignment = {
  optionIndex: number;
  professionalId: string;
  roomId: string | null;
};

export type RescheduleOptionEvaluationInput = {
  index: number;
  availableAssignmentCount: number;
  directAssignmentAvailable: boolean;
  keepsOriginalProfessional: boolean;
  keepsOriginalRoom: boolean;
  financialContextCompatible: boolean;
  financialReviewRequired: boolean;
  competingRequestCount?: number;
  exactCompetitionCount?: number;
  distanceMinutes?: number;
  reasons?: string[];
};

export type RescheduleOptionEvaluation = RescheduleOptionEvaluationInput & {
  available: boolean;
  score: number;
  recommendation: RescheduleRecommendation;
  recommendationLabel: string;
  reasons: string[];
};

const recommendationLabels: Record<RescheduleRecommendation, string> = {
  best: 'Melhor opção',
  good: 'Boa opção',
  attention: 'Disponível com atenção',
  unavailable: 'Indisponível'
};

const uniqueReasons = (values: Array<string | null | undefined>) => Array.from(new Set(
  values.map((value) => String(value || '').trim()).filter(Boolean)
));

export function parseSelectedRescheduleOptionIndex(value: unknown, optionCount: number) {
  const normalizedCount = Number.isInteger(optionCount) ? optionCount : 0;
  const raw = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^\d+$/.test(raw)) {
    return { ok: false as const, error: 'Selecione uma das opções enviadas pelo responsável.' };
  }
  const index = Number(raw);
  if (!Number.isSafeInteger(index) || index < 0 || index >= normalizedCount) {
    return { ok: false as const, error: 'A opção selecionada não pertence a esta solicitação.' };
  }
  return { ok: true as const, index };
}

export function buildRescheduleAssignmentId(
  optionIndex: number,
  professionalId: string,
  roomId?: string | null
) {
  if (!Number.isSafeInteger(optionIndex) || optionIndex < 0 || !UUID_PATTERN.test(professionalId)) return '';
  const normalizedRoomId = String(roomId || '').trim();
  if (normalizedRoomId && !UUID_PATTERN.test(normalizedRoomId)) return '';
  return `${optionIndex}:${professionalId}:${normalizedRoomId || 'none'}`;
}

export function parseRescheduleAssignmentId(value: unknown, expectedOptionIndex?: number) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const parts = raw.split(':');
  if (!raw || parts.length !== 3 || !/^\d+$/.test(parts[0])) {
    return { ok: false as const, error: 'A configuração escolhida para a remarcação é inválida.' };
  }
  const optionIndex = Number(parts[0]);
  const professionalId = parts[1].trim();
  const rawRoomId = parts[2].trim().toLowerCase();
  const roomId = ['none', 'null', ''].includes(rawRoomId) ? null : parts[2].trim();
  if (!Number.isSafeInteger(optionIndex) || optionIndex < 0) {
    return { ok: false as const, error: 'A opção vinculada à configuração é inválida.' };
  }
  if (expectedOptionIndex !== undefined && optionIndex !== expectedOptionIndex) {
    return { ok: false as const, error: 'A configuração escolhida pertence a outra opção de horário.' };
  }
  if (!UUID_PATTERN.test(professionalId)) {
    return { ok: false as const, error: 'O profissional escolhido não é válido para esta remarcação.' };
  }
  if (roomId && !UUID_PATTERN.test(roomId)) {
    return { ok: false as const, error: 'A sala escolhida não é válida para esta remarcação.' };
  }
  return {
    ok: true as const,
    assignment: { optionIndex, professionalId, roomId } satisfies ParsedRescheduleAssignment
  };
}

function evaluateRescheduleOption(input: RescheduleOptionEvaluationInput): RescheduleOptionEvaluation {
  const available = input.availableAssignmentCount > 0;
  if (!available) {
    const reasons = uniqueReasons([
      ...(input.reasons || []),
      'Não existe uma combinação livre de profissional e sala para este horário.'
    ]);
    return {
      ...input,
      available: false,
      score: 0,
      recommendation: 'unavailable',
      recommendationLabel: recommendationLabels.unavailable,
      reasons
    };
  }

  const competingRequestCount = Math.max(0, Math.round(Number(input.competingRequestCount || 0)));
  const exactCompetitionCount = Math.max(0, Math.round(Number(input.exactCompetitionCount || 0)));
  const distancePenalty = Math.min(20, Math.floor(Math.max(0, Number(input.distanceMinutes || 0)) / (24 * 60)));
  const requiresAttention =
    !input.directAssignmentAvailable ||
    !input.keepsOriginalProfessional ||
    !input.keepsOriginalRoom ||
    input.financialReviewRequired ||
    !input.financialContextCompatible ||
    competingRequestCount > 0;
  const reasons = uniqueReasons([
    ...(input.reasons || []),
    !input.keepsOriginalProfessional ? 'Será necessário trocar o profissional responsável.' : null,
    !input.keepsOriginalRoom ? 'A sala original não está livre; escolha uma alternativa compatível.' : null,
    input.financialReviewRequired || !input.financialContextCompatible
      ? 'O contexto financeiro precisa ser revisado para a nova data.'
      : null,
    competingRequestCount > 0
      ? `${competingRequestCount} outra${competingRequestCount === 1 ? '' : 's'} solicitação${competingRequestCount === 1 ? '' : 'ões'} disputa${competingRequestCount === 1 ? '' : 'm'} recursos neste horário.`
      : null
  ]);
  const score = Math.max(1, 100
    - (!input.directAssignmentAvailable ? 15 : 0)
    - (!input.keepsOriginalProfessional ? 20 : 0)
    - (!input.keepsOriginalRoom ? 10 : 0)
    - (input.financialReviewRequired || !input.financialContextCompatible ? 25 : 0)
    - Math.min(20, competingRequestCount * 6 + exactCompetitionCount * 4)
    - distancePenalty);
  const recommendation: RescheduleRecommendation = requiresAttention ? 'attention' : 'good';
  return {
    ...input,
    available,
    score,
    recommendation,
    recommendationLabel: recommendationLabels[recommendation],
    reasons: reasons.length > 0 ? reasons : ['Profissional, sala e contexto atual estão compatíveis.']
  };
}

export function rankRescheduleOptions(inputs: RescheduleOptionEvaluationInput[]) {
  const evaluated = inputs.map(evaluateRescheduleOption);
  const best = evaluated
    .filter((option) => option.available && option.recommendation === 'good')
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];
  return evaluated.map((option) => option.index === best?.index
    ? { ...option, recommendation: 'best' as const, recommendationLabel: recommendationLabels.best }
    : option);
}

export function createRescheduleIdempotencyKey(requestId: string, optionIndex: number) {
  const randomValue = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `reschedule:${requestId}:${optionIndex}:${randomValue}`;
}
