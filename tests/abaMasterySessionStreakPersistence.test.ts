import { evaluateTargetMastery } from '../src/utils/abaMasteryEngine';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const criterion = {
  minAccuracyPercent: 80,
  minTrialsPerSession: 1,
  requiredSessions: 3,
  sessionMode: 'consecutive' as const,
};

const previousEvaluations = [
  {
    id: 'eval-session-1',
    session_id: 'session-1',
    status: 'MET_TODAY',
    evaluated_at: '2026-08-17T12:00:00.000Z',
  },
];

const noDataYet = evaluateTargetMastery({
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  sessionId: 'session-2',
  targetId: 'target-1',
  targetName: 'Instrução de uma etapa',
  criteria: criterion,
  trials: [],
  previousEvaluations,
  evaluatedAt: '2026-08-18T12:00:00.000Z',
});

assert(noDataYet.status === 'INSUFFICIENT_DATA', 'sessão sem tentativa deve continuar aguardando dados');
assert(noDataYet.successfulSessions === 1, 'abrir uma nova sessão não pode apagar a sessão válida anterior');
assert(noDataYet.criterionProgressCount === 1, 'o progresso persistido deve continuar 1/3 antes da primeira tentativa da nova sessão');
assert(noDataYet.criterionProgressLabel.includes('1/3'), 'a UI deve receber 1/3 enquanto a sessão atual ainda não foi avaliada');

const successToday = evaluateTargetMastery({
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  sessionId: 'session-2',
  targetId: 'target-1',
  targetName: 'Instrução de uma etapa',
  criteria: criterion,
  trials: [{
    id: 'trial-success',
    session_id: 'session-2',
    target_id: 'target-1',
    target_name: 'Instrução de uma etapa',
    correct: true,
    independent: true,
    occurred_at: '2026-08-18T12:01:00.000Z',
  }],
  previousEvaluations,
  evaluatedAt: '2026-08-18T12:05:00.000Z',
});

assert(successToday.status === 'MET_TODAY', 'segunda sessão válida ainda não deve declarar maestria antes de 3/3');
assert(successToday.successfulSessions === 2, 'segunda sessão válida deve avançar de 1/3 para 2/3');
assert(successToday.criterionProgressLabel.includes('2/3'), 'o contador deve refletir 2/3 após nova sessão válida');

const failureToday = evaluateTargetMastery({
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  sessionId: 'session-2',
  targetId: 'target-1',
  targetName: 'Instrução de uma etapa',
  criteria: criterion,
  trials: [{
    id: 'trial-failure',
    session_id: 'session-2',
    target_id: 'target-1',
    target_name: 'Instrução de uma etapa',
    correct: false,
    independent: false,
    occurred_at: '2026-08-18T12:01:00.000Z',
  }],
  previousEvaluations,
  evaluatedAt: '2026-08-18T12:05:00.000Z',
});

assert(failureToday.status === 'NOT_MET', 'sessão suficiente abaixo do critério deve ser avaliada como não atingida');
assert(failureToday.successfulSessions === 0, 'falha real deve quebrar uma sequência consecutiva');
assert(failureToday.criterionProgressLabel.includes('0/3'), 'após falha real a sequência consecutiva deve reiniciar em 0/3');

const duplicatedPreviousSession = evaluateTargetMastery({
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  sessionId: 'session-2',
  targetId: 'target-1',
  targetName: 'Instrução de uma etapa',
  criteria: criterion,
  trials: [],
  previousEvaluations: [
    ...previousEvaluations,
    { ...previousEvaluations[0], id: 'eval-session-1-retry', evaluated_at: '2026-08-17T12:02:00.000Z' },
  ],
  evaluatedAt: '2026-08-18T12:00:00.000Z',
});

assert(duplicatedPreviousSession.successfulSessions === 1, 'retry/upsert da mesma sessão nunca pode contar a sessão duas vezes');

console.log('abaMasterySessionStreakPersistence.test.ts: ok');
