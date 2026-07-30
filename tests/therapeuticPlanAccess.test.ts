import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  canEditTherapeuticPlanScope,
  filterTherapeuticPlanProgramsForActor,
  filterTherapeuticPlanScopesForActor,
  getTherapeuticPlanParticipantIds,
  isTherapeuticPlanManager,
  isTherapeuticPlanParticipant,
  normalizeTherapeuticSpecialtyObjectives,
  resolveHistoricalTherapeuticPlanReadCutoff
} from '../src/utils/therapeuticPlanAccess';

const scopes = [
  {
    id: 'scope-psychology',
    patient_id: 'patient-1',
    responsible_professional_id: 'therapist-1',
    participant_professional_ids: ['therapist-2']
  },
  {
    id: 'scope-speech',
    patient_id: 'patient-1',
    responsible_professional_id: 'therapist-3',
    participant_professional_ids: []
  }
];

const programs = [
  {
    id: 'program-psychology',
    patient_id: 'patient-1',
    therapeutic_plan_id: 'scope-psychology'
  },
  {
    id: 'program-speech',
    patient_id: 'patient-1',
    therapeutic_plan_id: 'scope-speech'
  },
  {
    id: 'program-legacy',
    patient_id: 'patient-1',
    therapeutic_plan_id: null,
    created_by: 'therapist-2'
  },
  {
    id: 'program-legacy-other-professional',
    patient_id: 'patient-1',
    therapeutic_plan_id: null,
    created_by: 'therapist-3'
  }
];

const activeWriteLink = {
  patient_id: 'patient-1',
  professional_id: 'therapist-2',
  status: 'active',
  permissions: { read: true, write: true, historicalRead: true }
};

assert.equal(isTherapeuticPlanManager('owner'), true);
assert.equal(isTherapeuticPlanManager({ role: 'ADMIN' }), true);
assert.equal(isTherapeuticPlanManager({ actorRole: 'coordinator' }), true);
assert.equal(isTherapeuticPlanManager('therapist'), false);

assert.deepEqual(getTherapeuticPlanParticipantIds({
  responsibleProfessionalId: 'therapist-1',
  participantProfessionalIds: [
    'therapist-1',
    'therapist-2',
    'therapist-2',
    ''
  ]
}), ['therapist-1', 'therapist-2']);
assert.equal(isTherapeuticPlanParticipant(scopes[0], 'therapist-1'), true);
assert.equal(isTherapeuticPlanParticipant(scopes[0], 'therapist-4'), false);

assert.deepEqual(
  normalizeTherapeuticSpecialtyObjectives(
    { Psicoterapeuta: ['Objetivo clínico'] },
    ['Psicoterapeuta'],
  ),
  { Psicoterapeuta: ['Objetivo clínico'] },
);
assert.equal(
  normalizeTherapeuticSpecialtyObjectives(
    { 'Especialidade inventada': ['Não pode entrar'] },
    ['Psicoterapeuta'],
  ),
  null,
  'objetivos não podem criar especialidades fora dos participantes',
);
assert.equal(
  normalizeTherapeuticSpecialtyObjectives(
    { Psicoterapeuta: [] },
    ['Fonoaudiólogo'],
  ),
  null,
  'um plano de especialidade só aceita a própria chave canônica',
);

const historicalCutoff = resolveHistoricalTherapeuticPlanReadCutoff({
  ends_at: '2026-07-30',
  updated_at: '2026-07-30T22:30:00.000Z',
});
assert.deepEqual(historicalCutoff, {
  endsAt: '2026-07-30',
  updatedAt: '2026-07-30T22:30:00.000Z',
  exclusiveCivilEndAt: '2026-07-31T03:00:00.000Z',
});
assert.equal(
  resolveHistoricalTherapeuticPlanReadCutoff({
    ends_at: '30/07/2026',
    updated_at: '2026-07-30T22:30:00.000Z',
  }),
  null,
  'data civil inválida não libera histórico sem corte confiável',
);

const managerScopes = filterTherapeuticPlanScopesForActor(scopes, {
  actorId: 'coordinator-1',
  actorRole: 'coordinator'
});
assert.deepEqual(managerScopes.map((scope) => scope.id), [
  'scope-psychology',
  'scope-speech'
]);

const therapistScopes = filterTherapeuticPlanScopesForActor(scopes, {
  actorId: 'therapist-2',
  actorRole: 'therapist',
  professionalLinks: [activeWriteLink]
});
assert.deepEqual(
  therapistScopes.map((scope) => scope.id),
  ['scope-psychology'],
  'terapeuta só vê o escopo do qual participa'
);

const therapistPrograms = filterTherapeuticPlanProgramsForActor(
  programs,
  scopes,
  {
    actorId: 'therapist-2',
    actorRole: 'therapist',
    professionalLinks: [activeWriteLink]
  }
);
assert.deepEqual(
  therapistPrograms.map((program) => program.id),
  ['program-psychology', 'program-legacy'],
  'programa sem escopo continua legível apenas para seu profissional como compatibilidade histórica'
);

assert.equal(
  canEditTherapeuticPlanScope(scopes[0], {
    actorId: 'therapist-2',
    actorRole: 'therapist',
    professionalLinks: [activeWriteLink]
  }),
  true
);
assert.equal(
  canEditTherapeuticPlanScope(scopes[0], {
    actorId: 'therapist-2',
    actorRole: 'therapist',
    professionalLinks: [
      { ...activeWriteLink, permissions: { read: true, write: false } }
    ]
  }),
  false,
  'write:false impede edição'
);
assert.equal(
  canEditTherapeuticPlanScope(scopes[0], {
    actorId: 'therapist-2',
    actorRole: 'therapist',
    professionalLinks: [
      { ...activeWriteLink, permissions: { read: true } }
    ]
  }),
  true,
  'ausência de write preserva a compatibilidade do contrato atual'
);
assert.equal(
  canEditTherapeuticPlanScope(scopes[0], {
    actorId: 'therapist-2',
    actorRole: 'therapist',
    professionalLinks: [
      { ...activeWriteLink, status: 'ended' }
    ]
  }),
  false,
  'vínculo encerrado nunca permite editar o plano atual'
);
assert.equal(
  canEditTherapeuticPlanScope(scopes[0], {
    actorId: 'therapist-4',
    actorRole: 'therapist',
    professionalLinks: [
      { ...activeWriteLink, professional_id: 'therapist-4' }
    ]
  }),
  false,
  'vínculo com write não substitui a participação no escopo'
);
assert.equal(
  canEditTherapeuticPlanScope(scopes[1], {
    actorId: 'coordinator-1',
    actorRole: 'coordinator'
  }),
  true,
  'gestores preservam a edição'
);

const endedScopeVisibility = filterTherapeuticPlanScopesForActor(scopes, {
  actorId: 'therapist-2',
  actorRole: 'therapist',
  professionalLinks: [
    { ...activeWriteLink, status: 'ended' }
  ]
});
assert.deepEqual(
  endedScopeVisibility,
  [],
  'vínculo encerrado preserva somente versões históricas, não o plano atual'
);

assert.deepEqual(
  filterTherapeuticPlanProgramsForActor(programs, scopes, {
    actorId: 'receptionist-1',
    actorRole: 'receptionist',
    professionalLinks: []
  }),
  [],
  'papéis não clínicos não recebem programas pela filtragem'
);

const membershipAuthorityMigration = fs.readFileSync(
  'supabase/migrations/20260730030000_therapeutic_plan_membership_authority.sql',
  'utf8'
);
const objectiveAuthorityHelper = membershipAuthorityMigration.slice(
  membershipAuthorityMigration.indexOf(
    'public.therapeutic_objective_actor_can_access_v1'
  ),
  membershipAuthorityMigration.indexOf(
    'revoke all on function\n  public.therapeutic_plan_current_actor_can_access_v1'
  )
);
assert.match(membershipAuthorityMigration, /^\s*--[\s\S]*?\nbegin;/i);
assert.match(membershipAuthorityMigration, /\ncommit;\s*$/i);
assert.match(
  membershipAuthorityMigration,
  /clinic_membership_current_actor_can_manage_v1\(uuid\)/
);
assert.match(
  membershipAuthorityMigration,
  /patient_professional_link_current_actor_can_read_v1\(uuid,text,text,jsonb,text,text\)/
);
assert.match(
  membershipAuthorityMigration,
  /patient_therapeutic_plans_tenant_select[\s\S]*?'read'/
);
assert.match(
  membershipAuthorityMigration,
  /patient_therapeutic_plans_tenant_insert_v2[\s\S]*?'write'/
);
assert.match(
  membershipAuthorityMigration,
  /patient_therapeutic_plans_tenant_update_v2[\s\S]*?'write'/
);
assert.match(
  membershipAuthorityMigration,
  /p_plan_id uuid[\s\S]*?join public\.patient_therapeutic_plans plan[\s\S]*?plan\.id = p_plan_id[\s\S]*?link\.status = 'ended'[\s\S]*?historicalRead[\s\S]*?p_version_created_at <= link\.updated_at[\s\S]*?at time zone 'America\/Sao_Paulo'[\s\S]*?::date <= link\.ends_at/
);
assert.match(
  membershipAuthorityMigration,
  /revoke delete on table public\.patient_therapeutic_plans[\s\S]*?from authenticated/
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /create policy patient_therapeutic_plans[^\n]*delete/i,
  'planos terapeuticos versionados nao podem ser excluidos pelo cliente'
);
assert.match(
  membershipAuthorityMigration,
  /group by plan\.organization_id, plan\.patient_id[\s\S]*?having count\(\*\) > 1[\s\S]*?THERAPEUTIC_PLAN_INTERDISCIPLINARY_ACTIVE_DUPLICATE/
);
assert.match(
  membershipAuthorityMigration,
  /idx_therapeutic_plan_active_interdisciplinary_v2[\s\S]*?mode = 'interdisciplinary'[\s\S]*?status in \('draft', 'active', 'paused'\)/
);
assert.match(
  membershipAuthorityMigration,
  /add column if not exists idempotency_key text,[\s\S]*?add column if not exists request_hash text/
);
assert.match(
  membershipAuthorityMigration,
  /patient_therapeutic_plans_idempotency_contract_v2[\s\S]*?\^\[0-9a-f\]\{64\}\$/
);
assert.match(
  membershipAuthorityMigration,
  /idx_therapeutic_plan_idempotency_v2[\s\S]*?organization_id,[\s\S]*?idempotency_key[\s\S]*?where idempotency_key is not null/
);
assert.match(
  membershipAuthorityMigration,
  /snapshot_patient_therapeutic_plan_version_v2[\s\S]*?on conflict \(plan_id, version\) do nothing[\s\S]*?create trigger snapshot_patient_therapeutic_plan_version_v2[\s\S]*?after insert or update on public\.patient_therapeutic_plans/,
);
assert.match(
  membershipAuthorityMigration,
  /idx_aba_programs_therapeutic_objective_scope_v2[\s\S]*?therapeutic_objective_id[\s\S]*?patient_id/
);
assert.match(
  membershipAuthorityMigration,
  /aba_programs_tenant_select_v2[\s\S]*?therapeutic_program_row_actor_can_access_v1[\s\S]*?'read'/
);
assert.match(
  membershipAuthorityMigration,
  /aba_programs_tenant_insert_v2[\s\S]*?therapeutic_program_row_actor_can_access_v1[\s\S]*?'write'/
);
assert.match(
  membershipAuthorityMigration,
  /aba_programs_tenant_update_v2[\s\S]*?therapeutic_program_row_actor_can_access_v1[\s\S]*?'write'/
);
assert.match(
  membershipAuthorityMigration,
  /aba_targets_tenant_select_v2[\s\S]*?therapeutic_target_row_actor_can_access_v1[\s\S]*?'read'/
);
assert.match(
  membershipAuthorityMigration,
  /aba_targets_tenant_update_v2[\s\S]*?therapeutic_target_row_actor_can_access_v1[\s\S]*?'write'/
);
assert.match(
  membershipAuthorityMigration,
  /patient_therapeutic_objectives_tenant_select_v2[\s\S]*?therapeutic_objective_actor_can_access_v1[\s\S]*?'read'/
);
assert.match(
  membershipAuthorityMigration,
  /patient_therapeutic_objectives_tenant_insert_v2[\s\S]*?therapeutic_objective_actor_can_access_v1[\s\S]*?'write'/
);
assert.match(
  objectiveAuthorityHelper,
  /exists \([\s\S]*?from public\.aba_programs program[\s\S]*?therapeutic_program_row_actor_can_access_v1/
);
assert.doesNotMatch(
  objectiveAuthorityHelper,
  /not exists \([\s\S]*?from public\.aba_programs/,
  'objetivo sem programa visível não deve vazar para o terapeuta'
);
assert.match(
  membershipAuthorityMigration,
  /aba_program_versions_tenant_select_v2[\s\S]*?therapeutic_program_actor_can_access_v1[\s\S]*?'read'/
);
assert.match(
  membershipAuthorityMigration,
  /aba_program_audit_events_tenant_select_v2[\s\S]*?therapeutic_program_actor_can_access_v1[\s\S]*?'read'/
);
assert.match(
  membershipAuthorityMigration,
  /table_name = 'aba_programs'[\s\S]*?'therapeutic_plan_id'[\s\S]*?'therapeutic_objective_id'/
);
assert.match(
  membershipAuthorityMigration,
  /table_name = 'aba_targets'[\s\S]*?'program_id'/
);
assert.match(
  membershipAuthorityMigration,
  /table_name = 'patient_therapeutic_objectives'[\s\S]*?'created_by'/
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /\bdelete\s+from\b/i,
  'a migration de autoridade não pode apagar registros'
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /\baba_trials\b/i,
  'a dimensão de trials ABA permanece fora desta policy cirúrgica'
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /\bprofessional_profiles\b/i,
  'especialidade não deve ser usada como autoridade de acesso ao plano'
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /\bfrom public\.users\b/i,
  'papéis clínicos devem vir de clinic_memberships, não de users.clinic_id'
);

console.log('therapeuticPlanAccess.test.ts: ok');
