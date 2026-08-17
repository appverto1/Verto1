import assert from 'node:assert/strict';
import fs from 'node:fs';

const modules = fs.readFileSync('src/constants/organizationModules.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const portal = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const salesBuilder = fs.readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');

// Mandatory clinical baseline: clinical_core is always considered available,
// even in contract mode with an empty/stale optional entitlement set.
assert.match(
  modules,
  /if \(moduleKey === 'clinical_core'\) return true;/,
  'clinical_core must be structurally always-on',
);
assert.match(
  modules,
  /return !required \|\| hasOrganizationModule\(mode, modules, required\);/,
  'capability filtering must honor the always-on core invariant',
);

// Missing commercial profile fails closed for add-ons without removing core.
assert.match(
  server,
  /CLINIC_MODULE_ACCESS_PROFILE_MISSING[\s\S]{0,700}mode: 'contract'[\s\S]{0,250}modules: new Set<OrganizationModuleKey>\(\['clinical_core'\]\)/,
  'missing entitlement profile must degrade to core-only contract mode',
);


assert.match(
  server,
  /PGRST202[\s\S]{0,900}using core-only access[\s\S]{0,350}mode: 'contract'/,
  'missing entitlement RPC/schema must also degrade to core-only instead of taking patient care down',
);
assert.match(
  server,
  /if \(!moduleKey \|\| moduleKey === 'clinical_core'\) return next\(\);/,
  'patient portal any-capability guard must bypass commercial entitlement lookup for clinical core',
);

// Patient account provisioning is a patient.create operation and insurance
// payload remains separately protected.
assert.match(
  server,
  /app\.post\('\/api\/patients\/create-user', patientCreateLimiter, checkAuth, requireClinicCapability\('patient\.create'\)/,
  'patient portal/account provisioning must require patient.create',
);
assert.match(
  server,
  /patientPayloadRequestsInsuranceCreateCapability\(req\.body\)[\s\S]{0,180}!context\.capabilities\.has\('patient\.insurance\.create'\)/,
  'create-user route must not bypass insurance capability enforcement',
);
assert.match(
  server,
  /normalizePatientInsuranceTypeForPersistence\(requestedTypeRaw\) !== 'particular'/,
  'private-pay classification alone must stay outside insurance capability checks',
);

// The clinical patient portal stays on while appointments remain optional.
assert.match(portal, /hasOrganizationModule\(portalModuleMode, portalModules, moduleKey\)/);
assert.match(portal, /const clinicalPortalEnabled = portalHasModule\('clinical_core'\);/);
assert.match(portal, /const appointmentsPortalEnabled = portalHasModule\('appointments_communication'\);/);
assert.match(app, /hasOrganizationModule\(portalModuleMode, portalModules, moduleKey\)/);

// Patient registration must not surface or submit TISS/insurance controls when
// the optional module is not contracted.
assert.match(coordinator, /const hasInsuranceTissModule = authorizationHydrated && hasModule\("insurance_tiss"\);/);
assert.match(coordinator, /hasInsuranceTissModule[\s\S]{0,220}id: "insurance"/);
assert.match(coordinator, /hasInsuranceTissModule && canViewPatientTissAuthorizations[\s\S]{0,220}id: "tiss"/);
assert.match(coordinator, /: editingPatientId\s*\? \{\}\s*: \{ insuranceType: "particular" \};/);
assert.match(coordinator, /\{hasInsuranceTissModule && canViewPatientInsurance && activePatientRegistrationTab === "insurance"/);


// The per-patient treatment financial plan belongs to the mandatory patient core.
// The optional financial_management module controls the financial workspace, not
// whether a patient can have a pricing/recurrence plan.
assert.match(coordinator, /const canManagePatientFinancialPlan = hasCapability\("patient\.demographics\.edit"\);/);
assert.match(coordinator, /canManagePatientFinancialPlan[\s\S]{0,220}id: "financial"/);
assert.match(coordinator, /\{canManagePatientFinancialPlan && activePatientRegistrationTab === "financial"/);
assert.match(server, /financial-plans', checkAuth, requireClinicCapability\('patient\.demographics\.edit'\)/);
assert.match(server, /financial-plans', portalActionLimiter, checkAuth, requireClinicCapability\('patient\.demographics\.edit'\)/);
assert.match(server, /context\.capabilities\.has\('patient\.demographics\.edit'\)[\s\S]{0,160}financialPlans/);
assert.match(coordinator, /filter\(\(option\) => hasInsuranceTissModule \|\| option\.value !== "INSURANCE"\)/);

// New commercial proposals cannot intentionally remove the clinical baseline.
assert.doesNotMatch(salesBuilder, /Remover módulo clínico|Incluir módulo clínico|Módulo clínico opcional/);
assert.match(salesBuilder, /Núcleo obrigatório/);
assert.match(server, /PROPOSAL_CLINICAL_CORE_REQUIRED/);

// Authorization fetch failures fail closed for optional modules instead of
// silently restoring legacy_full access.
assert.match(
  coordinator,
  /filterCapabilitiesByOrganizationModules\(baseCapabilities, 'contract', new Set<OrganizationModuleKey>\(\)\)/,
);
assert.match(
  coordinator,
  /useState<OrganizationModuleAccessMode>\("contract"\)/,
  'optional modules must not flash on before canonical authorization hydration',
);
assert.match(
  coordinator,
  /setEffectiveCapabilities\(new Set\(\)\);[\s\S]{0,140}setModuleAccessMode\("contract"\);/,
  'rehydration must reset to a fail-closed optional-module state',
);

console.log('coreClinicalBaselineEntitlement.test.mjs: ok');
