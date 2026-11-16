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
const oldGuard = 'if (clinicalProfile && persistedClinicalLoginPortal(clinicalProfile.role)) return rejectWrongPortal();';
const newGuard = [
  '// A clinical identity may also hold an independently approved external partner role.',
  '// This does not create a session or bypass the partner token and approval checks.',
  'if (clinicalProfile && persistedClinicalLoginPortal(clinicalProfile.role) &&',
  '    !(await approvedExternalPartnerForClinicalIdentity(supabase, user.email)))',
  '  return rejectWrongPortal();'
].join('\n      ');
const ix = server.indexOf(oldGuard);
const routeStart = server.lastIndexOf("app.use('/api/partnerships/auth/session'", ix);
if (ix < 0 || routeStart < 0 || ix - routeStart > 8000) {
  throw new Error('PR792 guard: clinical/partner middleware context differs from Main');
}
replaceOne(oldImport, newImport, 'partner route import');
replaceOne(oldGuard, newGuard, 'partner pre-session check');
fs.writeFileSync(serverPath, server, 'utf8');
fs.unlinkSync(workflowPath);
fs.unlinkSync(scriptPath);
console.log('PR792 scope: two guarded server.ts replacements; temporary Action and script removed; zero SQL');
