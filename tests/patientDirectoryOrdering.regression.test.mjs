import assert from 'node:assert/strict';
import fs from 'node:fs';

const patientList = fs.readFileSync('src/utils/patientList.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const registry = fs.readFileSync('src/components/PatientRegistry.tsx', 'utf8');

assert.match(
  patientList,
  /normalizePatientDirectoryText[\s\S]*?normalize\('NFD'\)[\s\S]*?replace\(\/\[\\u0300-\\u036f\]\/g, ''\)[\s\S]*?toLowerCase\(\)/,
  'a busca nominal deve continuar ignorando acentos e caixa',
);
assert.match(
  patientList,
  /sortPatientsAlphabetically[\s\S]*?localeCompare\(rightName, 'pt-BR',[\s\S]*?sensitivity:\s*'base'/,
  'a ordenação canônica deve continuar usando collation pt-BR com sensibilidade base',
);
assert.match(
  coordinator,
  /patientMatchesNameFilter\(patient, patientNameFilter\)[\s\S]*?sortPatientsAlphabetically\(filteredPatients\)/,
  'a gestão de pacientes deve reutilizar filtro e ordenação canônicos',
);
assert.match(
  registry,
  /sortPatientsAlphabetically[\s\S]*?patientMatchesNameFilter/,
  'as listagens operacionais devem reutilizar os helpers canônicos',
);

console.log('patientDirectoryOrdering.regression.test.mjs: ok');
