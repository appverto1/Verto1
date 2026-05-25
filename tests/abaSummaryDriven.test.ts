import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationSql = readFileSync(join(root, 'supabase/migrations/20260525123000_aba_v2_summary_driven.sql'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('summary tables and indexes are additive and tenant-scoped', () => {
  for (const tableName of [
    'aba_session_live_summaries',
    'aba_patient_aba_summaries',
    'aba_target_live_summaries',
    'aba_behavior_daily_summaries'
  ]) {
    assert.match(migrationSql, new RegExp(`create table if not exists public\\.${tableName}`, 'i'), `${tableName} deve ser criado de forma aditiva.`);
    assert.match(migrationSql, new RegExp(`${tableName}[\\s\\S]*?organization_id text not null`, 'i'), `${tableName} deve ter organization_id.`);
    assert.match(migrationSql, new RegExp(`alter table public\\.${tableName} enable row level security`, 'i'), `${tableName} deve ter RLS.`);
  }

  for (const indexName of [
    'idx_aba_prompt_levels_organization',
    'idx_aba_programs_organization',
    'idx_aba_targets_organization',
    'idx_aba_behavior_definitions_organization',
    'idx_aba_sessions_organization',
    'idx_aba_trials_organization',
    'idx_aba_behavior_events_organization',
    'idx_aba_interval_records_organization',
    'idx_aba_interval_summaries_organization',
    'idx_aba_abc_events_organization',
    'idx_aba_audit_events_organization',
    'idx_aba_mastery_evaluations_organization',
    'idx_aba_trials_session_occurred',
    'idx_aba_trials_patient_target_occurred',
    'idx_aba_behavior_events_session_occurred',
    'idx_aba_behavior_events_patient_behavior_occurred',
    'idx_aba_interval_records_session_behavior_number',
    'idx_aba_interval_summaries_session_behavior',
    'idx_aba_session_live_summaries_session',
    'idx_aba_patient_aba_summaries_patient',
    'idx_aba_behavior_daily_summaries_patient_behavior_date'
  ]) {
    assert.match(migrationSql, new RegExp(`create (unique )?index if not exists ${indexName}`, 'i'), `${indexName} deve existir.`);
  }
});

test('trial insert updates session, target and patient summaries', () => {
  assert.match(migrationSql, /create or replace function public\.aba_summary_after_trial_insert\(\)[\s\S]*?total_trials[\s\S]*?accuracy_percent[\s\S]*?independence_percent/i);
  assert.match(migrationSql, /trg_aba_summary_after_trial_insert[\s\S]*?after insert on public\.aba_trials/i);
  assert.match(migrationSql, /aba_target_live_summaries[\s\S]*?attempts_today[\s\S]*?correct_today[\s\S]*?independent_today[\s\S]*?prompted_today[\s\S]*?errors_today/i);
  assert.match(migrationSql, /perform public\.aba_touch_patient_summary\(v_org, new\.clinic_id, new\.patient_id, 0, 1, 0/i);
});

test('behavior and duration triggers update live and daily summaries', () => {
  assert.match(migrationSql, /create or replace function public\.aba_summary_after_behavior_insert\(\)[\s\S]*?frequency_event_count[\s\S]*?frequency_count/i);
  assert.match(migrationSql, /new\.measurement_type = 'duration' and new\.status = 'IN_PROGRESS'[\s\S]*?open_duration_count/i);
  assert.match(migrationSql, /trg_aba_summary_after_duration_completed[\s\S]*?after update of status, ended_at, duration_seconds on public\.aba_behavior_events/i);
  assert.match(migrationSql, /open_duration_count = greatest\(0, open_duration_count - 1\)[\s\S]*?perform public\.aba_upsert_behavior_daily_duration/i);
  assert.match(migrationSql, /duration_total_seconds = public\.aba_behavior_daily_summaries\.duration_total_seconds \+ v_duration/i);
});

test('interval summary and completed session freeze summaries', () => {
  assert.match(migrationSql, /create or replace function public\.aba_summary_after_interval_summary_insert\(\)[\s\S]*?interval_collection_count[\s\S]*?interval_occurrence_percent/i);
  assert.match(migrationSql, /trg_aba_summary_after_interval_summary_insert[\s\S]*?after insert on public\.aba_interval_summaries/i);
  assert.match(migrationSql, /create or replace function public\.aba_summary_after_session_completed\(\)[\s\S]*?insert into public\.aba_session_summaries/i);
  assert.match(migrationSql, /trg_aba_summary_after_session_completed[\s\S]*?after update of status on public\.aba_sessions/i);
});

test('backend exposes explicit summary-driven query helpers', () => {
  for (const [route, selectConst] of [
    ['/api/aba/session-live-summaries/:sessionId', 'ABA_SESSION_LIVE_SUMMARY_SELECT'],
    ['/api/aba/session-reports/:sessionId', 'ABA_SESSION_REPORT_SELECT'],
    ['/api/aba/patient-summary/:patientId', 'ABA_PATIENT_SUMMARY_SELECT']
  ]) {
    assert.match(serverCode, new RegExp(route.replace(/[/:]/g, (match) => (match === '/' ? '\\/' : match)) + `[\\s\\S]*?select\\(${selectConst}\\)`, 'm'), `${route} deve usar selecao explicita.`);
  }
  assert.match(serverCode, /app\.get\('\/api\/aba\/recent-session-events\/:sessionId'[\s\S]*?select\(ABA_TRIAL_LIST_SELECT\)[\s\S]*?select\(ABA_BEHAVIOR_EVENT_LIST_SELECT\)[\s\S]*?select\(ABA_MASTERY_LIST_SELECT\)/m);
  assert.match(serverCode, /parseAbaPageParams[\s\S]*?\.range\(from, to\)/m, 'Listas ABA devem usar range/paginacao.');
});

test('frontend reads summaries and limits raw clinical lists', () => {
  for (const helper of [
    'getSessionLiveSummary',
    'getRecentSessionEvents',
    'getPatientAbaSummary',
    'getSessionReport',
    'getPaginatedBehaviorEvents'
  ]) {
    assert.match(dataServiceCode, new RegExp(`async ${helper}\\(`), `${helper} deve existir no dataService.`);
  }
  assert.match(dataServiceCode, /function auditClinicalQuery[\s\S]*?sem limit\/pageSize[\s\S]*?select\('\*'\)\/payload amplo[\s\S]*?refetch amplo apos escrita/m);
  assert.match(patientDetailCode, /recentRecordLimit = 10[\s\S]*?dataService\.getPatientAbaSummary\(String\(patient\.id\)\)[\s\S]*?page: 1, pageSize: recentRecordLimit/m);
  assert.match(patientDetailCode, /abaSummaryMetrics[\s\S]*?total_trials[\s\S]*?total_behavior_events[\s\S]*?mastered_targets_count/m);
  assert.match(sessionModeCode, /dataService\.getSessionLiveSummary\(sessionId\)[\s\S]*?visibleHistoryRecords = historyExpanded \? clinicalHistoryRecords : clinicalHistoryRecords\.slice\(0, 20\)/m);
  assert.match(sessionModeCode, /openPersistedPostClosureReport[\s\S]*?dataService\.getSessionReport\(sessionId\)[\s\S]*?setPostClosureSummary\(persistedSummary\)/m);
});

test('ABA V2 does not use realtime subscriptions by default', () => {
  assert.doesNotMatch(dataServiceCode, /postgres_changes[\s\S]{0,120}aba_/i);
  assert.doesNotMatch(serverCode, /postgres_changes[\s\S]{0,120}aba_/i);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] ABA summary-driven checks: ${passed}/${tests.length}`);
