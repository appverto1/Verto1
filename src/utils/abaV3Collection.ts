export const ABA_V3_TRIAL_ACTION_KEYS = [
  'INDEPENDENT_CORRECT',
  'INDEPENDENT_INCORRECT',
  'NO_RESPONSE',
  'PROMPTED_CORRECT'
] as const;

export type AbaV3TrialActionKey = typeof ABA_V3_TRIAL_ACTION_KEYS[number];

export type AbaV3TrialStep = {
  sequence_no: number;
  step_type: 'RESPONSE' | 'PROMPT';
  opportunity_role: 'PRIMARY_INDEPENDENT' | 'SUPPORT';
  outcome: 'CORRECT' | 'INCORRECT' | 'NO_RESPONSE';
  prompt_key: string | null;
};

const actionKeySet = new Set<string>(ABA_V3_TRIAL_ACTION_KEYS);

export function normalizeAbaV3TrialActionKey(value: unknown): AbaV3TrialActionKey | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return actionKeySet.has(normalized) ? normalized as AbaV3TrialActionKey : null;
}

export function buildAbaV3TrialSteps(actionKey: AbaV3TrialActionKey, promptKey?: unknown): AbaV3TrialStep[] {
  if (actionKey === 'PROMPTED_CORRECT') {
    const safePromptKey = String(promptKey ?? '').trim();
    if (!safePromptKey) throw new Error('ABA_V3_PROMPT_REQUIRED');
    return [{
      sequence_no: 1,
      step_type: 'PROMPT',
      opportunity_role: 'SUPPORT',
      outcome: 'CORRECT',
      prompt_key: safePromptKey
    }];
  }

  const outcome = actionKey === 'INDEPENDENT_CORRECT'
    ? 'CORRECT'
    : actionKey === 'INDEPENDENT_INCORRECT'
      ? 'INCORRECT'
      : 'NO_RESPONSE';

  return [{
    sequence_no: 1,
    step_type: 'RESPONSE',
    opportunity_role: 'PRIMARY_INDEPENDENT',
    outcome,
    prompt_key: null
  }];
}

export function mapAbaV3TrialType(value: unknown): 'TEACHING' | 'PROBE' | 'BASELINE_PROBE' | 'MAINTENANCE_PROBE' | 'GENERALIZATION' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['dtt', 'net', 'teaching', 'discrete_trial', 'natural_environment', 'natural_environment_training'].includes(normalized)) return 'TEACHING';
  if (['cold_probe', 'probe'].includes(normalized)) return 'PROBE';
  if (normalized === 'baseline_probe') return 'BASELINE_PROBE';
  if (normalized === 'maintenance_probe') return 'MAINTENANCE_PROBE';
  if (normalized === 'generalization') return 'GENERALIZATION';
  return null;
}

export function abaV3ActionDisplayLabel(actionKey: AbaV3TrialActionKey): string {
  if (actionKey === 'INDEPENDENT_CORRECT') return 'Independente · correta';
  if (actionKey === 'INDEPENDENT_INCORRECT') return 'Resposta incorreta';
  if (actionKey === 'NO_RESPONSE') return 'Sem resposta';
  return 'Com ajuda · correta';
}
