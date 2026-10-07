import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const patientDashboard = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

// Reception P0: first render cannot expose an unhydrated clinic workspace.
assert.match(app, /const \[clinicStateHydrated, setClinicStateHydrated\] = useState\(false\)/);
assert.match(app, /\['director', 'coordinator', 'supervisor', 'therapist', 'receptionist'\]\.includes/);
assert.match(app, /setClinicStateHydrated\(false\)[\s\S]*hydrateWorkspaceState\(workspaceId\)/);
assert.match(app, /finally \{[\s\S]*setClinicStateHydrated\(true\)/);
assert.match(app, /\['director', 'coordinator', 'supervisor', 'therapist', 'receptionist'\]\.includes[\s\S]*!clinicStateHydrated[\s\S]*Carregando dados da clínica/);
assert.match(app, /\['director', 'coordinator', 'supervisor', 'receptionist', 'therapist'\]\.includes[\s\S]*<CoordinatorDashboard/);

// Family Diary P0: success is tied to a durable history write, not local optimistic state.
const familyStart = app.indexOf('const handleAddFamilyNote = async');
const familyEnd = app.indexOf('const handleLogout = async', familyStart);
assert.ok(familyStart > 0 && familyEnd > familyStart);
const family = app.slice(familyStart, familyEnd);
assert.match(family, /dataService\.addHistoryItem\(/);
assert.match(family, /historySaveResult\?\.pending === true \|\| historySaveResult\?\.offline === true/);
assert.match(family, /if \(!historySaveResult\?\.success\)/);
assert.match(family, /sync_status: 'synced'/);

// Reload/relogin uses the canonical patient-scoped endpoint and replaces local portal history.
assert.match(app, /dataService\.getPatientSelfHistory\(\)/);
assert.match(app, /setHistory\(normalizedHistory\)/);
assert.match(server, /app\.get\('\/api\/patient\/self\/history'[\s\S]*resolveCanonicalPatientPortalScope[\s\S]*patientId: portalScope\.patientId/);
assert.match(server, /app\.post\('\/api\/history'[\s\S]*role === 'patient'[\s\S]*create_patient_portal_history_entry_v1/);

// UI does not claim success before the parent confirms persistence.
const saveStart = patientDashboard.indexOf('const handleConfirmFamilyNote = async');
const saveEnd = patientDashboard.indexOf('const getFamilyDiaryImageSource', saveStart);
assert.ok(saveStart > 0 && saveEnd > saveStart);
const save = patientDashboard.slice(saveStart, saveEnd);
assert.match(save, /setIsFamilySaving\(true\)/);
assert.match(save, /await onAddFamilyNote/);
assert.match(save, /if \(saveResult\?\.success === false\)/);
assert.ok(
  save.indexOf('await onAddFamilyNote') < save.indexOf('setShowFamilySuccess(true)'),
  'success feedback must occur only after persistence is confirmed'
);
assert.match(patientDashboard, /persistedFamilyDiaryHistory[\s\S]*portalFamilyHistory/);

console.log('receptionFirstRenderFamilyDiaryP0.regression.test.mjs: ok');
