import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const access = fs.readFileSync('src/utils/therapeuticPlanAccess.ts', 'utf8');
const server = readPatientPlanServerSource();
const ptsHandlers = fs.readFileSync('services/ptsVersionWriteHandlers.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260826152500_therapeutic_plan_rebac_hierarchy_v1.sql', 'utf8');

assert.match(panel, /Planos terapêuticos/);
assert.match(panel, /Plano da equipe/);
assert.match(panel, /Planos por especialidade/);
assert.match(panel, /Meu plano/);
assert.match(panel, /Planos supervisionados/);
assert.doesNotMatch(
  panel,
  />Planos da equipe<[\s\S]{0,800}>Plano da especialidade ·/,
  'o hub não deve voltar a misturar PTS e especialidades sob o mesmo rótulo',
);
assert.match(
  panel,
  /canStartSessionHere = typeof onStartSession === 'function' && canEditThisScope/,
  'supervisão somente-leitura não deve ganhar ação de iniciar sessão por acidente',
);
assert.match(
  panel,
  /onStartSession\?\.\(\{ therapeuticPlanId: String\(scope\.id\), specialty: scope\.specialty \|\| null \}\)/,
  'iniciar sessão deve acontecer dentro do plano por especialidade e carregar seu id',
);
const ptsDashboard = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');
assert.doesNotMatch(
  ptsDashboard,
  /Adicionar programa|canCreateProgram|onAddProgram/,
  'o PTS compartilhado não deve possuir o CTA nem a capacidade de criação de programa da especialidade',
);

assert.match(access, /return \['owner', 'admin', 'director', 'coordinator'\]\.includes\(/);
assert.doesNotMatch(
  access,
  /return \[[^\]]*supervisor[^\]]*\]\.includes\(/,
  'supervisor não pode ser promovido a gestor global por RBAC genérico',
);
assert.match(access, /supervisionLinks/);
assert.match(access, /isTherapeuticPlanParticipant/);

assert.match(migration, /lower\(coalesce\(p_mode, ''\)\) = 'interdisciplinary'[\s\S]*?p_required_permission = 'read'/);
assert.match(
  migration,
  /auth\.uid\(\)::text = any\([\s\S]*?p_responsible_professional_id[\s\S]*?p_participant_professional_ids/,
  'plano por especialidade deve exigir participação explícita, e não só especialidade igual',
);
assert.match(migration, /clinical_supervision_links[\s\S]*?supervision\.status = 'active'/);
assert.match(migration, /p_required_permission = 'read'[\s\S]*?clinical_supervision_links/);
assert.doesNotMatch(
  migration,
  /p_specialty[^\n]*auth|auth[^\n]*p_specialty/i,
  'especialidade isolada não pode funcionar como autorização de leitura',
);


assert.match(
  panel,
  /PTS_DRAFT_VALIDATION_FAILED[\s\S]*setActivationWarning/,
  'campos pendentes de ativação devem virar aviso de rascunho, não erro global impeditivo',
);
const ptsEditor = fs.readFileSync('src/components/PtsWorkspaceEditor.tsx', 'utf8');
const ptsOptionalMigration = fs.readFileSync('supabase/migrations/20261009160000_pts_activation_optional_content_v4.sql', 'utf8');
assert.match(
  ptsEditor,
  /Preenchimentos clínicos são opcionais para criar e ativar o PTS/,
  'a UI deve deixar explícito que campos clínicos opcionais não bloqueiam criação ou ativação',
);
assert.match(
  ptsOptionalMigration,
  /create or replace function public\.patient_pts_snapshot_ready_for_activation_v3/,
  'a validação opcional deve ser aplicada no banco, não somente no frontend',
);
assert.match(
  ptsHandlers,
  /PTS_DRAFT_VALIDATION_FAILED'[\s\S]*blockingScope: 'activation_only'[\s\S]*draftPreserved: true/,
  'o contrato da API deve declarar que a validação bloqueia apenas ativação e preserva o draft',
);

assert.match(
  server,
  /SESSION_SPECIALTY_PLAN_REQUIRED/,
  'a API de início de sessão deve rejeitar o PTS como se fosse plano operacional de especialidade',
);
assert.match(
  server,
  /SESSION_THERAPEUTIC_PLAN_ACCESS_DENIED/,
  'o servidor precisa manter a autorização mesmo que a UI seja forjada',
);

assert.match(
  server,
  /const ptsSharedEvidence = hasVisiblePts/,
  'o PTS deve receber uma projeção compartilhada explícita em vez do payload privado dos planos de especialidade',
);
assert.match(
  server,
  /sourcePlanId: canOpenSourcePlan \? sourcePlanId : null/,
  'o identificador do plano de origem não pode vazar quando o ator não pode abrir a especialidade',
);
assert.match(
  server,
  /explicitlyShared = program\?\.advanced_settings\?\.shareWithPts === true/,
  'evidência de especialidade só pode entrar no PTS por compartilhamento explícito',
);

console.log('therapeuticPlanHierarchyRebac.regression.test.mjs: ok');
