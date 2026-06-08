import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  abaMasteryCriterionSourceLabel,
  buildTargetStatusAuditLog,
  evaluateTargetMastery,
  formatAbaMasteryCriterion,
  normalizeAbaMasteryCriterion
} from '../src/utils/abaMasteryEngine.ts';

const root = process.cwd();
const migrationSql = readFileSync(join(root, 'supabase/migrations/20260525143000_aba_mastery_criteria_engine.sql'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const baseCriteria = {
  id: 'criteria-1',
  organization_id: 'clinic-1',
  target_id: 'target-1',
  name: '80/80 por dias',
  min_accuracy_percent: 80,
  min_independence_percent: 80,
  min_trials_per_session: 2,
  min_consecutive_days: 2,
  require_first_trial_independent: false,
  cold_probe_only: false,
  min_distinct_therapists: 1,
  maintenance_required: false,
  is_active: true
};

const trial = (overrides: any = {}) => ({
  id: overrides.id || crypto.randomUUID(),
  target_id: 'target-1',
  target_name: 'Nomeia cores',
  session_id: 'session-1',
  patient_id: 'patient-1',
  therapist_id: overrides.therapist_id || 'therapist-1',
  trialOutcome: overrides.trialOutcome || 'independent',
  collection_type: overrides.collection_type || 'dtt',
  correct: overrides.correct ?? overrides.trialOutcome !== 'error',
  independent: overrides.independent ?? overrides.trialOutcome !== 'prompted',
  occurred_at: overrides.occurred_at || '2026-05-25T12:00:00.000Z',
  ...overrides
});

const evaluate = (overrides: any = {}) => evaluateTargetMastery({
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  targetId: 'target-1',
  targetName: 'Nomeia cores',
  sessionId: 'session-1',
  criteria: baseCriteria,
  trials: [trial({ id: 't1' }), trial({ id: 't2', occurred_at: '2026-05-25T12:01:00.000Z' })],
  evaluatedAt: '2026-05-25T13:00:00.000Z',
  previousEvaluations: [],
  ...overrides
});

test('sem criterio ativo retorna INSUFFICIENT_DATA', () => {
  const result = evaluate({ criteria: null, trials: [trial()] });
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.reasons[0].code, 'NO_CRITERIA');
});

test('poucas tentativas retorna INSUFFICIENT_DATA', () => {
  const result = evaluate({ trials: [trial()] });
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.reasons.some((reason) => reason.code === 'MIN_TRIALS_NOT_MET'), true);
});

test('acuracia abaixo do criterio retorna NOT_MET', () => {
  const result = evaluate({
    criteria: { ...baseCriteria, min_accuracy_percent: 80, min_independence_percent: 0 },
    trials: [trial({ id: 't1' }), trial({ id: 't2', trialOutcome: 'error', correct: false, independent: false })]
  });
  assert.equal(result.status, 'NOT_MET');
  assert.equal(result.accuracyPercent, 50);
  assert.equal(result.reasons.some((reason) => reason.code === 'ACCURACY_BELOW_CRITERION'), true);
});

test('independencia abaixo do criterio retorna NOT_MET', () => {
  const result = evaluate({
    criteria: { ...baseCriteria, min_accuracy_percent: 100, min_independence_percent: 80 },
    trials: [trial({ id: 't1' }), trial({ id: 't2', trialOutcome: 'prompted', independent: false })]
  });
  assert.equal(result.status, 'NOT_MET');
  assert.equal(result.independencePercent, 50);
  assert.equal(result.reasons.some((reason) => reason.code === 'INDEPENDENCE_BELOW_CRITERION'), true);
});

test('criterio atingido na sessao retorna MET_TODAY', () => {
  const result = evaluate();
  assert.equal(result.status, 'MET_TODAY');
  assert.equal(result.accuracyPercent, 100);
  assert.equal(result.independencePercent, 100);
  assert.equal(result.consecutiveSuccessfulDays, 1);
});

test('dias consecutivos suficientes retorna READY_FOR_REVIEW', () => {
  const result = evaluate({
    criteria: { ...baseCriteria, min_consecutive_days: 3 },
    previousEvaluations: [
      { status: 'MET_TODAY', evaluated_at: '2026-05-24T13:00:00.000Z', therapist_id: 'therapist-1' },
      { status: 'READY_FOR_REVIEW', evaluated_at: '2026-05-23T13:00:00.000Z', therapist_id: 'therapist-1' }
    ]
  });
  assert.equal(result.status, 'READY_FOR_REVIEW');
  assert.equal(result.consecutiveSuccessfulDays, 3);
});

test('meta_sucessos vira acertos independentes consecutivos e nao dias obrigatorios', () => {
  const criteria = {
    ...baseCriteria,
    name: '2 acertos independentes consecutivos',
    meta_sucessos: 2,
    min_trials_per_session: undefined,
    min_consecutive_days: undefined
  };
  const normalized = normalizeAbaMasteryCriterion(criteria);
  assert.equal(normalized?.requiredIndependentCorrectTrials, null);
  assert.equal(normalized?.requiredConsecutiveIndependentCorrectTrials, 2);
  assert.equal(normalized?.masteryCriterionMode, 'consecutive_independent');
  assert.equal(normalized?.minTrialsPerSession, 2);
  assert.equal(normalized?.minConsecutiveDays, 1);
  assert.doesNotMatch(formatAbaMasteryCriterion(normalized), /2 dia/);

  const result = evaluate({ criteria });
  assert.equal(result.status, 'READY_FOR_REVIEW');
  assert.equal(result.suggestedPhase, 'maintenance');
  assert.equal(result.criterionProgressCount, 2);
  assert.equal(result.criterionRequiredCount, 2);
  assert.equal(result.consecutiveIndependentTrials, 2);
  assert.equal(result.criterionProgressKind, 'consecutive_independent');
  assert.match(result.criterionLabel, /2 acertos independentes consecutivos/);
  assert.match(result.performanceText, /2\/2 acertos independentes consecutivos/);
  assert.equal(result.reasons.some((reason) => reason.code === 'CONSECUTIVE_DAYS_PENDING'), false);
});

test('criterio proprio de 1 acerto independente conclui sem fallback 5 ou 80/80', () => {
  const criteria = {
    name: '1 acerto independente',
    source: 'skill',
    requiredIndependentCorrectTrials: 1,
    is_active: true
  };
  const normalized = normalizeAbaMasteryCriterion(criteria);
  assert.equal(normalized?.requiredIndependentCorrectTrials, 1);
  assert.equal(normalized?.minTrialsPerSession, 1);
  assert.equal(normalized?.minAccuracyPercent, null);
  assert.equal(normalized?.minIndependencePercent, null);
  assert.equal(formatAbaMasteryCriterion(normalized), '1 acerto independente');
  assert.doesNotMatch(formatAbaMasteryCriterion(normalized), /5|80%/);
  assert.equal(abaMasteryCriterionSourceLabel(normalized), 'Criterio da habilidade');

  const result = evaluate({
    criteria,
    trials: [trial({ id: 't1' })],
    previousEvaluations: []
  });
  assert.equal(result.status, 'READY_FOR_REVIEW');
  assert.equal(result.criterionProgressCount, 1);
  assert.equal(result.criterionRequiredCount, 1);
  assert.match(result.criterionProgressLabel, /1\/1 acertos independentes/);
  assert.equal(result.reasons.length, 0);
});

test('criterio vazio nao vira criterio padrao oculto', () => {
  const normalized = normalizeAbaMasteryCriterion({ name: 'sem campos', is_active: true });
  assert.equal(normalized, null);
  const result = evaluate({ criteria: { name: 'sem campos', is_active: true }, trials: [trial({ id: 't1' }), trial({ id: 't2' })] });
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.reasons[0].code, 'NO_CRITERIA');
  assert.equal(result.criterionLabel, 'Criterio nao configurado');
});

test('acerto com ajuda nao conta para criterio independente', () => {
  const result = evaluate({
    criteria: {
      ...baseCriteria,
      required_independent_correct_trials: 2,
      min_trials_per_session: 2,
      min_consecutive_days: 1
    },
    trials: [trial({ id: 't1' }), trial({ id: 't2', trialOutcome: 'prompted', independent: false })]
  });
  assert.equal(result.status, 'NOT_MET');
  assert.equal(result.criterionProgressCount, 1);
  assert.equal(result.reasons.some((reason) => reason.code === 'INDEPENDENT_CORRECT_TRIALS_NOT_MET'), true);
});

test('criterio consecutivo zera sequencia quando ha ajuda', () => {
  const criteria = {
    name: '5 independentes consecutivos',
    required_consecutive_independent_correct_trials: 5,
    min_trials_per_session: 5,
    is_active: true
  };
  const result = evaluate({
    criteria,
    trials: [
      trial({ id: 't1', occurred_at: '2026-05-25T12:00:00.000Z' }),
      trial({ id: 't2', occurred_at: '2026-05-25T12:01:00.000Z' }),
      trial({ id: 't3', occurred_at: '2026-05-25T12:02:00.000Z' }),
      trial({ id: 't4', occurred_at: '2026-05-25T12:03:00.000Z' }),
      trial({ id: 't5', trialOutcome: 'prompted', independent: false, occurred_at: '2026-05-25T12:04:00.000Z' })
    ]
  });
  assert.equal(result.independentTrials, 4);
  assert.equal(result.promptedTrials, 1);
  assert.equal(result.consecutiveIndependentTrials, 0);
  assert.equal(result.criterionProgressLabel, '0/5 acertos independentes consecutivos');
  assert.equal(result.sequenceBrokenByLastTrial, true);
  assert.equal(result.status, 'NOT_MET');
  assert.equal(result.reasons.some((reason) => reason.code === 'CONSECUTIVE_INDEPENDENT_CORRECT_TRIALS_NOT_MET'), true);
});

test('criterio consecutivo zera sequencia quando ha erro', () => {
  const criteria = {
    name: '5 independentes consecutivos',
    requiredConsecutiveIndependentCorrectTrials: 5,
    minTrialsPerSession: 5,
    is_active: true
  };
  const result = evaluate({
    criteria,
    trials: [
      trial({ id: 't1', occurred_at: '2026-05-25T12:00:00.000Z' }),
      trial({ id: 't2', occurred_at: '2026-05-25T12:01:00.000Z' }),
      trial({ id: 't3', occurred_at: '2026-05-25T12:02:00.000Z' }),
      trial({ id: 't4', occurred_at: '2026-05-25T12:03:00.000Z' }),
      trial({ id: 't5', trialOutcome: 'error', correct: false, independent: false, occurred_at: '2026-05-25T12:04:00.000Z' })
    ]
  });
  assert.equal(result.errorTrials, 1);
  assert.equal(result.consecutiveIndependentTrials, 0);
  assert.equal(result.criterionProgressLabel, '0/5 acertos independentes consecutivos');
  assert.equal(result.status, 'NOT_MET');
});

test('criterio total independente nao zera acumulado apos ajuda', () => {
  const criteria = {
    name: '5 independentes totais',
    requiredIndependentCorrectTrials: 5,
    minTrialsPerSession: 6,
    is_active: true
  };
  const result = evaluate({
    criteria,
    trials: [
      trial({ id: 't1', occurred_at: '2026-05-25T12:00:00.000Z' }),
      trial({ id: 't2', occurred_at: '2026-05-25T12:01:00.000Z' }),
      trial({ id: 't3', occurred_at: '2026-05-25T12:02:00.000Z' }),
      trial({ id: 't4', occurred_at: '2026-05-25T12:03:00.000Z' }),
      trial({ id: 't5', trialOutcome: 'prompted', independent: false, occurred_at: '2026-05-25T12:04:00.000Z' }),
      trial({ id: 't6', occurred_at: '2026-05-25T12:05:00.000Z' })
    ]
  });
  assert.equal(result.independentTrials, 5);
  assert.equal(result.consecutiveIndependentTrials, 1);
  assert.equal(result.criterionProgressKind, 'total_independent');
  assert.equal(result.criterionProgressLabel, '5/5 acertos independentes');
  assert.equal(result.status, 'READY_FOR_REVIEW');
});

test('tentativas de outro target nao entram na avaliacao da meta atual', () => {
  const result = evaluate({
    criteria: {
      ...baseCriteria,
      required_independent_correct_trials: 2,
      min_trials_per_session: 2,
      min_consecutive_days: 1
    },
    trials: [
      trial({ id: 't1' }),
      trial({ id: 't2', occurred_at: '2026-05-25T12:01:00.000Z' }),
      trial({ id: 'other-target', target_id: 'target-2', target_name: 'Outra meta', occurred_at: '2026-05-25T12:02:00.000Z' })
    ]
  });
  assert.equal(result.status, 'READY_FOR_REVIEW');
  assert.equal(result.totalTrials, 2);
  assert.equal(result.criterionProgressCount, 2);
});

test('cold_probe_only considera apenas Cold Probe', () => {
  const result = evaluate({
    criteria: { ...baseCriteria, cold_probe_only: true, min_trials_per_session: 1, min_consecutive_days: 1 },
    trials: [
      trial({ id: 'cold-1', collection_type: 'cold_probe' }),
      trial({ id: 'dtt-error', collection_type: 'dtt', trialOutcome: 'error', correct: false, independent: false })
    ]
  });
  assert.equal(result.totalTrials, 1);
  assert.equal(result.coldProbeTrialsCount, 1);
  assert.equal(result.accuracyPercent, 100);
});

test('require_first_trial_independent falha quando a primeira tentativa nao e independente', () => {
  const result = evaluate({
    criteria: { ...baseCriteria, require_first_trial_independent: true, min_accuracy_percent: 100, min_independence_percent: 50 },
    trials: [
      trial({ id: 't1', trialOutcome: 'prompted', independent: false, occurred_at: '2026-05-25T12:00:00.000Z' }),
      trial({ id: 't2', occurred_at: '2026-05-25T12:01:00.000Z' })
    ]
  });
  assert.equal(result.status, 'NOT_MET');
  assert.equal(result.firstTrialIndependent, false);
  assert.equal(result.reasons.some((reason) => reason.code === 'FIRST_TRIAL_NOT_INDEPENDENT'), true);
});

test('min_distinct_therapists pendente nao libera revisao', () => {
  const result = evaluate({
    criteria: { ...baseCriteria, min_consecutive_days: 1, min_distinct_therapists: 2 },
    trials: [trial({ id: 't1', therapist_id: 'therapist-1' }), trial({ id: 't2', therapist_id: 'therapist-1' })]
  });
  assert.equal(result.status, 'MET_TODAY');
  assert.equal(result.distinctTherapistsCount, 1);
  assert.equal(result.reasons.some((reason) => reason.code === 'DISTINCT_THERAPISTS_PENDING'), true);
});

test('READY_FOR_REVIEW nao altera target automaticamente', () => {
  const result = evaluate({
    criteria: { ...baseCriteria, min_consecutive_days: 1 }
  });
  assert.equal(result.status, 'READY_FOR_REVIEW');
  const sessionSummaryRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/aba/session-summaries'"),
    serverCode.indexOf("app.post('/api/aba/mastery-evaluations'")
  );
  assert.doesNotMatch(sessionSummaryRoute, /from\('aba_targets'\)[\s\S]{0,180}\.update\(/);
  assert.match(serverCode, /persistTargetMaintenanceApproval[\s\S]*?aba_target_status_audit_logs/);
  assert.doesNotMatch(migrationSql, /update\s+public\.aba_targets/i);
});

test('aprovacao futura exige audit log com evaluationId', () => {
  assert.throws(() => buildTargetStatusAuditLog({
    organizationId: 'clinic-1',
    patientId: 'patient-1',
    targetId: 'target-1',
    previousStatus: 'IN_PROGRESS',
    newStatus: 'MASTERED',
    evaluationId: '',
    changedBy: 'supervisor-1',
    reason: 'Aprovado em supervisao'
  }), /evaluationId/);
  const audit = buildTargetStatusAuditLog({
    organizationId: 'clinic-1',
    patientId: 'patient-1',
    targetId: 'target-1',
    previousStatus: 'IN_PROGRESS',
    newStatus: 'MASTERED',
    evaluationId: 'evaluation-1',
    changedBy: 'supervisor-1',
    reason: 'Aprovado em supervisao'
  });
  assert.equal(audit.evaluation_id, 'evaluation-1');
});

test('migration cria criterios, avaliacoes auditaveis, indices e RLS', () => {
  for (const tableName of ['aba_mastery_criteria', 'aba_target_status_audit_logs']) {
    assert.match(migrationSql, new RegExp(`create table if not exists public\\.${tableName}`, 'i'));
    assert.match(migrationSql, new RegExp(`alter table public\\.${tableName} enable row level security`, 'i'));
  }
  assert.match(migrationSql, /alter table public\.aba_mastery_evaluations[\s\S]*?add column if not exists status text/i);
  assert.match(migrationSql, /alter table public\.aba_mastery_evaluations enable row level security/i);
  assert.match(migrationSql, /idx_aba_trials_org_patient_target_occurred/i);
  assert.match(migrationSql, /idx_aba_trials_org_session_target/i);
  assert.match(migrationSql, /idx_aba_mastery_evaluations_org_patient_target_evaluated/i);
  assert.match(migrationSql, /idx_aba_mastery_criteria_org_target_active/i);
  assert.match(migrationSql, /idx_aba_mastery_criteria_org_program_active/i);
});

test('frontend e backend integram avaliacao summary-driven no encerramento e relatorio', () => {
  assert.match(serverCode, /evaluateAndPersistSessionMastery[\s\S]*?select\(trialSelect\)[\s\S]*?eq\('session_id', sessionId\)[\s\S]*?limit\(1000\)/m);
  assert.match(serverCode, /app\.post\('\/api\/aba\/session-summaries'[\s\S]*?evaluateAndPersistSessionMastery[\s\S]*?mastery_summary: masterySummaryPayload/m);
  assert.match(serverCode, /from\('aba_mastery_evaluations'\)[\s\S]*?select\('id,status,evaluation_status,evaluated_at,therapist_id,consecutive_successful_days'\)[\s\S]*?limit\(30\)/m);
  assert.match(sessionModeCode, /evaluateTargetMastery\([\s\S]*?teachingMasteryRows/m);
  assert.match(sessionModeCode, /legacySuccessTarget[\s\S]*?required_consecutive_independent_correct_trials/m);
  assert.match(sessionModeCode, /normalizeAbaMasteryCriterion[\s\S]*?buildSessionGoalMasteryCriterion/m);
  assert.match(sessionModeCode, /criterionSourceLabel[\s\S]*?Origem:/m);
  assert.match(sessionModeCode, /Critérios de maestria[\s\S]*?progresso do crit/m);
  assert.doesNotMatch(sessionModeCode, /const legacyDays/);
  assert.match(serverCode, /required_consecutive_independent_correct_trials[\s\S]*?embeddedRequiredConsecutiveIndependentCorrectTrials/m);
  assert.match(serverCode, /MASTERY_CRITERIA_UPDATED/);
  assert.match(serverCode, /\/api\/aba\/patients\/:patientId\/targets\/:targetId\/mastery-criteria/);
  assert.match(dataServiceCode, /async updateAbaTargetMasteryCriteria[\s\S]*?mastery-criteria/);
  assert.match(serverCode, /min_accuracy_percent:[\s\S]*?requiredAccuracy[\s\S]*?\?\? null/m);
  assert.doesNotMatch(serverCode, /consecutive_successful_days: asSafeNumber\([\s\S]*?consecutive_successes/m);
  assert.match(dataServiceCode, /async saveAbaMasteryEvaluation\(evaluation: any\)[\s\S]*?criteria_id[\s\S]*?status[\s\S]*?total_trials/m);
  assert.match(dataServiceCode, /criterion_progress_count[\s\S]*?criterionProgressCount/m);
});

test('normalizacao e formatacao de criterio sao estaveis', () => {
  const normalized = normalizeAbaMasteryCriterion(baseCriteria);
  assert.equal(normalized?.minAccuracyPercent, 80);
  assert.equal(normalized?.minIndependencePercent, 80);
  assert.equal(normalized?.requiredIndependentCorrectTrials, null);
  assert.match(formatAbaMasteryCriterion(normalized), /80% acuracia/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] ABA mastery engine checks: ${passed}/${tests.length}`);
