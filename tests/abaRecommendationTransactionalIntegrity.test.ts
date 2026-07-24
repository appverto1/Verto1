import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyServerAbaRecommendationIdentity,
  buildServerAbaRecommendationIdentity,
} from '../src/server/abaRecommendationIdentity.ts';
import { generateNextSessionRecommendations } from '../src/utils/abaPlanningEngine.ts';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const server = read('server.ts');
const sessionMode = read('src/components/SessionMode.tsx');
const dataService = read('src/services/dataService.ts');
const engine = read('src/utils/abaPlanningEngine.ts');
const identityModule = read('src/server/abaRecommendationIdentity.ts');
const migration = read(
  'supabase/migrations/20260724163000_aba_recommendation_transactional_integrity.sql'
);

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const recommendation = (overrides: Record<string, unknown> = {}) => ({
  organization_id: 'ignored-client-organization',
  clinic_id: 'clinic-1',
  patient_id: 'ignored-client-patient',
  source_session_id: 'session-1',
  recommendation_type: 'REGRESSION_ATTENTION' as const,
  priority: 'HIGH' as const,
  title: 'Atenção para regressão',
  summary: 'Dois probes abaixo do critério.',
  rationale: 'Revisão humana.',
  suggested_action: 'Revisar dados.',
  target_id: 'target-1',
  metric_name: 'regression_alert',
  context_hash: 'context-1',
  evidence: {
    reasonCode: 'unresolved_regression_alert',
    clinicalWindowKey: 'regression:2026-30',
    configurationKey: 'rule-v1',
  },
  status: 'SUGGESTED' as const,
  ...overrides,
});

test('identidade persistente usa SHA-256 somente no modulo server-side', () => {
  const identity = buildServerAbaRecommendationIdentity(
    recommendation(),
    'organization-1',
    'patient-1'
  );
  assert.match(identity.suggestionKey, /^[a-f0-9]{64}$/);
  assert.equal(identity.id, `rec-sha256-${identity.suggestionKey}`);
  assert.match(identityModule, /from 'crypto'/);
  assert.match(identityModule, /createHash\('sha256'\)/);
  assert.match(migration, /btrim\(normalize\(coalesce\(p_value, ''\)\)\)/);
  assert.doesNotMatch(identityModule, /2166136261|16777619|FNV/i);
});

test('tenant e paciente autoritativos substituem valores do payload', () => {
  const applied = applyServerAbaRecommendationIdentity(
    recommendation(),
    'organization-authoritative',
    'patient-authoritative'
  );
  assert.equal(applied.organization_id, 'organization-authoritative');
  assert.equal(applied.patient_id, 'patient-authoritative');
  assert.match(String(applied.id), /^rec-sha256-[a-f0-9]{64}$/);
});

test('normalizacao e estavel para NFC, caixa, espacos e ausencias equivalentes', () => {
  const composed = recommendation({
    target_id: '  ALVO-1  ',
    evidence: {
      reasonCode: '  REGRESSÃO  ',
      clinicalWindowKey: ' SEMANA-1 ',
      configurationKey: null,
    },
  });
  const decomposed = recommendation({
    target_id: 'alvo-1',
    evidence: {
      reasonCode: 'regressa\u0303o',
      clinicalWindowKey: 'semana-1',
      configurationKey: '',
    },
  });
  const first = buildServerAbaRecommendationIdentity(
    composed,
    'organization-1',
    'patient-1'
  );
  const second = buildServerAbaRecommendationIdentity(
    decomposed,
    'organization-1',
    'patient-1'
  );
  assert.equal(first.id, second.id);
});

test('tenant e paciente diferentes geram identidades diferentes', () => {
  const base = recommendation();
  const first = buildServerAbaRecommendationIdentity(base, 'organization-1', 'patient-1');
  const otherTenant = buildServerAbaRecommendationIdentity(base, 'organization-2', 'patient-1');
  const otherPatient = buildServerAbaRecommendationIdentity(base, 'organization-1', 'patient-2');
  assert.notEqual(first.id, otherTenant.id);
  assert.notEqual(first.id, otherPatient.id);
});

test('motor compartilhado nao atribui ID persistente antes do backend', () => {
  const generated = generateNextSessionRecommendations({
    organizationId: 'organization-1',
    patientId: 'patient-1',
    sourceSessionId: 'session-1',
    focusType: 'MAINTENANCE',
    now: '2026-07-24T12:00:00.000Z',
    targets: [{ id: 'target-1', name: 'Responder ao nome', clinical_status: 'MAINTENANCE' }],
    maintenanceSchedules: [],
  });
  assert.equal(generated.recommendations.length, 1);
  assert.equal(generated.recommendations[0].id, undefined);
});

test('backend usa sessao como tenant e rejeita claim divergente', () => {
  assert.match(
    server,
    /const organizationId = sanitizeString\(req\.session\.user\?\.organizationId \|\| req\.session\.user\?\.organization_id \|\| clinicId/
  );
  assert.match(server, /hasAbaOrganizationClaimMismatch\(req, organizationId\)/);
  assert.match(server, /return res\.status\(403\)/);
  assert.doesNotMatch(
    server,
    /const organizationId = sanitizeString\(req\.body\?\.organizationId/
  );
});

test('geracao usa upsert atomico por chave semantica e mescla ocorrencias', () => {
  assert.match(server, /upsert_aba_clinical_recommendations_v2/);
  assert.match(
    migration,
    /on conflict \(organization_id, patient_id, suggestion_key\)[^]*do update set/
  );
  assert.match(migration, /aba_merge_recommendation_evidence/);
  assert.match(migration, /limit 100/);
  assert.match(migration, /aba_clinical_recommendation_occurrences/);
  assert.doesNotMatch(
    server,
    /\.from\('aba_clinical_recommendations'\)[^]*\.insert\(payloads\)/
  );
});

test('decisao e plano usam uma unica RPC com lock e rollback implicito', () => {
  assert.match(server, /apply_aba_clinical_recommendation_decision_v2/);
  assert.match(migration, /order by recommendation\.id\s+for update/);
  assert.match(migration, /insert into public\.aba_next_session_plan_items/);
  assert.match(migration, /insert into public\.aba_clinical_recommendation_audit_logs/);
  assert.doesNotMatch(server, /persistRecommendationState/);
});

test('auditoria e append-only e retry nao altera evento original', () => {
  assert.match(migration, /create unique index if not exists uq_aba_recommendation_audit_idempotency/);
  assert.match(migration, /if found then[^]*v_existing_audit\.metadata -> 'result'/);
  assert.match(migration, /before update or delete/);
  assert.match(migration, /ABA_RECOMMENDATION_AUDIT_APPEND_ONLY/);
  assert.match(
    migration,
    /revoke insert, update, delete[^]*aba_clinical_recommendation_audit_logs[^]*from anon, authenticated/
  );
  assert.doesNotMatch(migration, /upsert[^;]*aba_clinical_recommendation_audit_logs/i);
});

test('idempotencia diferencia payload e acoes sem usar timestamp no ID', () => {
  assert.match(migration, /v_existing_audit\.action <> v_action/);
  assert.match(migration, /v_existing_audit\.payload_hash <> v_payload_hash/);
  assert.match(migration, /ABA_RECOMMENDATION_IDEMPOTENCY_CONFLICT/);
  assert.match(
    migration,
    /p_organization_id \|\| '\|' \|\| p_patient_id::text \|\| '\|' \|\| v_recommendation\.id \|\| '\|' \|\| v_action \|\| '\|' \|\| p_idempotency_key/
  );
  assert.doesNotMatch(migration, /p_idempotency_key \|\| now\(\)/);
});

test('duplicatas legadas sao persistidas como superseded antes da paginacao', () => {
  assert.match(migration, /status = 'SUPERSEDED'/);
  assert.match(migration, /canonical_recommendation_id/);
  assert.match(migration, /resolution_reason/);
  assert.match(migration, /merged_recommendation_ids/);
  assert.match(migration, /'groupedRecommendationIds', to_jsonb\(coalesce\(v_grouped_ids/);
  assert.match(server, /groupedRecommendationIds: result\?\.groupedRecommendationIds \|\| \[\]/);
  assert.match(server, /\.is\('canonical_recommendation_id', null\)[^]*\.limit\(limit \+ 1\)/);
  assert.doesNotMatch(migration, /delete from public\.aba_clinical_recommendations/i);
});

test('RPCs sao exclusivas do service role e validam escopo', () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = public, extensions/);
  assert.match(migration, /aba_assert_recommendation_actor_scope/);
  assert.match(
    migration,
    /revoke all on function public\.apply_aba_clinical_recommendation_decision_v2[^]*from public, anon, authenticated/
  );
  assert.match(
    migration,
    /grant execute on function public\.apply_aba_clinical_recommendation_decision_v2[^]*to service_role/
  );
});

test('frontend reutiliza idempotency key no retry e reconcilia todo o grupo', () => {
  assert.match(dataService, /'X-Idempotency-Key': idempotencyKey/);
  assert.match(sessionMode, /planningDecisionRequestKeysRef/);
  assert.match(sessionMode, /const existing = planningDecisionRequestKeysRef\.current\.get\(scope\)/);
  assert.match(sessionMode, /groupedRecommendationIds/);
  assert.match(sessionMode, /previous\.filter\(\(item\) => !groupedIds\.has/);
  assert.doesNotMatch(sessionMode, /window\.location\.reload/);
});

test('FNV compartilhado permanece apenas no hash efemero de contexto', () => {
  assert.match(engine, /const stableHash/);
  assert.match(engine, /context_hash: contextHash/);
  assert.doesNotMatch(engine, /id: `rec-\$\{stableHash/);
  assert.doesNotMatch(engine, /id: `audit-\$\{stableHash/);
  assert.doesNotMatch(engine, /id: `plan-\$\{stableHash/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] ABA recommendation transactional integrity checks: ${passed}/${tests.length}`);
