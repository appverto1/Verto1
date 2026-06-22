import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mirrorPatientInsuranceEligibilityAliases,
  normalizePatientInsuranceEligibility,
} from '../src/utils/patientInsuranceEligibility';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const patientDetailCode = read('src/components/PatientDetailView.tsx');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 2400) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('normaliza campos insurance top-level para convenio canonico', () => {
  const normalized = normalizePatientInsuranceEligibility({
    insuranceType: 'convenio',
    insuranceName: 'Amil',
    insuranceCardNumber: '123456789',
    insuranceCardValidUntil: '2026-06-30',
    insurancePlanCategory: 'S380',
    insuranceHolderName: 'Mariana',
    insuranceHolderCpf: '87945613245',
    insuranceHolderRelationship: 'Mãe',
    insuranceEligibilityNotes: 'Elegibilidade conferida',
  });

  assert.equal(normalized.convenioTipo, 'convenio');
  assert.equal(normalized.convenioNome, 'Amil');
  assert.equal(normalized.convenioCarteirinha, '123456789');
  assert.equal(normalized.convenioCarteirinhaValidade, '2026-06-30');
  assert.equal(normalized.convenioPlanoCategoria, 'S380');
  assert.equal(normalized.convenioTitularNome, 'Mariana');
  assert.equal(normalized.convenioTitularCpf, '87945613245');
  assert.equal(normalized.convenioTitularRelacao, 'Mãe');
  assert.equal(normalized.convenioElegibilidadeObs, 'Elegibilidade conferida');
});

test('reidrata campos convenio dentro de payload e payload.anamnese', () => {
  const normalized = normalizePatientInsuranceEligibility({
    payload: {
      convenioTipo: 'convenio',
      convenioNome: 'Amil',
      convenioCarteirinha: '123456789',
      anamnese: {
        convenioCarteirinhaValidade: '2026-06-30',
        convenioPlanoCategoria: 'S380',
        convenioTitularNome: 'Mariana',
        convenioTitularCpf: '87945613245',
        convenioTitularRelacao: 'Mãe',
        convenioElegibilidadeObs: 'Sem carência',
      },
    },
  });

  assert.equal(normalized.insuranceType, 'convenio');
  assert.equal(normalized.insuranceName, 'Amil');
  assert.equal(normalized.insuranceCardNumber, '123456789');
  assert.equal(normalized.insuranceCardValidUntil, '2026-06-30');
  assert.equal(normalized.insurancePlanCategory, 'S380');
  assert.equal(normalized.insuranceHolderName, 'Mariana');
  assert.equal(normalized.insuranceHolderCpf, '87945613245');
  assert.equal(normalized.insuranceHolderRelationship, 'Mãe');
  assert.equal(normalized.insuranceEligibilityNotes, 'Sem carência');
});

test('prefill com responsavel ocorre apenas quando titular esta vazio', () => {
  const suggested = normalizePatientInsuranceEligibility({
    convenioTipo: 'convenio',
    responsavelNome: 'Mariana',
    responsavelCpf: '87945613245',
    responsavelRelacao: 'Mãe',
  }, { useResponsibleFallback: true });
  assert.equal(suggested.convenioTitularNome, 'Mariana');
  assert.equal(suggested.convenioTitularCpf, '87945613245');
  assert.equal(suggested.convenioTitularRelacao, 'Mãe');
  assert.equal(suggested.holderPrefilledFromResponsible, true);

  const persisted = normalizePatientInsuranceEligibility({
    convenioTipo: 'convenio',
    convenioTitularNome: 'Titular customizado',
    responsavelNome: 'Mariana',
  }, { useResponsibleFallback: true });
  assert.equal(persisted.convenioTitularNome, 'Titular customizado');
  assert.equal(persisted.holderPrefilledFromResponsible, false);
});

test('espelhamento preserva formatos ingles e portugues para a UI', () => {
  const mirrored = mirrorPatientInsuranceEligibilityAliases({
    insuranceType: 'convenio',
    insuranceName: 'Amil',
    insuranceCardNumber: '123456789',
    insuranceCardValidUntil: '2026-06-30',
    insurancePlanCategory: 'S380',
    insuranceHolderName: 'Mariana',
    insuranceHolderCpf: '87945613245',
    insuranceHolderRelationship: 'Mãe',
    insuranceEligibilityNotes: 'Sem carência',
  });

  assert.equal(mirrored.convenioNome, 'Amil');
  assert.equal(mirrored.insuranceName, 'Amil');
  assert.equal(mirrored.cardNumber, '123456789');
  assert.equal(mirrored.convenioCarteirinhaValidade, '2026-06-30');
  assert.equal(mirrored.eligibilityNotes, 'Sem carência');
});

test('backend e telas usam normalizacao compartilhada nos pontos de reidratacao', () => {
  const identityPatch = sliceFrom(serverCode, 'const hasIdentityPersistencePatch = [', 1800);
  for (const field of [
    'insuranceCardValidUntil',
    'insurancePlanCategory',
    'insuranceHolderName',
    'insuranceHolderCpf',
    'insuranceHolderRelationship',
    'insuranceEligibilityNotes',
    'convenioCarteirinhaValidade',
    'convenioPlanoCategoria',
    'convenioTitularNome',
    'convenioTitularCpf',
    'convenioTitularRelacao',
    'convenioElegibilidadeObs',
  ]) {
    assert.match(identityPatch, new RegExp(`'${field}'`));
  }

  assert.match(serverCode, /function normalizePatientInsuranceEligibilityPayload/);
  assert.match(serverCode, /const payload = sanitizeClinicalPayload\(payloadRaw\)/);
  assert.doesNotMatch(serverCode, /const payload = normalizePatientInsuranceEligibilityPayload\(sanitizeClinicalPayload\(payloadRaw\)\)/);
  assert.match(serverCode, /const responsePayload = decryptedPayload[\s\S]*normalizePatientInsuranceEligibilityPayload/);
  assert.match(appCode, /normalizePatientInsuranceEligibility\(\{[\s\S]*payload: existing/);
  assert.match(appCode, /const hasInsuranceEligibilityPatch = \[/);
  assert.match(appCode, /\|\| hasInsuranceEligibilityPatch/);
  assert.match(dataServiceCode, /mirrorPatientInsuranceEligibilityAliases\(parsedPayload/);
  assert.match(dataServiceCode, /normalizePatientInsuranceEligibility\([\s\S]*useResponsibleFallback: true/);
  assert.match(coordinatorCode, /const insuranceEligibility = normalizePatientInsuranceEligibility\(patient, \{ useResponsibleFallback: true \}\)/);
  assert.match(coordinatorCode, /applyInsuranceHolderSuggestion/);
  assert.match(patientDetailCode, /normalizePatientInsuranceEligibility\([\s\S]*useResponsibleFallback: true/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} patient insurance eligibility checks passed`);
