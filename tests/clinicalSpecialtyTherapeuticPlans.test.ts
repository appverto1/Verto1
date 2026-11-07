import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CLINICAL_SPECIALTY_OPTIONS,
  normalizeClinicalSpecialty,
} from '../src/utils/clinicalSpecialties';
import {
  canEditTherapeuticPlanScope,
  filterTherapeuticPlanProgramsForActor,
  filterTherapeuticPlanScopesForActor,
} from '../src/utils/therapeuticPlanAccess';

const EXPECTED_SPECIALTIES = [
  'Psicoterapeuta',
  'Fonoaudiólogo',
  'Terapeuta Ocupacional',
  'Nutricionista',
  'Psicomotricista',
  'Psicopedagogo',
  'Arteterapeuta',
  'Musicoterapeuta',
  'Fisioterapeuta',
];

assert.deepEqual([...CLINICAL_SPECIALTY_OPTIONS], EXPECTED_SPECIALTIES);
assert.equal(normalizeClinicalSpecialty('musicoterapeuta'), 'Musicoterapeuta');
assert.equal(
  normalizeClinicalSpecialty('especialidade inventada'),
  null,
  'novas gravações não podem persistir especialidades livres',
);

const patientId = 'patient-1';
const links = [
  {
    patient_id: patientId,
    professional_id: 'professional-1',
    status: 'active',
    permissions: { read: true, write: true },
  },
  {
    patient_id: patientId,
    professional_id: 'professional-2',
    status: 'active',
    permissions: { read: true, write: true },
  },
];
const scopes = [
  {
    id: 'speech-plan',
    patient_id: patientId,
    mode: 'specialty',
    specialty: 'Fonoaudiólogo',
    responsible_professional_id: 'professional-1',
    participant_professional_ids: ['professional-1'],
  },
  {
    id: 'occupational-plan',
    patient_id: patientId,
    mode: 'specialty',
    specialty: 'Terapeuta Ocupacional',
    responsible_professional_id: 'professional-2',
    participant_professional_ids: ['professional-2'],
  },
  {
    id: 'pts-plan',
    patient_id: patientId,
    mode: 'interdisciplinary',
    specialty: null,
    responsible_professional_id: 'professional-2',
    participant_professional_ids: ['professional-1', 'professional-2'],
  },
];
const programs = scopes.map((scope) => ({
  id: `program-${scope.id}`,
  patient_id: patientId,
  therapeutic_plan_id: scope.id,
}));

const professionalContext = {
  actorId: 'professional-1',
  actorRole: 'therapist',
  professionalLinks: links,
};
assert.deepEqual(
  filterTherapeuticPlanScopesForActor(scopes, professionalContext).map(
    (scope) => scope.id,
  ),
  ['speech-plan', 'pts-plan'],
  'o profissional deve ver o plano da própria especialidade e o PTS do qual participa',
);
assert.deepEqual(
  filterTherapeuticPlanProgramsForActor(
    programs,
    scopes,
    professionalContext,
  ).map((program) => program.id),
  ['program-speech-plan', 'program-pts-plan'],
);
assert.equal(
  canEditTherapeuticPlanScope(scopes[0], professionalContext),
  true,
);
assert.equal(
  canEditTherapeuticPlanScope(scopes[1], professionalContext),
  false,
  'um vínculo com o paciente não concede edição do plano de outra especialidade',
);
assert.equal(
  canEditTherapeuticPlanScope(scopes[0], {
    ...professionalContext,
    professionalLinks: [
      { ...links[0], permissions: { read: true, write: false } },
    ],
  }),
  false,
);
assert.deepEqual(
  filterTherapeuticPlanScopesForActor(scopes, {
    ...professionalContext,
    professionalLinks: [
      { ...links[0], permissions: { read: true, write: false } },
    ],
  }).map((scope) => scope.id),
  ['speech-plan', 'pts-plan'],
  'permissão somente leitura mantém visíveis o plano da especialidade e o PTS',
);
assert.equal(
  filterTherapeuticPlanScopesForActor(scopes, {
    actorId: 'coordinator-1',
    actorRole: 'coordinator',
    professionalLinks: [],
  }).length,
  3,
  'a coordenação precisa gerir os planos da equipe inteira',
);

const server = readPatientPlanServerSource();
const invitationModal = fs.readFileSync(
  'src/components/InvitationModal.tsx',
  'utf8',
);
const teamManagement = fs.readFileSync(
  'src/components/TeamManagement.tsx',
  'utf8',
);
const planPanel = fs.readFileSync(
  'src/components/TherapeuticPlanPanel.tsx',
  'utf8',
);
const patientDetail = fs.readFileSync(
  'src/components/PatientDetailView.tsx',
  'utf8',
);
const dataService = fs.readFileSync(
  'src/services/dataService.ts',
  'utf8',
);
const migration = fs.readFileSync(
  'supabase/migrations/20260730030000_therapeutic_plan_membership_authority.sql',
  'utf8',
);

const routeSection = (start: string, end: string) => {
  const startIndex = server.indexOf(start);
  const endIndex = server.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `rota ausente: ${start}`);
  assert.notEqual(endIndex, -1, `limite de rota ausente: ${end}`);
  return server.slice(startIndex, endIndex);
};

const inviteRoute = routeSection(
  "app.post('/api/clinic/invite'",
  "app.get('/api/clinic/invitations'",
);
assert.match(inviteRoute, /normalizeClinicalSpecialty\(requestedSpecialty\)/);
assert.match(inviteRoute, /CLINICAL_SPECIALTY_INVALID/);
assert.match(inviteRoute, /required_onboarding_fields: normalizedOnboardingFields/);

const specialtyRoute = routeSection(
  "app.patch('/api/clinic/members/:memberId/specialty'",
  "app.patch('/api/clinic/members/:memberId/role'",
);
assert.match(
  specialtyRoute,
  /requireClinicCapability\('team.edit'\)/,
);
assert.match(specialtyRoute, /\.from\('clinic_memberships'\)/);
assert.match(specialtyRoute, /\.eq\('clinic_id', clinicId\)/);
assert.match(specialtyRoute, /membership\.role[\s\S]*?'therapist'/);
assert.match(specialtyRoute, /\.rpc\(\s*'set_clinic_member_access_and_specialty_v2'/);
assert.doesNotMatch(
  specialtyRoute,
  /\.from\('professional_profiles'\)[\s\S]*?\.(?:upsert|update)\(/,
  'o endpoint continua usando a membership como autoridade; o espelho legado é transacional no RPC',
);

const roleRoute = routeSection(
  "app.patch('/api/clinic/members/:memberId/role'",
  "app.patch('/api/clinic/members/:memberId/unlink'",
);
assert.match(roleRoute, /role === 'therapist' && !specialty/);
assert.match(roleRoute, /CLINICAL_SPECIALTY_INVALID/);
assert.match(roleRoute, /\.eq\('clinic_id', clinicId\)/);
assert.match(roleRoute, /\.rpc\(\s*'set_clinic_member_access_and_specialty_v2'/);

const planReadRoute = routeSection(
  "app.get('/api/aba/patients/:patientId/therapeutic-plan'",
  "app.post('/api/aba/patients/:patientId/therapeutic-plans'",
);
assert.doesNotMatch(planReadRoute, /requireAbaV2Feature/);
assert.match(planReadRoute, /filterTherapeuticPlanScopesForActor/);
assert.match(planReadRoute, /filterTherapeuticPlanProgramsForActor/);
assert.match(planReadRoute, /\.in\('user_id', linkedProfessionalIds\)/);
assert.match(
  planReadRoute,
  /queryCount: 7 \+ \(linkedProfessionalIds\.length \? 2 : 0\)/,
);
assert.match(planReadRoute, /visibleObjectiveIds/);
assert.match(planReadRoute, /objectives: visibleObjectiveRows/);
assert.match(planReadRoute, /enrichedProfessionalLinks\.some/);
assert.match(planReadRoute, /programsEnabled: isAbaV2ApiEnabled\(\)/);
assert.match(planReadRoute, /resolveHistoricalTherapeuticPlanReadCutoff/);
assert.match(planReadRoute, /\.lte\('created_at', historicalCutoff\.updatedAt\)[\s\S]*?\.lt\('created_at', historicalCutoff\.exclusiveCivilEndAt\)/);
assert.match(planReadRoute, /from\('aba_program_versions'\)/);
assert.match(planReadRoute, /historicalPrograms/);

// Creation logic moved in ABA-M05; the original security assertions stay intact.
const planCreateRoute = fs.readFileSync('services/therapeuticPlanCreateHandler.ts', 'utf8');
assert.doesNotMatch(
  planCreateRoute,
  /req\.body\?\.(?:specialty|specialty_name|specialtyName)(?![A-Za-z_])/,
  'a especialidade do plano não pode vir do navegador',
);
assert.doesNotMatch(
  planCreateRoute,
  /\.from\('professional_profiles'\)/,
  'a especialidade do plano deve vir da membership da clínica, não do perfil global',
);
assert.match(planCreateRoute, /\.from\('clinic_memberships'\)/);
assert.match(planCreateRoute, /\.select\('user_id,clinic_id,role,status,specialty'\)/);
assert.match(planCreateRoute, /\.in\('user_id', participantProfessionalIds\)/);
assert.match(
  planCreateRoute,
  /membershipByProfessional\.get\(responsibleProfessionalId\)[\s\S]*?specialty/,
);
assert.match(planCreateRoute, /THERAPEUTIC_PLAN_PARTICIPATION_REQUIRED/);
assert.match(planCreateRoute, /THERAPEUTIC_PLAN_PARTICIPANT_WRITE_REQUIRED/);
assert.match(planCreateRoute, /Projeto Terapêutico Singular/);
assert.match(planCreateRoute, /\.from\('clinic_memberships'\)/);
assert.match(planCreateRoute, /THERAPEUTIC_PLAN_TEMPLATE_NOT_ACCESSIBLE/);
assert.match(planCreateRoute, /source_template_version: sourceTemplateVersion/);
assert.match(planCreateRoute, /THERAPEUTIC_PLAN_IDEMPOTENCY_KEY_REQUIRED/);
assert.match(planCreateRoute, /THERAPEUTIC_PLAN_IDEMPOTENCY_CONFLICT/);
assert.match(planCreateRoute, /request_hash: requestHash/);
assert.match(planCreateRoute, /normalizeTherapeuticSpecialtyObjectives/);
assert.match(planCreateRoute, /THERAPEUTIC_PLAN_SPECIALTY_OBJECTIVES_INVALID/);

const templateCreateRoute = routeSection(
  "app.post('/api/aba/program-templates'",
  "app.patch('/api/aba/program-templates/:templateId'",
);
assert.match(templateCreateRoute, /canActorReadTherapeuticProgram/);
assert.match(templateCreateRoute, /THERAPEUTIC_PROGRAM_READ_DENIED/);
assert.match(templateCreateRoute, /normalizeClinicalSpecialty\(requestedTemplateSpecialty\)/);
assert.match(templateCreateRoute, /CLINICAL_SPECIALTY_INVALID/);
assert.match(
  templateCreateRoute,
  /\.eq\('clinic_id', clinicId\)[\s\S]*?\.eq\('patient_id', program\.patient_id\)/,
);

assert.match(invitationModal, /useState\(''\)/);
assert.match(invitationModal, /Selecione a especialidade/);
assert.match(teamManagement, /roleSpecialtyDrafts/);
assert.match(teamManagement, /Aplicar acesso profissional/);
assert.match(
  teamManagement,
  /handleUpdateRole\(member\.id, 'therapist', \{ specialty \}\)/,
);
assert.match(planPanel, /Projeto Terapêutico Singular \(PTS\)/);
assert.doesNotMatch(
  planPanel,
  /Status dos programas|Filtrar programas por status/,
  'a navegação principal já separa Programas, Manutenção, Generalização e Histórico',
);
assert.doesNotMatch(planPanel, /Plano interdisciplinar/);
assert.match(planPanel, /Especialidade obtida do cadastro profissional/);
assert.match(planPanel, /Objetivos comuns do PTS/);
assert.match(planPanel, /Esta versão não possui objetivos registrados/);
assert.match(planPanel, /Programas e alvos preservados/);
assert.match(
  planPanel,
  /planData\?\.capabilities\?\.actorId[\s\S]*?currentUserId/,
);
assert.match(planPanel, /scopeIdempotencyKeyRef/);
assert.doesNotMatch(
  planPanel,
  /<(?:input|select)[^>]*value=\{scopeDraft\.specialty\}/,
  'a especialidade do plano deve ser somente leitura',
);
assert.match(patientDetail, /currentUserId=\{resolvedClinicContext\?\.userId/);
assert.match(
  patientDetail,
  /!isKidsProfile[\s\S]*?<TherapeuticPlanPanel/,
  'pacientes adultos também devem expor planos da especialidade e PTS',
);
for (const method of [
  'getPatientTherapeuticPlan',
  'createPatientTherapeuticPlanScope',
  'updatePatientTherapeuticPlanScope',
]) {
  const methodStart = dataService.indexOf(`async ${method}`);
  const methodEnd = dataService.indexOf('\n  async ', methodStart + 8);
  const methodSource = dataService.slice(
    methodStart,
    methodEnd === -1 ? undefined : methodEnd,
  );
  assert.doesNotMatch(
    methodSource,
    /isAbaV2Enabled\(\)/,
    `${method} não pode ocultar planos multiprofissionais quando ABA v2 estiver desabilitada`,
  );
}

assert.match(migration, /^\s*--[\s\S]*?\nbegin;/i);
assert.match(migration, /\ncommit;\s*$/i);
assert.match(migration, /clinic_memberships actor_membership/);
assert.match(migration, /patient_professional_links link/);
assert.match(migration, /participant_professional_ids/);
assert.match(migration, /idempotency_key/);
assert.match(migration, /request_hash/);
assert.match(migration, /snapshot_patient_therapeutic_plan_version_v2/);
assert.doesNotMatch(migration, /\bdelete\s+from\b/i);

console.log('clinicalSpecialtyTherapeuticPlans.test.ts: ok');
