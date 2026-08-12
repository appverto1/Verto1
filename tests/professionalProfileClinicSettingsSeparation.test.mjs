import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const settings = fs.readFileSync('src/components/ClinicGlobalSettingsPanel.tsx', 'utf8');
const onboarding = fs.readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');
const settingsMenu = fs.readFileSync('src/components/SettingsMenu.tsx', 'utf8');
const authorizationModel = fs.readFileSync('src/constants/authorizationModel.ts', 'utf8');

const section = (source, start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(a, -1, `início ausente: ${start}`);
  assert.notEqual(b, -1, `fim ausente: ${end}`);
  return source.slice(a, b);
};

const saveHandler = section(dashboard, 'const handleSaveClinicSettings', 'const normalizeAnamnesisTemplateForEditor');
const completeOnboarding = section(server, "app.post('/api/profile/:userId/complete-onboarding'", "app.get('/api/profile/:userId', checkAuth");
const profileSave = section(server, "app.post('/api/profile/:userId', checkAuth", "app.get('/api/tasks/:patientId'");

// Navegação e UI separadas.
assert.match(dashboard, /professionalProfile: "Meu perfil profissional"/);
assert.match(dashboard, /label: "Meu perfil profissional"[\s\S]*?tab: "professionalProfile"/);
assert.match(dashboard, /label: "Configurações da clínica"[\s\S]*?tab: "settings"/);
assert.match(dashboard, /if \(tabId === "settings"\) return hasCapability\("clinic\.settings\.view"\)/);
assert.match(settings, /mode: "professional" \| "clinic"/);
assert.match(settings, /isProfessionalView \? "Meu perfil profissional" : "Configurações da clínica"/);
assert.match(settings, /Dados institucionais da unidade atual\. Apenas Direção e Coordenação autorizadas podem editar/);
assert.match(settingsMenu, /Meu perfil profissional/);
assert.match(settingsMenu, /Configurações da clínica/);
assert.match(settingsMenu, /canManageClinicSettings/);
assert.match(authorizationModel, /clinic\.settings\.edit'[\s\S]*?delegable: false/);

// Perfil canônico carrega para qualquer papel clínico, não só terapeuta/supervisor.
assert.match(dashboard, /if \(activeTab !== "professionalProfile"\) return;/);
assert.doesNotMatch(dashboard, /activeTab !== "professionalProfile" \|\| !isTherapist/);

// Salvar perfil e salvar clínica são operações distintas.
assert.match(saveHandler, /saveScope: "professional" \| "clinic"/);
assert.match(saveHandler, /saveScope === "clinic" && !canManageClinicSettings/);
assert.match(saveHandler, /saveScope === "professional"[\s\S]*?professionalProfile:/);
assert.match(saveHandler, /else \{[\s\S]*?clinicSettings:/);

// Backend não aceita um profissional comum alterando clínica por payload.
assert.match(profileSave, /canEditClinicSettings = \['director', 'coordinator'\]\.includes\(activeClinicRole\) && Boolean\(authorizationContext\?\.capabilities\?\.has\('clinic\.settings\.edit'\)\)/);
assert.match(profileSave, /const clinicSettingsInput =[\s\S]*?canEditClinicSettings && req\.body\?\.clinicSettings/);
assert.match(profileSave, /\['director', 'coordinator'\]\.includes\(activeClinicRole\)/);
assert.match(profileSave, /if \(clinicId && canEditClinicSettings\)/);
assert.doesNotMatch(profileSave, /email: sanitizeEmail\(req\.body\?\.email\)/);
assert.doesNotMatch(profileSave, /role: sanitizeString\(req\.body\?\.role/);

// Onboarding preserva documento, endereço, mídia e registro profissional.
assert.match(onboarding, /documentType/);
assert.match(onboarding, /documentNumber/);
assert.match(onboarding, /addressLine/);
assert.match(onboarding, /addressPostalCode/);
assert.match(onboarding, /profilePicturePath/);
assert.match(onboarding, /signaturePath/);
assert.match(onboarding, /councilNumber/);
assert.match(completeOnboarding, /documentType \|\| req\.body\?\.document_type/);
assert.match(completeOnboarding, /req\.body\?\.addressLine/);
assert.match(completeOnboarding, /profilePicturePath/);
assert.match(completeOnboarding, /signaturePath/);
assert.match(completeOnboarding, /buildPatientPhotoViewUrl\(extractPatientPhotosStoragePath\(profilePicturePath\)\)/);

console.log('professionalProfileClinicSettingsSeparation.test.mjs: ok');
