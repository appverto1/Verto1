import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const coordinator = read('src/components/CoordinatorDashboard.tsx');
const panel = read('src/components/ClinicGlobalSettingsPanel.tsx');
const app = read('src/App.tsx');
const server = read('server.ts');

// Reading the generic professional profile must not call the TISS projection without entitlement.
const loadStart = coordinator.indexOf('const loadOwnProfessionalSettings = async () => {');
const loadEnd = coordinator.indexOf('const refreshSignedMediaUrls', loadStart);
assert.ok(loadStart >= 0 && loadEnd > loadStart, 'professional profile load block must exist');
const loadBlock = coordinator.slice(loadStart, loadEnd);
assert.match(loadBlock, /hasInsuranceTissModule\s*\?\s*dataService\.getOwnProfessionalBillingProfile\(\)/);
assert.match(loadBlock, /Promise\.resolve\(\{ success: true, data: null \}\)/);
assert.match(loadBlock, /\[activeTab, hasInsuranceTissModule, user\?\.id\]/);

// Provider code is TISS-only; council, CBO and specialty remain generic.
const professionalFieldsStart = panel.indexOf('const professionalFields = (');
const professionalFieldsEnd = panel.indexOf('const mediaFields = (', professionalFieldsStart);
assert.ok(professionalFieldsStart >= 0 && professionalFieldsEnd > professionalFieldsStart, 'professional fields block must exist');
const professionalFields = panel.slice(professionalFieldsStart, professionalFieldsEnd);
assert.match(professionalFields, /hasInsuranceTissModule && \([\s\S]{0,180}Código do prestador/);
for (const genericField of ['Conselho / tipo de registro', 'UF do conselho', 'CBO', 'Área principal de atuação']) {
  assert.ok(professionalFields.includes(genericField), `generic field must remain visible: ${genericField}`);
}

// Save order is canonical global first, optional TISS second.
const saveStart = coordinator.indexOf('const handleSaveClinicSettings = async');
const saveEnd = coordinator.indexOf('const normalizeAnamnesisTemplateForEditor', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'professional save block must exist');
const saveBlock = coordinator.slice(saveStart, saveEnd);
const canonicalSaveAt = saveBlock.indexOf('await onUpdateProfile({');
const tissSaveAt = saveBlock.indexOf('await dataService.updateOwnProfessionalBillingProfile({');
assert.ok(canonicalSaveAt >= 0, 'canonical professional profile save must be awaited');
assert.ok(tissSaveAt > canonicalSaveAt, 'TISS projection must run only after canonical save');
assert.match(saveBlock.slice(canonicalSaveAt, tissSaveAt), /professionalProfileResult\?\.success === false/);
assert.match(saveBlock.slice(canonicalSaveAt, tissSaveAt + 600), /hasInsuranceTissModule && ownProfessionalId/);
assert.doesNotMatch(saveBlock.slice(canonicalSaveAt, tissSaveAt), /providerCode:/, 'providerCode must not be written to canonical profile payload');
assert.match(saveBlock, /Perfil profissional salvo\. Não foi possível atualizar os dados de faturamento TISS\./);

// Parent callback must return the canonical persistence result so sequencing is real, not fire-and-forget.
const callbackStart = app.indexOf('onUpdateProfile={(data: any) => {');
const callbackEnd = app.indexOf('onUpdatePatient={handleUpdatePatient}', callbackStart);
assert.ok(callbackStart >= 0 && callbackEnd > callbackStart, 'async profile persistence callback must exist');
const callback = app.slice(callbackStart, callbackEnd);
assert.doesNotMatch(callback, /void \(async \(\) =>/);
assert.match(callback, /return \(async \(\) =>/);
assert.match(callback, /return await dataService\.saveUserProfile\(user\.id, persistencePayload\)/);
assert.match(callback, /return await dataService\.saveUserProfile\(user\.id, fallbackPersistencePayload\)/);

// Direct TISS API remains commercially gated and self-scoped, but no longer requires unrelated session capabilities.
for (const route of [
  "app.get('/api/tiss/professional-profile/me'",
  "app.patch('/api/tiss/professional-profile/me'",
]) {
  const at = server.indexOf(route);
  assert.ok(at >= 0, `route missing: ${route}`);
  const boundary = server.slice(at, at + 700);
  assert.match(boundary, /checkAuth/);
  assert.match(boundary, /requireClinicModule\('insurance_tiss'\)/);
  assert.doesNotMatch(boundary, /session\.billing_evidence\.generate|session\.start|requireAnyClinicCapability/);
  assert.match(boundary, /const professionalId = sanitizeString\(req\.session\.user\?\.id, 120\)/);
  assert.doesNotMatch(boundary, /req\.params\.professionalId|assertProfessionalBillingProfileScope/);
}

// The module guard is also the active-membership boundary for every clinic base role.
const capabilityContextStart = server.indexOf('async function resolveClinicCapabilityContext');
const capabilityContextEnd = server.indexOf('function requireClinicCapability(', capabilityContextStart);
const capabilityContext = server.slice(capabilityContextStart, capabilityContextEnd);
assert.match(capabilityContext, /from\('clinic_memberships'\)/);
assert.match(capabilityContext, /\.eq\('user_id', userId\)/);
assert.match(capabilityContext, /\.eq\('clinic_id', clinicId\)/);
assert.match(capabilityContext, /\.eq\('status', 'active'\)/);
for (const role of ['director', 'coordinator', 'therapist', 'supervisor', 'receptionist', 'biller']) {
  assert.ok(server.includes(`${role}:`) || server.includes(`'${role}'`), `role must remain recognized: ${role}`);
}

// TISS projection remains tenant-scoped for the same professional across clinics.
const upsertStart = server.indexOf('const upsertProfessionalBillingProfile = async');
const upsertEnd = server.indexOf("app.get('/api/tiss/professional-profile/me'", upsertStart);
const upsertBlock = server.slice(upsertStart, upsertEnd);
assert.match(upsertBlock, /organization_id: organizationId/);
assert.match(upsertBlock, /clinic_id: organizationId/);
assert.match(upsertBlock, /professional_id: professionalId/);
assert.match(upsertBlock, /onConflict: 'organization_id,professional_id'/);
assert.match(upsertBlock, /provider_code:/);

// Direct callers without TISS remain blocked by the same commercial entitlement middleware.
const moduleGuardStart = server.indexOf('function requireClinicModule');
const moduleGuardEnd = server.indexOf('async function requirePatientPortalCapabilityModule', moduleGuardStart);
const moduleGuard = server.slice(moduleGuardStart, moduleGuardEnd);
assert.match(moduleGuard, /CLINIC_MODULE_NOT_ENTITLED/);
assert.match(moduleGuard, /hasOrganizationModule\(context\.moduleAccessMode, context\.modules, moduleKey\)/);

console.log('professionalProfileTissDecouplingP0.regression.test.mjs: ok');
