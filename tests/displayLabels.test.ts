import assert from 'node:assert/strict';
import {
  filterHumanDisplayEntries,
  formatPatientLabel,
  formatSessionLabel,
  formatTherapistLabel,
  isTechnicalFieldName,
  isTechnicalId,
  maskTechnicalId,
  safeDisplayValue,
  sanitizeTechnicalErrorMessage
} from '../src/utils/displayLabels.ts';
import { canViewTechnicalDetails } from '../src/components/TechnicalDetails.tsx';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const uuid = '1bbf0c80-dfe0-4801-8a4f-7447e06cc0d6';

test('detecta UUIDs e campos tecnicos comuns', () => {
  assert.equal(isTechnicalId(uuid), true);
  assert.equal(isTechnicalId(`sessao-${uuid}`), true);
  assert.equal(isTechnicalId('session-1'), true);
  assert.equal(isTechnicalFieldName('therapist_id'), true);
  assert.equal(isTechnicalFieldName('organizationId'), true);
  assert.equal(isTechnicalFieldName('idade'), false);
});

test('labels humanos nunca usam ID bruto como fallback', () => {
  assert.equal(formatPatientLabel({ patient_id: uuid }), 'Paciente nao identificado');
  assert.equal(formatTherapistLabel({ therapist_id: uuid }), 'Terapeuta nao informado');
  assert.equal(formatTherapistLabel({ therapistName: 'Dra. Marina' }), 'Dra. Marina');
  assert.equal(formatSessionLabel({ id: uuid, startedAt: '2026-05-26T21:19:00.000Z' }).startsWith('Sessao de '), true);
});

test('safeDisplayValue mascara valores tecnicos em telas comuns', () => {
  assert.equal(safeDisplayValue(uuid, 'Nao mostrar'), 'Nao mostrar');
  assert.equal(maskTechnicalId(uuid).includes(uuid), false);
  assert.equal(sanitizeTechnicalErrorMessage(`Erro no Supabase ${uuid}`), 'Nao foi possivel carregar os dados agora. Tente novamente em alguns instantes.');
});

test('renderizacao generica remove campos tecnicos', () => {
  const entries = filterHumanDisplayEntries({
    patient_name: 'Ana',
    patient_id: uuid,
    session_id: uuid,
    notes: 'Registro clinico',
    organizationId: uuid
  });
  assert.deepEqual(entries.map(([key]) => key), ['patient_name', 'notes']);
});

test('detalhes tecnicos ficam restritos a dev ou perfis autorizados', () => {
  assert.equal(canViewTechnicalDetails('therapist', false), false);
  assert.equal(canViewTechnicalDetails('admin', false), true);
  assert.equal(canViewTechnicalDetails('therapist', true), true);
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
