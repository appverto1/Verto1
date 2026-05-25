import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateDurationSummary,
  calculateFrequencySummary,
  calculateIntervalSummary,
  calculateSessionSummary,
  calculateTrialAccuracy,
  calculateTrialIndependence,
  canCloseAbaSession,
  canRecordInAbaSession
} from '../src/utils/abaSessionSummary.ts';
import { buildIntervalAggregateSummary, buildIntervalCancelAudit, pauseIntervalRunState, resumeIntervalRunState } from '../src/utils/abaIntervalLifecycle.ts';
import { isAbaV2Enabled } from '../src/utils/featureFlags.ts';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const abaMigrationFiles = fs
  .readdirSync(path.join(root, 'supabase/migrations'))
  .filter((file) => file.includes('aba') && file.endsWith('.sql'))
  .sort();
const abaMigrationSql = abaMigrationFiles.map((file) => read(`supabase/migrations/${file}`)).join('\n');
const sessionModeCode = read('src/components/SessionMode.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const serverCode = read('server.ts');
const patientDetailCode = read('src/components/PatientDetailView.tsx');

test('schema ABA Marco 1 existe e migrations ABA sao aditivas', () => {
  for (const tableName of [
    'aba_sessions',
    'aba_programs',
    'aba_targets',
    'aba_prompt_levels',
    'aba_trials',
    'aba_behavior_definitions',
    'aba_behavior_events',
    'aba_interval_records',
    'aba_interval_summaries',
    'aba_abc_events',
    'aba_session_summaries'
  ]) {
    assert.match(abaMigrationSql, new RegExp(`create table if not exists public\\.${tableName}\\b`, 'i'), `${tableName} deve existir.`);
  }
  assert.doesNotMatch(abaMigrationSql, /\bdrop\s+column\b|\bdrop\s+table\b|\brename\s+column\b|\brename\s+to\b/i);
});

test('feature flag aba_v2 isola UI, dataService e API', () => {
  assert.equal(isAbaV2Enabled({ overrides: { aba_v2: false } }), false);
  assert.match(patientDetailCode, /abaV2Enabled && isSessionModeOpen[\s\S]*?<SessionMode/m);
  assert.match(dataServiceCode, /if \(!isAbaV2Enabled\(\)\) return abaV2DisabledResponse/m);
  assert.match(serverCode, /const requireAbaV2Feature[\s\S]*?feature_disabled[\s\S]*?aba_v2/m);
});

test('calculos ABA Marco 1 usam funcoes auditaveis', () => {
  const trials = [
    { trialOutcome: 'independent', score: 1, independent: true, correct: true },
    { trialOutcome: 'prompted', score: 0.5, promptLevelKey: 'verbal', correct: true },
    { trialOutcome: 'error', score: 0, promptLevelKey: 'error', correct: false }
  ];
  assert.equal(calculateTrialAccuracy(trials), 67);
  assert.equal(calculateTrialIndependence(trials), 33);
  assert.deepEqual(calculateFrequencySummary([
    { behaviorName: 'Agressao', measurementType: 'frequency', countDelta: 1 },
    { behaviorName: 'Agressao', measurementType: 'frequency', countDelta: 2 }
  ]), [{ behaviorName: 'Agressao', occurrences: 3 }]);
  assert.deepEqual(calculateDurationSummary([
    { behaviorName: 'Fuga', measurementType: 'duration', durationSeconds: 30 },
    { behaviorName: 'Fuga', measurementType: 'duration', durationSeconds: 90 }
  ]), [{ behaviorName: 'Fuga', episodes: 2, totalSeconds: 120, averageSeconds: 60, maxSeconds: 90 }]);
  assert.equal(calculateIntervalSummary([
    { behaviorName: 'Estereotipia', measurementType: 'partial_interval', intervalOccurred: true },
    { behaviorName: 'Estereotipia', measurementType: 'partial_interval', intervalOccurred: false }
  ])[0].occurrencePercent, 50);
});

test('bloqueios de encerramento e sessao completed estao protegidos', () => {
  assert.equal(canCloseAbaSession({ openDurations: [{ id: 'open' }] }).canClose, false);
  assert.equal(canCloseAbaSession({ intervalRun: { id: 'interval', status: 'RUNNING' } }).canClose, false);
  assert.equal(canCloseAbaSession({ intervalRun: { id: 'interval', status: 'AWAITING_RESPONSE', awaitingResponse: true } }).canClose, false);
  assert.equal(canCloseAbaSession({ intervalRun: { id: 'interval', status: 'PAUSED', paused: true } }).canClose, false);
  assert.equal(canRecordInAbaSession({ status: 'completed' }), false);
});

test('intervalo parcial cobre pausa, retomada, parcial e cancelamento', () => {
  const run = {
    id: 'run-1',
    behaviorName: 'Estereotipia',
    method: 'partial_interval',
    intervalSeconds: 30,
    intervalIndex: 2,
    totalIntervals: 4,
    completedCount: 1,
    occurredCount: 1,
    intervalEndsAt: '2026-05-25T12:00:30.000Z'
  };
  const paused = pauseIntervalRunState(run, { nowMs: Date.parse('2026-05-25T12:00:10.000Z') });
  const resumed = resumeIntervalRunState(paused, { resumedAt: '2026-05-25T12:01:00.000Z' });
  const partial = buildIntervalAggregateSummary(run, { answeredIntervals: 2, yesCount: 1, status: 'PARTIALLY_COMPLETED' });
  const cancel = buildIntervalCancelAudit(run);
  assert.equal(paused.status, 'PAUSED');
  assert.equal(resumed.status, 'RUNNING');
  assert.equal(partial.collectionStatus, 'PARTIALLY_COMPLETED');
  assert.equal(cancel.collectionStatus, 'CANCELLED');
});

test('persistencia cobre acoes clinicas do Marco 1', () => {
  for (const marker of [
    'async saveAbaSession(session: any)',
    'async saveAbaTrial(trial: any)',
    'async saveAbaBehaviorEvent(event: any)',
    'async saveAbaIntervalRecord(record: any)',
    'async saveAbaIntervalSummary(summary: any)',
    'async saveAbaAbcEvent(event: any)',
    'async saveAbaSessionSummary(summary: any)'
  ]) {
    assert.match(dataServiceCode, new RegExp(marker.replace(/[()]/g, '\\$&')));
  }
  assert.match(sessionModeCode, /persistIntervalLifecycleRecord\(nextRun, 'RUNNING'/);
  assert.match(sessionModeCode, /persistIntervalLifecycleRecord\(pausedRun, 'PAUSED'/);
  assert.match(sessionModeCode, /persistIntervalLifecycleRecord\(resumedRun, 'RUNNING'/);
  assert.match(sessionModeCode, /saveIntervalRecord\(payload/);
  assert.match(sessionModeCode, /saveIntervalAggregateV2\(/);
});

test('integridade minima inclui contexto, timestamp, sync e source', () => {
  assert.match(abaMigrationSql, /aba_trials[\s\S]*?add column if not exists source text not null default 'verto_web'/i);
  assert.match(abaMigrationSql, /aba_abc_events[\s\S]*?add column if not exists occurred_at timestamptz not null default now\(\)/i);
  assert.match(dataServiceCode, /function buildAbaIntegrityFields/);
  assert.match(dataServiceCode, /clinic_id[\s\S]*?clinicId[\s\S]*?organization_id[\s\S]*?organizationId/);
  assert.match(serverCode, /const resolveAbaRequestSource[\s\S]*?'verto_web'/m);
});

test('ABC pos-encerramento exige complemento autorizado', () => {
  assert.match(
    serverCode,
    /app\.post\('\/api\/aba\/abc-events'[\s\S]*?assertAbaSessionCanAcceptClinicalWrite\(sessionId, clinicId, req\.session\.user, \{[\s\S]*?allowCompletedComplement: isAuthorizedComplement/m
  );
});

test('relatorio pos-encerramento deriva do SessionSummary salvo', () => {
  assert.match(sessionModeCode, /const summarySaveResult = await dataService\.saveAbaSessionSummary/);
  assert.match(sessionModeCode, /setPostClosureSummary\(\{[\s\S]*?summarySaveResult\?\.data\?\.id/m);
  const summary = calculateSessionSummary('session-1', {
    trials: [{ sessionId: 'session-1', trialOutcome: 'independent', score: 1, independent: true, correct: true }]
  });
  assert.equal(summary.totalTrials, 1);
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
