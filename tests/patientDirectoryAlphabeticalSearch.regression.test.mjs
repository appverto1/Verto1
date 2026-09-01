import fs from 'node:fs';
import assert from 'node:assert/strict';

const coordinator = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');
const registry = fs.readFileSync(new URL('../src/components/PatientRegistry.tsx', import.meta.url), 'utf8');
const patientList = fs.readFileSync(new URL('../src/utils/patientList.ts', import.meta.url), 'utf8');

assert.match(coordinator, /const \[patientNameFilter, setPatientNameFilter\] = useState<string>\(""\)/);
assert.match(coordinator, /placeholder="Digite o nome do paciente"/);
assert.match(coordinator, /patientMatchesNameFilter\(patient, patientNameFilter\)/);
assert.match(coordinator, /return sortPatientsAlphabetically\(filteredPatients\)/);
assert.match(registry, /sortPatientsAlphabetically\(/);
assert.match(registry, /patientMatchesNameFilter\(p, filterName\)/);
assert.match(patientList, /localeCompare\(rightName, 'pt-BR'/);
assert.match(patientList, /replace\(\/\[\\u0300-\\u036f\]\/g, ''\)/);

console.log('patient directory alphabetical/search regression: ok');
