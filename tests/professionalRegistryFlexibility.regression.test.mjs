import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const registryTs = fs.readFileSync(new URL('../src/utils/professionalRegistry.ts', import.meta.url), 'utf8');
const masks = fs.readFileSync(new URL('../src/utils/brMasks.ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const onboarding = fs.readFileSync(new URL('../src/components/ProfessionalOnboarding.tsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/components/ClinicGlobalSettingsPanel.tsx', import.meta.url), 'utf8');
const coordinator = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');
const therapist = fs.readFileSync(new URL('../src/components/TherapistDashboard.tsx', import.meta.url), 'utf8');
const receptionist = fs.readFileSync(new URL('../src/components/ReceptionistDashboard.tsx', import.meta.url), 'utf8');

// Canonical formatter must no longer be a 7-digit CRP mask.
assert.match(registryTs, /PROFESSIONAL_REGISTRY_MAX_LENGTH = 80/);
assert.match(registryTs, /PROFESSIONAL_COUNCIL_MAX_LENGTH = 48/);
assert.match(registryTs, /\\p\{L\}\\p\{M\}\\p\{N\}/);
assert.doesNotMatch(registryTs, /replace\(\/\\D\/g[\s\S]{0,120}slice\(0, 7\)/);
assert.match(registryTs, /CRP · Psicologia/);
assert.match(registryTs, /CREFITO · Fisioterapia \/ Terapia Ocupacional/);
assert.match(registryTs, /CRFa · Fonoaudiologia/);
assert.match(registryTs, /CRM · Medicina/);
assert.match(registryTs, /COREN · Enfermagem/);
assert.match(registryTs, /CRN \/ CR Nutri · Nutrição/);
assert.match(registryTs, /CRBM · Biomedicina/);
assert.match(registryTs, /CRTR · Técnicos\/Tecnólogos em Radiologia/);
assert.match(registryTs, /MEC \/ Registro profissional/);
assert.match(registryTs, /Sem conselho \/ Outro registro/);
assert.match(registryTs, /12345-TO, 1234-F/);

// OTHER documents must retain alphanumeric professional identifiers instead of CPF/CNPJ masking.
assert.match(masks, /if \(type === "OTHER"\)/);
assert.match(masks, /slice\(0, 80\)/);
assert.match(onboarding, /documentType === 'OTHER' \? documentNumber\.trim\(\) : digitsOnly\(documentNumber\)/);
assert.match(coordinator, /normalizedTherapistDocumentType === "OTHER"[\s\S]{0,120}formatProfessionalRegistry\(therapistCpf\)/);

// Onboarding/profile UI offers council-aware guidance without requiring a rigid format.
assert.match(onboarding, /list="professional-council-options"/);
assert.match(onboarding, /PROFESSIONAL_COUNCIL_OPTIONS\.map/);
assert.match(onboarding, /getProfessionalRegistryPlaceholder\(council\)/);
assert.match(onboarding, /getProfessionalRegistryGuidance\(council\)/);
assert.match(settings, /<select[\s\S]{0,260}Conselho \/ tipo de registro|Conselho \/ tipo de registro[\s\S]{0,260}<select/);
assert.doesNotMatch(settings, /clinic-professional-council-options/);
assert.match(settings, /maxLength=\{80\}/);

// Saving a normal professional profile must not be blocked merely because CRP is empty.
assert.doesNotMatch(therapist, /CRP é obrigatório|profileSpecialty === "Psicólogo" && !profileCrp\.trim/);
assert.doesNotMatch(receptionist, /CRP é obrigatório|profileSpecialty === "Psicólogo" && !profileCrp\.trim/);
assert.doesNotMatch(coordinator, /CRP é obrigatório/);

// Backend validates a broad safe alphabet, preserves zeros/suffixes, and never re-masks stored values to seven digits.
assert.match(server, /PROFESSIONAL_IDENTIFIER_PATTERN/);
assert.match(server, /isProfessionalIdentifierInputValid\(req\.body\?\.council, 48\)/);
assert.match(server, /isProfessionalIdentifierInputValid\(req\.body\?\.councilNumber, 80\)/);
const resolveStart = server.indexOf('function resolveStoredCrp');
const resolveEnd = server.indexOf('function resolveStoredCouncil', resolveStart);
const resolveBlock = server.slice(resolveStart, resolveEnd);
assert.match(resolveBlock, /sanitizeProfessionalIdentifier\(raw, 80\)/);
assert.doesNotMatch(resolveBlock, /replace\(\/\\D\/g|slice\(0, 7\)/);
assert.match(server, /documentType === 'OTHER'[\s\S]{0,300}sanitizeProfessionalIdentifier\(rawBillingDocument, 80\)/);

// Functional formatter contract: compile the pure utility and exercise representative real-world values.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verto-prof-reg-'));
try {
  execFileSync('tsc', [
    path.resolve(new URL('../src/utils/professionalRegistry.ts', import.meta.url).pathname),
    '--target', 'ES2020',
    '--module', 'commonjs',
    '--outDir', tmp,
    '--skipLibCheck',
  ], { stdio: 'pipe' });
  const require = createRequire(import.meta.url);
  const mod = require(path.join(tmp, 'professionalRegistry.js'));
  const valid = [
    '06/012345',
    '001234-TO',
    '1234-F',
    '12345-P',
    'G-000123',
    'MEC/REG-0001',
    'Diploma 000123/2026',
    'Registro Docente A-001/BR',
  ];
  for (const value of valid) {
    assert.equal(mod.formatProfessionalRegistry(value), value, `should preserve ${value}`);
    assert.equal(mod.isProfessionalRegistryValid(value), true, `should accept ${value}`);
  }
  assert.equal(mod.formatProfessionalCouncil('CRP-SP'), 'CRP-SP');
  assert.equal(mod.formatProfessionalCouncil('CRP 06'), 'CRP 06');
  assert.equal(mod.formatProfessionalCouncil('CREFITO-3'), 'CREFITO-3');
  assert.equal(mod.isNoFormalCouncil('Sem conselho / Outro registro'), true);
  assert.equal(mod.getProfessionalRegistryPlaceholder('CREFITO-3'), 'Ex.: 12345-TO, 1234-F');
  assert.equal(mod.formatProfessionalRegistry('000123'), '000123');
  assert.equal(mod.isProfessionalRegistryValid('<script>'), false);
  assert.equal(mod.formatProfessionalRegistry('A'.repeat(100)).length, 80);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('professionalRegistryFlexibility.regression: PASS');
