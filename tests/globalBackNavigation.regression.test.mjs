import assert from 'node:assert/strict';
import fs from 'node:fs';

const coordinator = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');
const therapist = fs.readFileSync(new URL('../src/components/TherapistDashboard.tsx', import.meta.url), 'utf8');
const receptionist = fs.readFileSync(new URL('../src/components/ReceptionistDashboard.tsx', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');

assert.match(coordinator, /const \[patientReturnTab, setPatientReturnTab\]/);
assert.match(coordinator, /setPatientReturnTab\(activeTab\)/);
assert.match(coordinator, /onClick=\{goBackFromPatientRecord\}/);
assert.doesNotMatch(coordinator, /onClick=\{\(\) => \{\s*setView\("home"\);\s*navigateToTab\("patients"\)/);

for (const [name, source] of [['therapist', therapist], ['receptionist', receptionist]]) {
  assert.match(source, /viewHistoryRef = useRef<string\[]>\(\["home"\]\)/, `${name} keeps page history`);
  assert.match(source, /const handleBackView = \(\) =>/, `${name} exposes semantic back navigation`);
  assert.match(source, /handleSetView\("patient"\)/, `${name} records patient navigation`);
}

assert.match(patientDetail, /aria-label="Voltar à página anterior"/);
console.log('global back navigation regression checks passed');
