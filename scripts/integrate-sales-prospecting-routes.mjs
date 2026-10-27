// One-time developer utility. Never run from prestart, Railway, or a deployed request.
// The GitHub connector cannot upload the 4MB server.ts, so this creates a tiny,
// deterministic integration diff when run in a local Git checkout.
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'server.ts';
const content = readFileSync(path, 'utf8');
const importLine = "import { registerSalesProspectingRoutes } from './services/salesProspectingRoutes';";
const importAnchor = "import { createOwnerStatsHandler, createOwnerClientsHandler, createOwnerFinancialOverviewHandler, createOwnerFinancialSurveysHandler, createAdminDemoSandboxesHandler, createAdminStatsHandler, createAdminClientsHandler, createAdminVertoProtocolsHandler, createOwnerRecoveryLeadsHandler } from './services/ownerAdminReadHandlers';";
const routeLine = '  registerSalesProspectingRoutes(app, { supabase, checkAuth, checkPlatformAdmin, isUuid, sanitizeString });';
const routeAnchor = "  app.get('/api/owner/leads/recovery', checkAuth, checkOwner, createOwnerRecoveryLeadsHandler(() => ({ supabase, sanitizeString, sanitizeEmail })));";

if (!content.includes(importAnchor) || !content.includes(routeAnchor)) {
  throw new Error('Server integration anchors changed. Review server.ts manually, do not guess.');
}
if (content.split(importAnchor).length !== 2 || content.split(routeAnchor).length !== 2) {
  throw new Error('Server integration anchors are not unique.');
}
const existingImport = content.includes(importLine);
const existingRoute = content.includes(routeLine);
if (existingImport !== existingRoute) throw new Error('Partial integration detected. Review manually.');
if (existingImport) {
  process.stdout.write('Sales prospecting routes already registered. No changes.\n');
  process.exit(0);
}
const modified = content
  .replace(importAnchor, () => importAnchor + '\n' + importLine)
  .replace(routeAnchor, () => routeAnchor + '\n\n' + routeLine);
if (modified.length !== content.length + importLine.length + routeLine.length + 3) {
  throw new Error('Unexpected patch size. No changes written.');
}
writeFileSync(path, modified, 'utf8');
process.stdout.write('Patched server.ts with exactly one import and route registration. Review git diff before commit.\n');
