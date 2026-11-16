'use strict';
const fs = require('node:fs');
const branch = 'reconcile/pr792-main-to-staging-gha-20261116';
if (process.env.GITHUB_REF_NAME !== branch || process.env.GITHUB_EVENT_NAME !== 'push') {
  throw new Error('PR792 reconciliation refused outside its one-time branch push');
}
const serverPath = 'server.ts';
const workflowPath = '.github/workflows/pr792-reconcile-once.yml';
const scriptPath = 'scripts/pr792-reconcile-once.cjs';
let server = fs.readFileSync(serverPath, 'utf8');
function replaceOne(oldPart, newPart, label) {
  if (server.indexOf(oldPart) < 0 || server.indexOf(oldPart, server.indexOf(oldPart) + oldPart.length) >= 0) {
    throw new Error('PR792 guard: expected unique ' + label + ' not found');
  }
  server = server.replace(oldPart, newPart);
}
const oldImport = "import { registerPartnershipRoutes } from './services/partnerships/partnershipRoutes';";
const newImport = "import { approvedExternalPartnerForClinicalIdentity, registerPartnershipRoutes } from './services/partnerships/partnershipRoutes';";
const oldGuard = [
  "if (clinicalProfile && persistedClinicalLoginPortal(clinicalProfile.role)) {",
  "        return rejectWrongPortal();",
  "      }"
].join('\n');
const newGuard = [
  "if (clinicalProfile && persistedClinicalLoginPortal(clinicalProfile.role) &&",
  "    !(await approvedExternalPartnerForClinicalIdentity(supabase, user.email))) {",
  "        return rejectWrongPortal();",
  "      }"
].join('\n');
const ix = server.indexOf(oldGuard);
const anchor = "const profileResult = await fetchProfileWithSchemaFallback({";
const lastAnchor = server.lastIndexOf(anchor, ix);
if (ix < 0 || lastAnchor < 0 || ix - lastAnchor > 2000 ||
    server.indexOf(oldGuard, ix + oldGuard.length) !== -1) {
  throw new Error('PR792 guard: expected isolated partner clinical role gate missing or not unique');
}
replaceOne(oldImport, newImport, 'partner route import');
replaceOne(oldGuard, newGuard, 'partner pre-session check');
fs.writeFileSync(serverPath, server, 'utf8');
fs.unlinkSync(workflowPath);
fs.unlinkSync(scriptPath);
console.log('PR792 scope: two guarded server.ts replacements; temporary Action and script removed; zero SQL');
