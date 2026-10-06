import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const sessionMode = fs.readFileSync('src/components/SessionMode.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260826154500_specialty_session_pts_context_binding_v1.sql', 'utf8');

assert.match(
  patientDetail,
  /onStartSession=\{\(planContext: any\) => requestSessionStart\('fullscreen', planContext\)\}/,
  'o plano selecionado precisa atravessar o hub até o fluxo de início de sessão',
);
assert.match(
  patientDetail,
  /therapeutic_plan_id: pendingSessionPlanContext\?\.therapeuticPlanId \|\| null/,
  'a sessão local deve carregar explicitamente o plano por especialidade escolhido',
);
assert.match(
  patientDetail,
  /requiresServerIssuedPlanContext = Boolean\(nextSession\.therapeutic_plan_id\)/,
  'sessões vinculadas a plano precisam reconhecer que o contexto depende do servidor',
);
assert.match(
  patientDetail,
  /if \(!abaV2Enabled\) persistActiveSession\(nextSession\)/,
  'sessão ABA V2 não pode virar contexto local definitivo antes do ACK do servidor',
);
assert.match(
  patientDetail,
  /confirmedPlanId !== expectedPlanId/,
  'o cliente deve rejeitar um ACK que não confirme exatamente o plano escolhido',
);
assert.match(
  dataService,
  /saveAbaSession\(session: any\)[\s\S]*?requireServerAck: true/,
  'qualquer início de sessão ABA V2 deve receber ACK do servidor antes de virar contexto clínico ativo',
);
assert.match(
  dataService,
  /if \(!requireServerAck\) \{[\s\S]*?saveEncryptedRecord/,
  'offline-first genérico deve permanecer intacto e o bloqueio deve ser restrito à mutação que cria contexto clínico',
);

assert.match(
  server,
  /loadSessionSpecialtyPlanContext[\s\S]*?mode,status,specialty,responsible_professional_id,participant_professional_ids/,
  'a API deve validar o plano por especialidade e seus vínculos antes de iniciar a sessão',
);
assert.match(
  server,
  /criticalColumns: sessionTherapeuticPlanId \? \['therapeutic_plan_id'\] : \[\]/,
  'schema fallback não pode remover silenciosamente o binding crítico da sessão',
);
assert.match(
  server,
  /SESSION_THERAPEUTIC_PLAN_CONTEXT_IMMUTABLE/,
  'reuso de sessão não pode reinterpretar o plano depois da abertura',
);
assert.match(
  server,
  /validateAbaSessionTargetPlanScope[\s\S]*?ABA_SESSION_TARGET_PLAN_MISMATCH/,
  'alvos de outro plano precisam ser bloqueados no contexto fixado da sessão',
);
assert.match(
  server,
  /different_specialty_plan/,
  'sondagens de manutenção de outro plano precisam ser removidas do read model da sessão',
);
assert.match(
  sessionMode,
  /normalizedPrograms\.filter\(\(program: any\) => String\(program\?\.therapeutic_plan_id[\s\S]*?=== activeTherapeuticPlanId\)/,
  'SessionMode deve usar apenas programas do plano imutável da sessão',
);
assert.match(
  sessionMode,
  /if \(activeTherapeuticPlanId\) return serverScopedSchedules/,
  'em sessão por especialidade, manutenção deve usar somente o conjunto já filtrado pelo servidor',
);
assert.match(
  sessionMode,
  /activeTherapeuticPlanId \? \[\] : legacySessionGoals/,
  'metas legadas de outras origens não podem poluir uma sessão explicitamente vinculada a plano',
);

assert.match(migration, /add column if not exists therapeutic_plan_id uuid/i);
assert.match(migration, /ABA_SESSION_THERAPEUTIC_PLAN_IMMUTABLE/);
assert.match(migration, /ABA_SESSION_CLINICAL_SCOPE_IMMUTABLE/);
assert.match(migration, /historical binding remains valid even if the[\s\S]*?plan is later archived\/superseded/i);
assert.match(migration, /add column if not exists specialty_plan_id uuid/i);
assert.match(
  migration,
  /v_anchor_at := coalesce\(v_session\.created_at, p_now\)/,
  'a versão PTS deve ser escolhida pelo timestamp persistido no servidor, não pelo relógio do dispositivo',
);
assert.doesNotMatch(
  migration,
  /v_anchor_at\s*:=\s*coalesce\(v_session\.started_at/,
  'started_at enviado pelo dispositivo nunca deve ser autoridade para reconstruir a versão PTS',
);
assert.match(
  migration,
  /plan\.mode = 'interdisciplinary'/,
  'o PTS compartilhado deve ser resolvido independentemente do plano dos programas',
);
assert.match(
  migration,
  /after insert on public\.aba_sessions[\s\S]*?bind_aba_session_pts_context_after_insert_v1/i,
  'o contexto PTS deve nascer na mesma transação de inserção da sessão',
);
assert.match(
  migration,
  /on conflict \(organization_id, source_session_id, plan_id\) do update[\s\S]*?coalesce\([\s\S]*?specialty_plan_id/,
  'contextos legados podem ser enriquecidos sem sobrescrever um binding já persistido',
);

console.log('therapeuticPlanSessionContext.regression.test.mjs: ok');
