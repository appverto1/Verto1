import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');

// F5 on a patient record recovers that exact patient instead of reloading the whole list.
assert.match(
  app,
  /loadPatientDetailsOnOpen[\s\S]*?getPatients\(\{[\s\S]*?patientId: normalizedPatientId,[\s\S]*?forceRemote: true[\s\S]*?mergePatients\(current, \[recoveredPatient\]\)/,
);
assert.match(
  dataService,
  /async getPatients\(options: \{ workspaceId\?: string; forceRemote\?: boolean; patientId\?: string \}[\s\S]*?limit: requestedPatientId \? 1 : 200,[\s\S]*?patientId: requestedPatientId \|\| undefined/,
);
assert.match(
  server,
  /app\.get\('\/api\/patients'[\s\S]*?requestedPatientId[\s\S]*?resolvedScopedPatientIds === null[\s\S]*?resolvedScopedPatientIds\.includes\(requestedPatientId\)/,
);
assert.match(
  dashboard,
  /patientRestorePending[\s\S]*?Restaurando prontuário\.\.\./,
);

// Internal navigation history survives reload and the top-left back button consumes it.
assert.match(dashboard, /tabHistory: tabHistory\.slice\(-20\)/);
assert.match(dashboard, /const persistedHistory = Array\.isArray\(state\?\.tabHistory\)/);
assert.match(dashboard, /const goBackTab = \(\) => \{[\s\S]*?const previousTab = next\[next\.length - 1\]/);
assert.match(dashboard, /activeTab !== "dashboard"[\s\S]*?<button[\s\S]*?onClick=\{goBackTab\}[\s\S]*?aria-label="Voltar à página anterior"/);

console.log('dashboardNavigationPersistence.test.mjs: OK');
