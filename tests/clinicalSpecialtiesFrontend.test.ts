import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CLINICAL_SPECIALTY_OPTIONS,
  DEFAULT_CLINICAL_SPECIALTY,
  getClinicalSpecialtyOptions,
  normalizeClinicalSpecialty,
  readClinicalSpecialtyFromSource,
} from '../src/utils/clinicalSpecialties';

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
] as const;

assert.deepEqual(
  CLINICAL_SPECIALTY_OPTIONS,
  EXPECTED_SPECIALTIES,
  'novos cadastros devem usar somente as nove especialidades clínicas canônicas',
);
assert.equal(new Set(CLINICAL_SPECIALTY_OPTIONS).size, 9);
assert.equal(DEFAULT_CLINICAL_SPECIALTY, 'Psicoterapeuta');
assert.equal(
  normalizeClinicalSpecialty('  fonoaudiólogo  '),
  'Fonoaudiólogo',
);
assert.equal(
  normalizeClinicalSpecialty('TERAPEUTA OCUPACIONAL'),
  'Terapeuta Ocupacional',
);
assert.equal(
  normalizeClinicalSpecialty('Psicólogo'),
  null,
  'um valor legado não pode ser reclassificado silenciosamente',
);
assert.equal(
  readClinicalSpecialtyFromSource({
    specialty: 'Fisioterapeuta',
    professionalTitle: 'Psicólogo',
  }),
  'Fisioterapeuta',
  'a especialidade canônica deve prevalecer sobre o título legado',
);
assert.equal(
  readClinicalSpecialtyFromSource({
    metadata: { professionalTitle: 'Psicólogo' },
  }),
  'Psicólogo',
  'cadastros antigos devem continuar legíveis sem serem convertidos',
);

const legacyOptions = getClinicalSpecialtyOptions('Psicólogo');
assert.equal(legacyOptions[0]?.value, 'Psicólogo');
assert.equal(legacyOptions[0]?.legacy, true);
assert.deepEqual(
  legacyOptions.slice(1).map((option) => option.value),
  EXPECTED_SPECIALTIES,
);

const invitationModal = fs.readFileSync(
  'src/components/InvitationModal.tsx',
  'utf8',
);
const teamManagement = fs.readFileSync(
  'src/components/TeamManagement.tsx',
  'utf8',
);
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');

for (const source of [invitationModal, teamManagement]) {
  assert.match(source, /Especialidade clínica/);
  assert.match(source, /CLINICAL_SPECIALTY_OPTIONS/);
  assert.doesNotMatch(source, /PROFESSIONAL_TITLE_OPTIONS/);
}

assert.match(invitationModal, /specialty,/);
assert.doesNotMatch(
  invitationModal,
  /professionalTitle:\s*specialty/,
  'o convite novo deve escrever no campo canônico',
);
assert.match(teamManagement, /dataService\.updateMemberSpecialty/);
assert.match(
  dataService,
  /\/api\/clinic\/members\/\$\{encodeURIComponent\(String\(memberId\)\)\}\/specialty/,
);
assert.match(dataService, /body:\s*JSON\.stringify\(\{\s*specialty\s*\}\)/);

console.log('clinicalSpecialtiesFrontend.test.ts: ok');
