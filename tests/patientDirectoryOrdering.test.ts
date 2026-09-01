import assert from 'node:assert/strict';
import { patientMatchesNameFilter, sortPatientsAlphabetically } from '../src/utils/patientList';

const patients = [
  { id: '4', name: 'THALITA EROULANA PHELLIPE' },
  { id: '2', name: 'Mateus' },
  { id: '1', name: 'Álvaro Costa' },
  { id: '3', name: 'Ana Beatriz' },
];

assert.deepEqual(
  sortPatientsAlphabetically(patients).map((patient) => patient.name),
  ['Álvaro Costa', 'Ana Beatriz', 'Mateus', 'THALITA EROULANA PHELLIPE'],
  'a listagem deve permanecer alfabeticamente ordenada em pt-BR',
);
assert.equal(patientMatchesNameFilter(patients[0], 'thalita'), true, 'busca deve ignorar caixa');
assert.equal(patientMatchesNameFilter(patients[2], 'alvaro'), true, 'busca deve ignorar acentos');
assert.equal(patientMatchesNameFilter(patients[1], 'joana'), false, 'busca não deve retornar nomes não correspondentes');

console.log('patientDirectoryOrdering.test.ts: OK');
