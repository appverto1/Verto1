import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'server.ts';
let source = readFileSync(file, 'utf8');
assert.ok(source.length > 4_000_000, 'unexpectedly small server.ts');
const replaceExactlyOnce = (oldValue, newValue, label) => {
  const found = source.split(oldValue).length - 1;
  assert.equal(found, 1, `${label} should match exactly once`);
  source = source.replace(oldValue, newValue);
};
if (!source.includes("createPatientSharedGraphApi from './services/patientSharedGraphApi'")) {
  replaceExactlyOnce(
    "import { createClinicalOutcomesDashboardHandler } from './services/clinicalOutcomesDashboardHandler';",
    "import { createClinicalOutcomesDashboardHandler } from './services/clinicalOutcomesDashboardHandler';\nimport { createPatientSharedGraphApi } from './services/patientSharedGraphApi';",
    'module import',
  );
  replaceExactlyOnce(
    "  app.get('/api/config', (req, res) => {",
    `  // Patient-level shared graph API: per-case authority, verified global identity.
  const patientGraphSharing = createPatientSharedGraphApi({
    supabase, currentClinicId, resolveClinicCapabilityContext,
  });
  patientGraphSharing.registerClinicRoutes(app, { checkAuth, checkPatientAccess, requireClinicCapability });

  app.get('/api/config', (req, res) => {`,
    'clinic API registration',
  );
  replaceExactlyOnce(
    "  app.get('/api/portal/patients/:patientId/mastery-growth', noStoreDynamicResponse, checkAuth, requireRoles('patient'), requirePatientPortalModule('clinical_core'), async (req: any, res) => {",
    `  const portalSharedGraphApi = patientGraphSharing.registerPortalRoutes(app, {
    checkAuth, requireRoles, requirePatientPortalModule, resolvePatientPortalContext,
  });
  app.get('/api/portal/patients/:patientId/mastery-growth', noStoreDynamicResponse, checkAuth, requireRoles('patient'), requirePatientPortalModule('clinical_core'), async (req: any, res) => {`,
    'portal API registration',
  );
  replaceExactlyOnce(
    "      const data = await readPatientMasteryGrowthEvents({ patientId: resolvedPatientId, clinicId: context?.clinicId });",
    `      const sharing = await portalSharedGraphApi.loadPortal(req, res);
      if (!sharing) return;
      if (!sharing.publication || sharing.publication.graph_type !== 'mastery_growth') {
        return res.status(403).json({ success: false, error: 'GRAPH_NOT_SHARED' });
      }
      const data = await readPatientMasteryGrowthEvents({
        patientId: sharing.publication.patient_id,
        clinicId: sharing.publication.clinic_id,
      });`,
    'remove stale portal mastery bypass',
  );
  writeFileSync(file, source);
}
assert.ok(source.includes('patientGraphSharing.registerClinicRoutes'));
assert.ok(source.includes('patientGraphSharing.registerPortalRoutes'));
assert.ok(source.includes("error: 'GRAPH_NOT_SHARED'"));
console.log('patient graph sharing server integration: PASS');
