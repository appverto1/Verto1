export type ClinicalToastVariant = 'success' | 'warning' | 'error' | 'info';

export type ClinicalActionToast = {
  id?: string;
  variant: ClinicalToastVariant;
  title: string;
  subtitle?: string;
};

type TrialToastInput = {
  action: 'trial';
  outcome: 'independent' | 'prompted' | 'error';
  collectionLabel: string;
  promptLabel?: string;
  score: number;
};

type FrequencyToastInput = {
  action: 'frequency';
  behaviorName: string;
  countDelta?: number;
  location?: string;
  severity?: number | null;
};

type DurationToastInput = {
  action: 'duration_start' | 'duration_end';
  behaviorName: string;
  location?: string;
  severity?: number | null;
  durationSeconds?: number | null;
};

type IntervalToastInput = {
  action: 'interval';
  behaviorName: string;
  intervalNumber: number;
  occurred: boolean;
};

type SimpleToastInput = {
  action: 'abc' | 'edit' | 'session_end';
};

export type BuildClinicalActionToastInput =
  | TrialToastInput
  | FrequencyToastInput
  | DurationToastInput
  | IntervalToastInput
  | SimpleToastInput;

export const formatClinicalDuration = (seconds: number | null | undefined) => {
  const safeSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

export const formatClinicalScore = (score: number) => {
  if (Number(score) === 1) return '1.0';
  if (Number(score) === 0.5) return '0.5';
  return '0';
};

const joinPresent = (items: Array<string | number | null | undefined>) =>
  items.filter((item) => item !== undefined && item !== null && String(item).trim() !== '').join(' • ');

export const buildClinicalActionToast = (input: BuildClinicalActionToastInput): ClinicalActionToast => {
  if (input.action === 'frequency') {
    const count = Number(input.countDelta || 1);
    return {
      variant: 'success',
      title: `${input.behaviorName} registrada`,
      subtitle: joinPresent([
        `${count > 0 ? '+' : ''}${count} ocorrência`,
        input.location,
        input.severity ? `severidade ${input.severity}` : null
      ])
    };
  }

  if (input.action === 'duration_start') {
    return {
      variant: 'success',
      title: `${input.behaviorName} iniciado`,
      subtitle: joinPresent([
        input.location,
        input.severity ? `severidade ${input.severity}` : null
      ])
    };
  }

  if (input.action === 'duration_end') {
    return {
      variant: 'success',
      title: `${input.behaviorName} encerrado`,
      subtitle: `Duração: ${formatClinicalDuration(input.durationSeconds)}`
    };
  }

  if (input.action === 'trial') {
    const scoreText = formatClinicalScore(input.score);
    if (input.outcome === 'independent') {
      return {
        variant: 'success',
        title: 'Tentativa registrada',
        subtitle: `Independente • ${input.collectionLabel} • ${scoreText}`
      };
    }
    if (input.outcome === 'prompted') {
      return {
        variant: 'success',
        title: 'Tentativa registrada',
        subtitle: `Com ajuda ${String(input.promptLabel || '').toLowerCase()} • ${input.collectionLabel} • ${scoreText}`
      };
    }
    return {
      variant: 'success',
      title: 'Tentativa registrada',
      subtitle: `Erro / sem resposta • ${input.collectionLabel} • ${scoreText}`
    };
  }

  if (input.action === 'interval') {
    return {
      variant: 'success',
      title: 'Intervalo registrado',
      subtitle: `${input.behaviorName} • intervalo ${input.intervalNumber}: ${input.occurred ? 'SIM' : 'NÃO'}`
    };
  }

  if (input.action === 'abc') {
    return {
      variant: 'success',
      title: 'ABC salvo',
      subtitle: 'Antecedente, comportamento e consequência registrados'
    };
  }

  if (input.action === 'session_end') {
    return {
      variant: 'success',
      title: 'Sessão encerrada',
      subtitle: 'Resumo clínico salvo para revisão'
    };
  }

  return {
    variant: 'success',
    title: 'Registro atualizado',
    subtitle: 'Complemento salvo sem alterar o horário original'
  };
};

export const buildClinicalSaveErrorToast = (): ClinicalActionToast => ({
  variant: 'error',
  title: 'Não foi possível salvar',
  subtitle: 'Tente novamente. Nenhum dado foi perdido.'
});

export const buildClinicalOfflineToast = (): ClinicalActionToast => ({
  variant: 'warning',
  title: 'Salvo no dispositivo',
  subtitle: 'Será sincronizado quando houver conexão.'
});

export class ClinicalActionDebounceGate {
  private locks = new Map<string, number>();

  acquire(key: string, debounceMs: number, now = Date.now()) {
    const lockedUntil = this.locks.get(key) || 0;
    if (lockedUntil === Number.POSITIVE_INFINITY || lockedUntil > now) return false;
    this.locks.set(key, debounceMs <= 0 ? Number.POSITIVE_INFINITY : now + debounceMs);
    return true;
  }

  release(key: string) {
    this.locks.delete(key);
  }

  isLocked(key: string, now = Date.now()) {
    const lockedUntil = this.locks.get(key) || 0;
    return lockedUntil === Number.POSITIVE_INFINITY || lockedUntil > now;
  }
}
