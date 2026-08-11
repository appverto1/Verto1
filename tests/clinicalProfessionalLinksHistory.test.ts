import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PATIENT_PROFESSIONAL_CASE_ROLE_OPTIONS,
  composePatientProfessionalLinks,
  executeAuthorizedPatientProfessionalLinkEnd,
  isEligiblePatientProfessionalLinkCandidate,
  isPatientProfessionalCaseRole,
  isPatientProfessionalLinkManager,
  patientProfessionalCaseRoleLabel,
  resolvePatientProfessionalLinkIntegrity,
  resolveProfessionalProfileSpecialty,
  validatePatientProfessionalCandidate
} from '../src/utils/patientProfessionalLinks.ts';
import {
  evaluatePatientClinicalAccess,
  executeAuthorizedHistoryScoreMutation
} from '../src/utils/patientClinicalAccess.ts';
import {
  HISTORY_SCORE_MUTATION_SELECT,
  HISTORY_SCORE_MUTATION_SELECT_COLUMNS
} from '../src/utils/routeSchemaFallbacks.ts';
import { formatDateInAppointmentTimezone } from '../src/utils/scheduling.ts';

const server = fs.readFileSync('server.ts', 'utf8');
const panel = fs.readFileSync(
  'src/components/PatientProfessionalLinksPanel.tsx',
  'utf8'
);
const app = fs.readFileSync('src/App.tsx', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260730010000_clinic_memberships_non_recursive_policies.sql',
  'utf8'
);
const membershipAuthorityMigration = fs.readFileSync(
  'supabase/migrations/20260730020000_patient_professional_links_membership_authority.sql',
  'utf8'
);

const clinicId = '11111111-1111-4111-8111-111111111111';
const otherClinicId = '22222222-2222-4222-8222-222222222222';
const patientId = '33333333-3333-4333-8333-333333333333';
const professionalId = '44444444-4444-4444-8444-444444444444';
const otherProfessionalId = '55555555-5555-4555-8555-555555555555';

const activeLink = {
  id: '66666666-6666-4666-8666-666666666666',
  organization_id: clinicId,
  clinic_id: clinicId,
  patient_id: patientId,
  professional_id: professionalId,
  specialty: 'Psicologia',
  case_role: 'primary_therapist',
  relationship_type: 'primary',
  starts_at: '2026-07-30',
  ends_at: null,
  status: 'active',
  permissions: { read: true, write: true, historicalRead: true }
};
const currentUser = {
  id: professionalId,
  name: 'Profissional da clínica',
  email: 'profissional@example.test',
  role: 'therapist',
  clinic_id: clinicId
};
const currentProfile = {
  user_id: professionalId,
  specialty: 'Psicologia',
  council: 'CRP',
  council_number: '00000',
  profile_photo_url: '/api/storage/patient-photos/view?path=professionals%2Fprofile.webp'
};
const activeMembership = {
  user_id: professionalId,
  clinic_id: clinicId,
  role: 'therapist',
  status: 'active'
};
const eligibleProfessional = {
  id: professionalId,
  name: 'Profissional elegível',
  role: 'therapist',
  status: 'active',
  specialty: 'Psicologia'
};

const activeResult = composePatientProfessionalLinks({
  clinicId,
  links: [activeLink],
  users: [currentUser],
  profiles: [currentProfile],
  memberships: [activeMembership]
});
assert.equal(activeResult.links.length, 1, '1. vínculo ativo válido deve aparecer');
assert.equal(activeResult.activeCount, 1);
assert.equal(activeResult.links[0].professional?.id, professionalId);
assert.equal(
  activeResult.links[0].professional?.profile_photo_url,
  currentProfile.profile_photo_url,
  'a foto do cadastro profissional deve acompanhar o vínculo autorizado'
);
assert.equal(activeResult.links[0].specialty, 'Psicologia');
const staleActiveSpecialtyResult = composePatientProfessionalLinks({
  clinicId,
  links: [{ ...activeLink, specialty: 'Fonoaudiologia' }],
  users: [currentUser],
  profiles: [currentProfile],
  memberships: [activeMembership]
});
assert.equal(
  staleActiveSpecialtyResult.links[0].specialty,
  'Psicologia',
  'vínculo ativo sempre deve exibir a especialidade canônica atual do perfil profissional'
);
assert.equal(activeResult.links[0].integrityStatus, null);
assert.equal(activeResult.links[0].accessEnabled, true);
assert.equal(activeResult.links[0].canBeEnded, true);

for (const legacyClinicId of [clinicId, null, otherClinicId]) {
  const result = composePatientProfessionalLinks({
    clinicId,
    links: [activeLink],
    users: [{ ...currentUser, clinic_id: legacyClinicId }],
    profiles: [currentProfile],
    memberships: [activeMembership]
  });
  assert.equal(
    result.links[0].accessEnabled,
    true,
    `membership ativa é canônica quando users.clinic_id=${String(legacyClinicId)}`
  );
  const candidate = validatePatientProfessionalCandidate({
    clinicId,
    professionalId,
    user: { ...currentUser, clinic_id: legacyClinicId },
    membership: activeMembership,
    profile: currentProfile
  });
  assert.deepEqual(candidate, {
    ok: true,
    specialty: 'Psicologia'
  });
}

const emptyResult = composePatientProfessionalLinks({
  clinicId,
  links: [],
  users: [],
  profiles: [],
  memberships: []
});
assert.deepEqual(emptyResult.links, [], '2. paciente sem vínculo retorna lista válida vazia');

const endedLink = {
  ...activeLink,
  id: '77777777-7777-4777-8777-777777777777',
  specialty: 'Especialidade histórica',
  case_role: 'Função histórica livre',
  relationship_type: 'collaborator',
  status: 'ended',
  ends_at: '2026-07-29'
};
const endedResult = composePatientProfessionalLinks({
  clinicId,
  links: [endedLink],
  users: [currentUser],
  profiles: [{ ...currentProfile, specialty: 'Especialidade atual' }],
  memberships: [{ ...activeMembership, status: 'inactive' }]
});
assert.equal(endedResult.links.length, 1, '3. vínculo encerrado continua legível');
assert.equal(
  endedResult.links[0].specialty,
  'Especialidade histórica',
  'snapshot histórico não pode ser sobrescrito pelo perfil atual'
);
assert.equal(
  patientProfessionalCaseRoleLabel('Função histórica livre'),
  'Função histórica livre',
  '18. valor histórico livre continua legível'
);
assert.equal(endedResult.links[0].integrityStatus, null);
assert.equal(endedResult.links[0].accessEnabled, false);
assert.equal(endedResult.links[0].canBeEnded, false);

const otherTenantResult = composePatientProfessionalLinks({
  clinicId,
  links: [{ ...activeLink, professional_id: otherProfessionalId }],
  users: [{
    ...currentUser,
    id: otherProfessionalId,
    clinic_id: otherClinicId
  }],
  profiles: [{ ...currentProfile, user_id: otherProfessionalId }],
  memberships: [{
    ...activeMembership,
    user_id: otherProfessionalId,
    clinic_id: otherClinicId
  }]
});
assert.equal(
  otherTenantResult.links.length,
  1,
  '4. vínculo inconsistente continua visível para saneamento'
);
assert.equal(otherTenantResult.links[0].integrityStatus, 'tenant_mismatch');
assert.equal(otherTenantResult.links[0].accessEnabled, false);
assert.equal(otherTenantResult.links[0].canBeEnded, true);
assert.equal(otherTenantResult.links[0].professional, null);
assert.equal(
  otherTenantResult.links[0].specialty,
  activeLink.specialty,
  'nenhum dado do profile de outro tenant substitui o snapshot do vínculo'
);
assert.equal(otherTenantResult.activeCount, 1);

const inactiveMembershipResult = composePatientProfessionalLinks({
  clinicId,
  links: [activeLink],
  users: [currentUser],
  profiles: [currentProfile],
  memberships: [{ ...activeMembership, status: 'inactive' }]
});
assert.equal(
  inactiveMembershipResult.links.length,
  1,
  '5. membership inativa não oculta o vínculo ativo'
);
assert.equal(
  inactiveMembershipResult.links[0].integrityStatus,
  'membership_inactive'
);
assert.equal(inactiveMembershipResult.links[0].accessEnabled, false);
assert.equal(inactiveMembershipResult.links[0].canBeEnded, true);
assert.equal(inactiveMembershipResult.activeCount, 1);

const missingProfileResult = composePatientProfessionalLinks({
  clinicId,
  links: [activeLink],
  users: [currentUser],
  profiles: [],
  memberships: [activeMembership]
});
assert.equal(missingProfileResult.links.length, 1, '6. vínculo já existente preserva o snapshot sem perfil');
assert.equal(missingProfileResult.links[0].professional?.profileAvailable, false);
assert.equal(missingProfileResult.links[0].integrityStatus, 'profile_missing');
assert.equal(missingProfileResult.links[0].accessEnabled, false);
assert.equal(resolveProfessionalProfileSpecialty({}), '', '7. perfil sem especialidade é indisponível');
const shortSpecialtyResult = composePatientProfessionalLinks({
  clinicId,
  links: [activeLink],
  users: [currentUser],
  profiles: [{ ...currentProfile, specialty: 'X' }],
  memberships: [activeMembership]
});
assert.equal(shortSpecialtyResult.links[0].integrityStatus, 'profile_missing');
assert.equal(shortSpecialtyResult.links[0].accessEnabled, false);

const missingProfessionalResult = composePatientProfessionalLinks({
  clinicId,
  links: [activeLink],
  users: [],
  profiles: [currentProfile],
  memberships: [activeMembership]
});
assert.equal(
  missingProfessionalResult.links[0].integrityStatus,
  'professional_missing'
);
assert.equal(missingProfessionalResult.links[0].accessEnabled, false);
assert.equal(missingProfessionalResult.activeCount, 1);

assert.deepEqual(
  validatePatientProfessionalCandidate({
    clinicId,
    professionalId,
    user: currentUser,
    membership: null,
    profile: currentProfile
  }),
  {
    ok: false,
    error: 'PATIENT_PROFESSIONAL_MEMBERSHIP_INACTIVE'
  }
);
assert.deepEqual(
  validatePatientProfessionalCandidate({
    clinicId,
    professionalId,
    user: currentUser,
    membership: { ...activeMembership, clinic_id: otherClinicId },
    profile: currentProfile
  }),
  {
    ok: false,
    error: 'PATIENT_PROFESSIONAL_MEMBERSHIP_INACTIVE'
  }
);
assert.deepEqual(
  validatePatientProfessionalCandidate({
    clinicId,
    professionalId,
    user: currentUser,
    membership: { ...activeMembership, role: 'coordinator' },
    profile: currentProfile
  }),
  {
    ok: false,
    error: 'PATIENT_PROFESSIONAL_MEMBERSHIP_INACTIVE'
  }
);
assert.deepEqual(
  validatePatientProfessionalCandidate({
    clinicId,
    professionalId,
    user: currentUser,
    membership: activeMembership,
    profile: null
  }),
  {
    ok: false,
    error: 'PATIENT_PROFESSIONAL_PROFILE_REQUIRED'
  }
);
assert.deepEqual(
  validatePatientProfessionalCandidate({
    clinicId,
    professionalId,
    user: currentUser,
    membership: activeMembership,
    profile: { ...currentProfile, specialty: ' ' }
  }),
  {
    ok: false,
    error: 'PATIENT_PROFESSIONAL_SPECIALTY_REQUIRED'
  }
);
assert.deepEqual(
  validatePatientProfessionalCandidate({
    clinicId,
    professionalId,
    user: null,
    membership: activeMembership,
    profile: currentProfile
  }),
  {
    ok: false,
    error: 'PATIENT_PROFESSIONAL_NOT_FOUND'
  }
);
assert.equal(
  resolvePatientProfessionalLinkIntegrity({
    clinicId,
    professionalId,
    link: { ...activeLink, clinic_id: otherClinicId },
    user: currentUser,
    membership: activeMembership,
    profile: currentProfile
  }),
  'tenant_mismatch'
);

assert.equal(activeResult.links[0].relationship_type, 'primary', '9. vínculo principal é preservado');
assert.equal(isPatientProfessionalCaseRole('case_coordinator'), true);
assert.equal(isPatientProfessionalCaseRole('primary_therapist'), true);
assert.equal(isPatientProfessionalCaseRole('therapist'), true);
assert.equal(isPatientProfessionalCaseRole('supervisor'), true);
assert.equal(isPatientProfessionalCaseRole('consultant'), true);
assert.equal(isPatientProfessionalCaseRole('Outro texto'), false);
assert.equal(PATIENT_PROFESSIONAL_CASE_ROLE_OPTIONS.length, 5);

assert.equal(
  isEligiblePatientProfessionalLinkCandidate(eligibleProfessional),
  true,
  'therapist ativo com especialidade é elegível'
);
assert.equal(
  isEligiblePatientProfessionalLinkCandidate({
    ...eligibleProfessional,
    specialty: ''
  }),
  false,
  'therapist sem especialidade não é elegível'
);
assert.equal(
  isEligiblePatientProfessionalLinkCandidate({
    ...eligibleProfessional,
    specialty: 'X'
  }),
  false,
  'especialidade com um caractere não é elegível'
);
assert.equal(
  isEligiblePatientProfessionalLinkCandidate({
    ...eligibleProfessional,
    status: 'inactive'
  }),
  false,
  'therapist inativo não é elegível'
);
assert.equal(
  isEligiblePatientProfessionalLinkCandidate({
    ...eligibleProfessional,
    role: 'coordinator'
  }),
  false,
  'coordinator não é elegível'
);
assert.equal(
  isEligiblePatientProfessionalLinkCandidate({
    ...eligibleProfessional,
    role: 'receptionist'
  }),
  false,
  'receptionist não é elegível'
);
assert.equal(
  isEligiblePatientProfessionalLinkCandidate(
    eligibleProfessional,
    new Set([professionalId])
  ),
  false,
  'profissional já vinculado não é elegível'
);

const coordinatorMembership = {
  user_id: otherProfessionalId,
  clinic_id: clinicId,
  role: 'coordinator',
  status: 'active'
};
assert.equal(
  isPatientProfessionalLinkManager({
    actorId: otherProfessionalId,
    actorRole: 'therapist',
    clinicId,
    membership: coordinatorMembership
  }),
  true,
  'membership coordinator autoriza gestão sem depender de users.role'
);
assert.equal(
  isPatientProfessionalLinkManager({
    actorId: otherProfessionalId,
    actorRole: 'coordinator',
    clinicId,
    membership: { ...coordinatorMembership, status: 'inactive' }
  }),
  false
);
assert.equal(
  isPatientProfessionalLinkManager({
    actorId: otherProfessionalId,
    actorRole: 'owner',
    clinicId,
    membership: null
  }),
  true
);
let endPersistCount = 0;
const deniedEnd = await executeAuthorizedPatientProfessionalLinkEnd({
  isManager: false,
  persist: async () => {
    endPersistCount += 1;
    return { ended: true };
  }
});
assert.equal(deniedEnd.ok, false);
assert.equal(endPersistCount, 0);
const allowedEnd = await executeAuthorizedPatientProfessionalLinkEnd({
  isManager: true,
  persist: async () => {
    endPersistCount += 1;
    return { ended: true };
  }
});
assert.equal(allowedEnd.ok, true);
assert.equal(endPersistCount, 1, 'gestor executa exatamente um encerramento');

const accessFacts = {
  actorId: professionalId,
  actorRole: 'therapist',
  actorClinicId: clinicId,
  patientId,
  patientClinicId: clinicId,
  legacyTherapistId: null,
  requiredPermission: 'write' as const,
  activeProfessionalLink: activeLink,
  activeProfessionalMembership: activeMembership,
  activeProfessionalProfile: currentProfile
};
assert.equal(
  evaluatePatientClinicalAccess(accessFacts),
  true,
  'therapist com write true pode alterar a estrelinha'
);
const writeFalseAccess = evaluatePatientClinicalAccess({
  ...accessFacts,
  activeProfessionalLink: {
    ...activeLink,
    permissions: { read: true, write: false }
  }
});
assert.equal(writeFalseAccess, false, 'therapist com write false recebe negação');
const matchingEmailWithoutLinkAccess = evaluatePatientClinicalAccess({
  ...accessFacts,
  activeProfessionalLink: null,
  patientEmail: 'mesmo-email@example.test'
} as any);
assert.equal(
  matchingEmailWithoutLinkAccess,
  false,
  'e-mail coincidente não concede escrita sem vínculo'
);
const receptionistAccess = evaluatePatientClinicalAccess({
  ...accessFacts,
  actorRole: 'receptionist',
  activeProfessionalLink: null
});
assert.equal(receptionistAccess, false, 'receptionist não pode alterar score');
assert.equal(
  evaluatePatientClinicalAccess({
    ...accessFacts,
    actorId: otherProfessionalId,
    actorRole: 'therapist',
    activeProfessionalLink: null,
    activeProfessionalMembership: null,
    activeProfessionalProfile: null,
    activeManagerMembership: {
      user_id: otherProfessionalId,
      clinic_id: clinicId,
      role: 'coordinator',
      status: 'active'
    }
  }),
  true,
  'membership coordinator ativa é a autoridade de gestão'
);
assert.equal(
  evaluatePatientClinicalAccess({
    ...accessFacts,
    actorId: otherProfessionalId,
    actorRole: 'coordinator',
    activeProfessionalLink: null,
    activeProfessionalMembership: null,
    activeProfessionalProfile: null,
    activeManagerMembership: {
      user_id: otherProfessionalId,
      clinic_id: clinicId,
      role: 'coordinator',
      status: 'inactive'
    }
  }),
  false,
  'coordinator sem membership ativa não recebe acesso'
);
assert.equal(
  evaluatePatientClinicalAccess({
    ...accessFacts,
    actorId: otherProfessionalId,
    actorRole: 'owner',
    activeProfessionalLink: null,
    activeProfessionalMembership: null,
    activeProfessionalProfile: null,
    activeManagerMembership: null
  }),
  false,
  'papel global owner/admin não concede bypass clínico'
);
assert.equal(
  evaluatePatientClinicalAccess({
    ...accessFacts,
    actorId: otherProfessionalId,
    actorRole: 'director',
    activeProfessionalLink: null,
    activeProfessionalMembership: null,
    activeProfessionalProfile: null,
    activeManagerMembership: {
      user_id: otherProfessionalId,
      clinic_id: clinicId,
      role: 'director',
      status: 'active'
    }
  }),
  true,
  'diretor com membership ativa recebe escopo clínico da unidade'
);
assert.equal(
  evaluatePatientClinicalAccess({
    ...accessFacts,
    actorId: otherProfessionalId,
    actorRole: 'supervisor',
    activeProfessionalLink: null,
    activeProfessionalMembership: {
      user_id: otherProfessionalId,
      clinic_id: clinicId,
      role: 'supervisor',
      status: 'active'
    },
    activeProfessionalProfile: null,
    activeManagerMembership: {
      user_id: otherProfessionalId,
      clinic_id: clinicId,
      role: 'supervisor',
      status: 'active'
    },
    activeSupervisionLink: {
      clinic_id: clinicId,
      supervisor_user_id: otherProfessionalId,
      patient_id: patientId,
      supervised_user_id: null,
      status: 'active'
    }
  }),
  true,
  'supervisor com vínculo explícito recebe acesso somente ao caso supervisionado'
);
assert.equal(
  evaluatePatientClinicalAccess({
    ...accessFacts,
    actorId: otherProfessionalId,
    actorRole: 'supervisor',
    activeProfessionalLink: null,
    activeProfessionalMembership: {
      user_id: otherProfessionalId,
      clinic_id: clinicId,
      role: 'supervisor',
      status: 'active'
    },
    activeProfessionalProfile: null,
    activeManagerMembership: null,
    activeSupervisionLink: null
  }),
  false,
  'supervisor sem vínculo de supervisão não acessa o prontuário'
);
const crossTenantAccess = evaluatePatientClinicalAccess({
  ...accessFacts,
  actorClinicId: otherClinicId,
  activeProfessionalLink: {
    ...activeLink,
    professional_id: professionalId
  }
});
assert.equal(crossTenantAccess, false, 'profissional de outro tenant recebe negação');
const mismatchedLinkClinicAccess = evaluatePatientClinicalAccess({
  ...accessFacts,
  activeProfessionalLink: {
    ...activeLink,
    clinic_id: otherClinicId
  }
});
assert.equal(
  mismatchedLinkClinicAccess,
  false,
  'clinic_id divergente no vínculo nunca concede acesso clínico'
);

const inactiveMembershipAccess = evaluatePatientClinicalAccess({
  ...accessFacts,
  legacyTherapistId: professionalId,
  activeProfessionalMembership: {
    ...activeMembership,
    status: 'inactive'
  }
});
assert.equal(
  inactiveMembershipAccess,
  false,
  'vínculo ativo inconsistente não usa therapist_id como bypass'
);
const missingProfileAccess = evaluatePatientClinicalAccess({
  ...accessFacts,
  legacyTherapistId: professionalId,
  activeProfessionalProfile: null
});
assert.equal(
  missingProfileAccess,
  false,
  'profile ausente bloqueia o vínculo mesmo quando therapist_id coincide'
);
assert.equal(
  evaluatePatientClinicalAccess({
    ...accessFacts,
    legacyTherapistId: professionalId,
    activeProfessionalLink: null,
    activeProfessionalMembership: null,
    activeProfessionalProfile: null
  }),
  false,
  'therapist_id não substitui membership quando o schema canônico existe'
);
assert.equal(
  evaluatePatientClinicalAccess({
    ...accessFacts,
    legacyTherapistId: professionalId,
    activeProfessionalLink: null
  }),
  true,
  'therapist_id legado permanece compatível com membership e profile válidos'
);

let deniedWriteCount = 0;
for (const hasWriteAccess of [
  writeFalseAccess,
  matchingEmailWithoutLinkAccess,
  receptionistAccess,
  crossTenantAccess,
  mismatchedLinkClinicAccess,
  inactiveMembershipAccess,
  missingProfileAccess
]) {
  const deniedMutation = await executeAuthorizedHistoryScoreMutation({
    hasWriteAccess,
    recordType: 'family_note',
    requestedScore: 1,
    persist: async () => {
      deniedWriteCount += 1;
      return { persisted: true };
    }
  });
  assert.equal(deniedMutation.ok, false);
  assert.equal(deniedMutation.status, 403);
}
assert.equal(
  deniedWriteCount,
  0,
  'nenhuma gravação ocorre quando o acesso é negado'
);
let allowedWriteCount = 0;
const allowedMutation = await executeAuthorizedHistoryScoreMutation({
  hasWriteAccess: evaluatePatientClinicalAccess(accessFacts),
  recordType: 'family_note',
  requestedScore: 1,
  persist: async (score) => {
    allowedWriteCount += 1;
    return { score };
  }
});
assert.equal(allowedMutation.ok, true);
assert.equal(allowedWriteCount, 1);
if (allowedMutation.ok) assert.equal(allowedMutation.result.score, 1);

const lateBrazilInstant = new Date('2026-07-31T01:30:00.000Z');
assert.equal(
  formatDateInAppointmentTimezone(
    lateBrazilInstant,
    'America/Sao_Paulo'
  ),
  '2026-07-30',
  '30/07/2026 às 22:30 em São Paulo permanece no dia civil correto'
);

const getLinksStart = server.indexOf("'/api/patients/:patientId/professional-links'");
const postLinksStart = server.indexOf(
  "'/api/patients/:patientId/professional-links'",
  getLinksStart + 1
);
const getLinksSource = server.slice(getLinksStart, postLinksStart);
assert.ok(getLinksStart >= 0 && postLinksStart > getLinksStart);
assert.doesNotMatch(getLinksSource, /users[\s\S]*?metadata/, '10. GET não consulta users.metadata');
assert.equal(
  (getLinksSource.match(/\.from\('/g) || []).length,
  4,
  '11. GET usa quatro consultas em lote fixas, sem N+1'
);
assert.doesNotMatch(getLinksSource, /for\s*\([^)]*professional|forEach\s*\([^)]*professional[\s\S]*?\.from\('/);
assert.match(getLinksSource, /\.in\('id', professionalIds\)/);
assert.match(getLinksSource, /\.in\('user_id', professionalIds\)/);
const usersBatchStart = getLinksSource.indexOf(".from('users')");
const profilesBatchStart = getLinksSource.indexOf(
  ".from('professional_profiles')",
  usersBatchStart
);
const usersBatchSource = getLinksSource.slice(
  usersBatchStart,
  profilesBatchStart
);
assert.match(usersBatchSource, /\.select\(usersSelect\)/);
assert.doesNotMatch(usersBatchSource, /\.eq\('clinic_id'/);
assert.doesNotMatch(usersBatchSource, /\.eq\('role'/);
assert.match(getLinksSource, /const usersSelect = 'id,name,email'/);
assert.match(getLinksSource, /canInspectInconsistentLinks/);
assert.match(getLinksSource, /stage,/);
assert.match(getLinksSource, /table,/);
assert.match(getLinksSource, /select/);
assert.match(getLinksSource, /requestId: requestIdForLogs\(req\)/, '12. log registra stage e requestId');
assert.match(getLinksSource, /PATIENT_PROFESSIONAL_LINKS_UNAVAILABLE/);
assert.match(
  getLinksSource,
  /res\.status\(isMissingRelationError\(error\) \? 503 : 500\)/
);
assert.doesNotMatch(
  getLinksSource.slice(getLinksSource.indexOf('catch')),
  /details:|hint:|message:/,
  '13. resposta pública do erro não expõe detalhes internos'
);
const patientAccessStart = server.indexOf('const checkPatientAccess = async');
const patientAccessEnd = server.indexOf("app.get('/api/config'", patientAccessStart);
const patientAccessSource = server.slice(patientAccessStart, patientAccessEnd);
assert.match(patientAccessSource, /loadPatientProfessionalAccessEvidence/);
assert.match(patientAccessSource, /evaluatePatientClinicalAccess/);
assert.doesNotMatch(
  patientAccessSource,
  /if \(patient\.therapist_id === user\.id\)/
);
assert.match(
  patientAccessSource,
  /activeProfessionalProfile: evidence\.activeProfessionalProfile/
);
assert.match(
  patientAccessSource,
  /req\.resolvedPatientClinicId = sanitizeString\(patient\.clinic_id, 120\);[\s\S]*?if \(globalClinicAccess\) return next\(\)/
);

const postLinksEnd = server.indexOf(
  "'/api/patients/:patientId/professional-links/:linkId/end'",
  postLinksStart
);
const postLinksSource = server.slice(postLinksStart, postLinksEnd);
assert.doesNotMatch(
  postLinksSource.slice(0, postLinksSource.indexOf('async (req')),
  /requireRoles/,
  'POST depende da membership validada, não do users.role da sessão'
);
assert.match(postLinksSource, /professionalId = sanitizeString/);
assert.match(postLinksSource, /isPatientProfessionalCaseRole\(caseRole\)/);
assert.doesNotMatch(postLinksSource, /req\.body\?\.specialty/, 'backend não aceita specialty do navegador');
assert.match(postLinksSource, /\.from\('clinic_memberships'\)[\s\S]*?\.eq\('status', 'active'\)/);
assert.match(postLinksSource, /\.from\('professional_profiles'\)[\s\S]*?\.select\(select\)/);
assert.match(postLinksSource, /validatePatientProfessionalCandidate/);
assert.match(postLinksSource, /p_specialty: specialty/);
assert.match(postLinksSource, /PATIENT_PROFESSIONAL_LINK_DUPLICATE/, '8. duplicidade permanece tratada');
assert.match(
  postLinksSource,
  /startsAt[\s\S]*?dateGroupForClinic\(new Date\(\), req\.session\.user\)/,
  'backend usa a data civil da clínica quando startsAt não é enviado'
);
const endLinksStart = postLinksEnd;
const endLinksEnd = server.indexOf(
  "app.post('/api/patient-anamnesis/:patientId'",
  endLinksStart
);
const endLinksSource = server.slice(endLinksStart, endLinksEnd);
assert.doesNotMatch(
  endLinksSource.slice(0, endLinksSource.indexOf('async (req')),
  /requireRoles/,
  'encerramento depende da membership validada e do RPC'
);
assert.match(
  endLinksSource,
  /p_ends_at[\s\S]*?dateGroupForClinic\(new Date\(\), req\.session\.user\)/,
  'backend usa a data civil da clínica quando endsAt não é enviado'
);
assert.match(endLinksSource, /executeAuthorizedPatientProfessionalLinkEnd/);
assert.match(endLinksSource, /isPatientProfessionalLinkManager/);
assert.match(
  endLinksSource,
  /\.from\('clinic_memberships'\)[\s\S]*?\.eq\('role', 'coordinator'\)[\s\S]*?\.eq\('status', 'active'\)/
);
assert.doesNotMatch(
  `${postLinksSource}\n${endLinksSource}`,
  /toISOString\(\)\.slice\(0,\s*10\)/,
  'fallback server-side dos vínculos não usa o dia UTC'
);

assert.match(panel, /value=\{draft\.professionalId\}/, '14. profissional é selecionado por ID');
assert.match(panel, /selectedSpecialty/, '15. especialidade é preenchida pelo perfil');
assert.doesNotMatch(panel, /value=\{draft\.specialty\}/, '16. especialidade não é editável');
assert.match(panel, /PATIENT_PROFESSIONAL_CASE_ROLE_OPTIONS\.map/, '17. função usa opções controladas');
assert.match(panel, /isEligiblePatientProfessionalLinkCandidate/, '19. seletor usa a mesma elegibilidade testada');
assert.match(panel, /Nenhum terapeuta elegível disponível/);
assert.match(panel, /O acesso clínico está bloqueado/);
assert.equal(
  (panel.match(/currentClinicalDate\(\)/g) || []).length,
  2,
  'início e encerramento usam o mesmo helper de data civil'
);
assert.doesNotMatch(
  panel,
  /toISOString\(\)\.slice\(0,\s*10\)/,
  'painel não deriva data civil por UTC'
);

assert.equal(
  HISTORY_SCORE_MUTATION_SELECT_COLUMNS.includes('updated_at'),
  false,
  '22. select da estrelinha não inclui updated_at'
);
assert.equal(HISTORY_SCORE_MUTATION_SELECT_COLUMNS.includes('patient_email'), false);
assert.equal(HISTORY_SCORE_MUTATION_SELECT.includes('pro_score'), false);
const historyPatchStart = server.indexOf("app.patch('/api/history/:historyId'");
const historyPatchEnd = server.indexOf("app.delete('/api/history/:historyId'", historyPatchStart);
const historyPatchSource = server.slice(historyPatchStart, historyPatchEnd);
assert.match(historyPatchSource, /\.select\(HISTORY_SCORE_MUTATION_SELECT\)/);
assert.match(historyPatchSource, /\.update\(\{ score \}\)/, '20. PATCH persiste history.score');
assert.doesNotMatch(historyPatchSource, /HISTORY_SELECT\)/);
assert.doesNotMatch(historyPatchSource, /pro_score/, '23. PATCH não altera pro_score');
assert.doesNotMatch(
  historyPatchSource,
  /getClinicPatientIdsByEmail|hasEmailAccess|patient_email/,
  'mutação não possui fallback de autorização por e-mail'
);
assert.match(historyPatchSource, /Registro não encontrado/, '24. registro inexistente retorna 404');
assert.match(historyPatchSource, /canAccessPatientInCurrentClinic\([\s\S]*?'write'/, '26/27. PATCH exige write');
assert.match(historyPatchSource, /executeAuthorizedHistoryScoreMutation/);
assert.doesNotMatch(
  historyPatchSource.slice(0, historyPatchSource.indexOf('async (req')),
  /receptionist/,
  'middleware também recusa receptionist'
);
assert.match(app, /setHistory\(previousHistory\)/, '28. falha restaura o histórico otimista');
assert.match(app, /setTherapistNotes\(previousTherapistNotes\)/);
assert.ok(
  historyPatchSource.indexOf('.select(HISTORY_SCORE_MUTATION_SELECT)') <
    historyPatchSource.indexOf('executeAuthorizedHistoryScoreMutation'),
  '29. validação e leitura ocorrem antes da única gravação'
);

const migrationWithoutComments = migration.replace(/--.*$/gm, '').trim();
assert.match(migrationWithoutComments, /^begin\s*;/i);
assert.match(migrationWithoutComments, /notify pgrst,\s*'reload schema'\s*;\s*commit\s*;$/i);
const beginIndex = migrationWithoutComments.search(/^begin\s*;/i);
const commitIndex = migrationWithoutComments.search(/commit\s*;$/i);
const transactionBody = migrationWithoutComments.slice(beginIndex, commitIndex);
const policyNames = Array.from(
  transactionBody.matchAll(
    /create policy (clinic_memberships_(?:select|insert|update|delete)_v2)/gi
  ),
  (match) => match[1].toLowerCase()
).sort();
assert.deepEqual(policyNames, [
  'clinic_memberships_delete_v2',
  'clinic_memberships_insert_v2',
  'clinic_memberships_select_v2',
  'clinic_memberships_update_v2'
]);
assert.doesNotMatch(
  transactionBody,
  /^\s*(?:insert\s+into|update\s+(?:public\.)?[\w"]+|delete\s+from|merge\s+into|truncate(?:\s+table)?|copy\s+)/gim,
  'migration transacional não altera linhas'
);
assert.match(migration, /drop policy if exists clinic_memberships_access/);
assert.doesNotMatch(
  migration.slice(
    migration.indexOf('create policy clinic_memberships_select_v2'),
    migration.indexOf('create policy clinic_memberships_insert_v2')
  ),
  /from public\.clinic_memberships/,
  '30. policy SELECT não consulta a própria tabela'
);
assert.match(migration, /user_id = auth\.uid\(\)/, '31. usuário lê a própria membership');
assert.match(migration, /manager_membership\.role = 'coordinator'/, '32. coordenação ativa gerencia a clínica');
assert.match(migration, /for insert[\s\S]*?clinic_membership_current_actor_can_manage_v1/);
assert.match(migration, /for update[\s\S]*?clinic_membership_current_actor_can_manage_v1/);
assert.match(migration, /for delete[\s\S]*?clinic_membership_current_actor_can_manage_v1/);
assert.doesNotMatch(
  migration.slice(migration.indexOf('create policy clinic_memberships_insert_v2')),
  /user_id = auth\.uid\(\)/,
  '33. escrita não permite autoinscrição ou autoelevação'
);
assert.match(migration, /p_clinic_id uuid/);
assert.doesNotMatch(migration, /p_actor_id uuid/);
assert.match(
  migration,
  /clinic_membership_current_actor_is_global_v1\(\)[\s\S]*?actor\.id = auth\.uid\(\)/
);
assert.match(
  migration,
  /clinic_membership_current_actor_can_manage_v1\([\s\S]*?manager_membership\.user_id = auth\.uid\(\)/
);
assert.match(migration, /CLINIC_MEMBERSHIPS_UNKNOWN_POLICIES/);
assert.match(migration, /policyname not in \(/);
assert.match(
  migration,
  /drop function if exists[\s\S]*?clinic_membership_actor_can_manage_v1\(uuid, uuid\)/
);
assert.match(migration, /security definer/);
assert.match(migration, /set row_security = off/);
assert.match(migration, /notify pgrst, 'reload schema'/);
assert.doesNotMatch(migration, /tasks\./i, 'tasks permanece fora desta entrega');

const authorityWithoutComments = membershipAuthorityMigration
  .replace(/--.*$/gm, '')
  .trim();
assert.match(authorityWithoutComments, /^begin\s*;/i);
assert.match(
  authorityWithoutComments,
  /notify pgrst,\s*'reload schema'\s*;\s*commit\s*;$/i
);
const authorityTopLevel = authorityWithoutComments.replace(
  /as \$function\$[\s\S]*?\$function\$\s*;/g,
  ''
);
assert.doesNotMatch(
  authorityTopLevel,
  /^\s*(?:insert\s+into|update\s+(?:public\.)?[\w"]+|delete\s+from|merge\s+into|truncate(?:\s+table)?|copy\s+)/gim,
  'a migration nova não altera linhas existentes durante a aplicação'
);
assert.match(
  membershipAuthorityMigration,
  /create or replace function public\.upsert_patient_professional_link_v1\(\s*p_actor_id uuid,\s*p_patient_id uuid,\s*p_professional_id uuid,\s*p_specialty text,\s*p_case_role text,\s*p_relationship_type text,\s*p_starts_at date,\s*p_permissions jsonb,\s*p_replace_primary boolean default false\s*\)/s
);
assert.match(
  membershipAuthorityMigration,
  /create or replace function public\.end_patient_professional_link_v1\(\s*p_actor_id uuid,\s*p_link_id uuid,\s*p_patient_id uuid,\s*p_ends_at date default current_date\s*\)/s
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /\b(?:actor|professional)\.clinic_id\b/,
  'RPC não usa users.clinic_id como autoridade'
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /\bprofessional\.role\b/,
  'RPC não usa users.role como papel na clínica'
);
assert.match(
  membershipAuthorityMigration,
  /professional_membership\.clinic_id = patient_clinic_id[\s\S]*?professional_membership\.role = 'therapist'[\s\S]*?professional_membership\.status = 'active'/
);
assert.equal(
  (
    membershipAuthorityMigration.match(
      /from public\.clinic_memberships actor_membership[\s\S]*?actor_membership\.role = 'coordinator'[\s\S]*?actor_membership\.status = 'active'[\s\S]*?for share;/g
    ) || []
  ).length,
  2,
  'upsert e end bloqueiam a membership do coordenador durante a mutação'
);
assert.match(
  membershipAuthorityMigration,
  /select nullif\(trim\(profile\.specialty\), ''\)[\s\S]*?into resolved_specialty/
);
assert.equal(
  (
    membershipAuthorityMigration.match(
      /char_length\(nullif\(trim\(profile\.specialty\), ''\)\) >= 2/g
    ) || []
  ).length,
  2,
  'RLS e encerramento usam o mesmo mínimo de especialidade do motor'
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /trim\(p_specialty\)|left\(trim\(p_specialty\)/,
  'p_specialty legado não é fonte de verdade'
);
assert.match(
  membershipAuthorityMigration,
  /trim\(p_case_role\) not in \([\s\S]*?'case_coordinator'[\s\S]*?'primary_therapist'[\s\S]*?'therapist'[\s\S]*?'supervisor'[\s\S]*?'consultant'[\s\S]*?\)/,
  'RPC também restringe novos vínculos às funções controladas'
);
assert.match(
  membershipAuthorityMigration,
  /resolved_permissions := jsonb_build_object\([\s\S]*?'read'[\s\S]*?'write'[\s\S]*?'historicalRead'[\s\S]*?\)/,
  'RPC canonicaliza todas as permissões antes de persistir'
);
assert.match(
  membershipAuthorityMigration,
  /p_starts_at,[\s\S]*?resolved_permissions,[\s\S]*?p_actor_id::text/,
  'INSERT persiste o objeto canônico de permissões'
);
assert.match(
  membershipAuthorityMigration,
  /organization_id,[\s\S]*?clinic_id,[\s\S]*?values \(\s*patient_clinic_id::text,\s*patient_clinic_id::text/s
);
assert.match(
  membershipAuthorityMigration,
  /where link\.patient_id = p_patient_id\s+and link\.professional_id = p_professional_id::text\s+and link\.status = 'active'/
);
assert.match(
  membershipAuthorityMigration,
  /select count\(\*\)\s+into active_link_count[\s\S]*?where link\.patient_id = p_patient_id\s+and link\.status = 'active'/
);
assert.match(
  membershipAuthorityMigration,
  /perform public\.end_patient_professional_link_v1\(\s*p_actor_id,\s*primary_link\.id,\s*p_patient_id,\s*coalesce\(p_starts_at, current_date\)/
);
assert.match(
  membershipAuthorityMigration,
  /if link_integrity_valid\s+and ended_row\.permissions->'historicalRead' = 'true'::jsonb then/
);
assert.match(
  membershipAuthorityMigration,
  /patient_professional_link_current_actor_can_read_v1/
);
assert.match(
  membershipAuthorityMigration,
  /patient_professional_link_current_actor_can_manage_v1/
);
assert.match(
  membershipAuthorityMigration,
  /drop policy if exists patient_professional_links_tenant_write[\s\S]*?revoke insert, update, delete[\s\S]*?from public, anon, authenticated/
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /create policy patient_professional_links_tenant_write/,
  'mutação autenticada ocorre apenas pelos RPCs validados'
);
assert.doesNotMatch(
  membershipAuthorityMigration.slice(
    membershipAuthorityMigration.indexOf(
      'create policy patient_professional_links_tenant_select'
    )
  ),
  /users\.clinic_id|actor\.clinic_id/
);
assert.match(
  membershipAuthorityMigration,
  /idx_patient_professional_links_active_patient_professional_v2/
);
assert.doesNotMatch(
  membershipAuthorityMigration,
  /tasks\./i,
  'tasks permanece fora da migration de autoridade'
);

console.log('clinicalProfessionalLinksHistory.test.ts: ok');
