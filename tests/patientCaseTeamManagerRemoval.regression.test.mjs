import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const utility = fs.readFileSync('src/utils/patientProfessionalLinks.ts', 'utf8');
const panel = fs.readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260826200000_patient_case_team_manager_removal_v3.sql',
  'utf8',
);

assert.match(
  utility,
  /protectedClinicManager[\s\S]*?\['director', 'coordinator'\]\.includes\(membershipRole\)/,
  'a UI deve reconhecer gestor ativo da clínica pelo membership atual, não pelo papel histórico no caso',
);
assert.match(utility, /canBeEnded: status === 'active' && !protectedClinicManager/);
assert.match(utility, /canBeEndedReason: protectedClinicManager \? 'protected_clinic_manager' : null/);

assert.match(panel, /PROTECTED_CLINIC_MANAGER/);
assert.match(panel, /Gestão da clínica · vínculo protegido/);
assert.match(
  panel,
  /effectiveCanManage && link\.canBeEnded !== false/,
  'coordenadores/diretores com autoridade resolvida continuam com ação de encerramento para vínculos removíveis',
);

assert.match(
  migration,
  /public\.patient_case_team_actor_can_manage_v1\([\s\S]*?p_actor_id,[\s\S]*?p_patient_id,[\s\S]*?patient_clinic_id/,
  'remoção continua protegida pela autoridade canônica do caso',
);
assert.match(
  migration,
  /target_membership_role in \('director', 'coordinator'\)[\s\S]*?PATIENT_PROFESSIONAL_LINK_PROTECTED_CLINIC_MANAGER/,
  'diretor/coordenador ativo da clínica deve ser o único alvo protegido por papel de gestão',
);
assert.match(
  migration,
  /update public\.patient_professional_links link[\s\S]*?set status = 'ended'[\s\S]*?ended_by = p_actor_id::text/,
  'remoção encerra o vínculo em vez de apagar a linha histórica',
);
assert.match(
  migration,
  /exception[\s\S]*?when others then[\s\S]*?PATIENT_CASE_TEAM_HISTORICAL_SNAPSHOT_SKIPPED/,
  'snapshot legado opcional não pode mais provocar rollback da remoção da equipe',
);
assert.match(
  migration,
  /clinical_supervision_links[\s\S]*?status = 'ended'/,
  'supervisão residual do caso é encerrada de forma idempotente junto com o vínculo',
);
assert.match(server, /PATIENT_PROFESSIONAL_LINK_PROTECTED_CLINIC_MANAGER/);
assert.match(server, /Diretores e coordenadores ativos da clínica não podem ser removidos/);

console.log('patientCaseTeamManagerRemoval.regression.test.mjs: ok');
