import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/PayerRequirementsPanel.tsx', 'utf8');

assert.match(source, /normalizePatientInsuranceEligibility/);
assert.match(source, /setupPatientMatchesPayer\(patient, selectedPayerId, selectedPayer\?\.name\)/);
assert.match(source, /setupAppointmentDiagnostics\s*\.filter\(\(item\) => item\.payerRelated\)/);
assert.match(source, /from\.setDate\(from\.getDate\(\) - 180\)/);
assert.match(source, /to\.setDate\(to\.getDate\(\) \+ 365\)/);
assert.match(source, /patientId: setupPatientId/);
assert.match(source, /const firstLinkedPatientId = setupPatientRecordId\(setupPatientsForPayer\[0\]\)/);

console.log('tissPayerLinkedPatientRecognition: ok');
