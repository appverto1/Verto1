import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const therapistCode = read('src/components/TherapistDashboard.tsx');
const receptionistCode = read('src/components/ReceptionistDashboard.tsx');
const settingsMenuCode = read('src/components/SettingsMenu.tsx');
const appCode = read('src/App.tsx');
const serverCode = read('server.ts');
const patientDetailCode = read('src/components/PatientDetailView.tsx');
const progressReportPdfCode = read('src/components/ProgressReportPDFLayout.tsx');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 2600) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('configuracoes saem do menu lateral e ficam apenas na engrenagem', () => {
  const navigationGroups = sliceFrom(coordinatorCode, 'const navigationGroups', 1800);
  assert.doesNotMatch(navigationGroups, /id:\s*"settings"/);
  assert.match(settingsMenuCode, /<Settings size=\{20\}/);
  assert.match(settingsMenuCode, /Perfil e clínica/);
  assert.match(coordinatorCode, /onViewProfile=\{\(\) => navigateToTab\("settings"\)\}/);
});

test('perfil e logout ficam centralizados no menu da engrenagem', () => {
  for (const dashboard of [coordinatorCode, therapistCode, receptionistCode]) {
    assert.doesNotMatch(dashboard, />\s*Sair do Sistema\s*</i);
    assert.doesNotMatch(dashboard, /onClick=\{onLogout\}/);
    assert.doesNotMatch(dashboard, /id=["']menu-logout["']/);
  }

  assert.match(settingsMenuCode, /profileImageUrl/);
  assert.match(settingsMenuCode, /profileImageFailed/);
  assert.match(settingsMenuCode, /object-cover/);
  assert.match(settingsMenuCode, /userInitials/);
  assert.match(settingsMenuCode, /Sair do sistema/);
  assert.match(settingsMenuCode, /await onLogout\(\)/);
  assert.match(settingsMenuCode, /if \(isLoggingOut\) return/);
  assert.match(settingsMenuCode, /Não foi possível sair agora\. Tente novamente\./);
  assert.match(settingsMenuCode, /disabled=\{isLoggingOut\}/);
});

test('menu da conta usa papel da organizacao ativa e navegacao acessivel', () => {
  assert.match(settingsMenuCode, /user\?\.activeWorkspaceRole/);
  assert.match(settingsMenuCode, /user\?\.activeOrganizationRole/);
  assert.match(settingsMenuCode, /aria-haspopup="menu"/);
  assert.match(settingsMenuCode, /aria-expanded=\{isOpen\}/);
  assert.match(settingsMenuCode, /role="menu"/);
  assert.match(settingsMenuCode, /role="menuitem"/);
  assert.match(settingsMenuCode, /event\.key !== 'Escape'/);
  assert.match(settingsMenuCode, /triggerRef\.current\?\.focus\(\)/);
  assert.match(settingsMenuCode, /firstActionRef\.current\?\.focus\(\)/);
});

test('perfil profissional e dados da clinica aparecem como blocos separados', () => {
  for (const label of [
    'Perfil do profissional responsável',
    'Dados da clínica',
    'Nome da Clínica',
    'CPF',
    'CRP / Registro profissional',
    'Telefone da Clínica',
    'E-mail institucional',
    'Endereço da Clínica'
  ]) {
    assert.match(coordinatorCode, new RegExp(label));
  }
});

test('contexto do prontuario usa dados da clinica sem cair na foto/nome do profissional', () => {
  const context = sliceFrom(coordinatorCode, 'clinicContext={{', 1400);
  assert.match(context, /clinicName:\s*[\s\S]*user\?\.clinicSettings\?\.clinicName/);
  assert.match(context, /user\?\.workspaceName/);
  assert.doesNotMatch(context, /clinicName:[\s\S]*user\?\.name[\s\S]*cnpj:/);
  assert.match(context, /logoUrl:\s*user\?\.clinicSettings\?\.clinicLogoUrl \|\| null/);
  assert.doesNotMatch(context, /logoUrl:[\s\S]*user\?\.profilePicture/);
  assert.match(context, /professionalName:\s*user\?\.name \|\| "Profissional responsável"/);
});

test('backend persiste campos profissionais e institucionais de forma tolerante ao schema', () => {
  const route = sliceFrom(serverCode, "app.post('/api/profile/:userId'", 26000);
  for (const token of [
    'professionalProfileInput',
    'clinicSettingsInput',
    'professionalCpf',
    'professionalPhone',
    'professionalRoleTitle',
    'clinicName',
    'clinicPhone',
    'clinicEmail',
    'clinicAddress',
    'professional_profile',
    'clinic_settings',
    'patchTableSafely'
  ]) {
    assert.match(route, new RegExp(token));
  }
  assert.match(route, /cpf:\s*professionalCpf/);
  assert.match(route, /clinic_name:\s*clinicName/);
  assert.match(route, /clinic_email:\s*clinicEmail/);
  assert.match(serverCode, /clinicEmail:\s*sanitizeEmail\(settings\.clinicEmail\)/);
});

test('salvamento de configurações não fica bloqueado pela revalidação derivada de Pré-guias', () => {
  const clinicSave = sliceFrom(coordinatorCode, 'const handleSaveClinicSettings = async', 10500);
  assert.match(clinicSave, /clinicSettingsSaveInFlightRef/);
  assert.match(clinicSave, /try\s*\{/);
  assert.match(clinicSave, /finally\s*\{[\s\S]*hideProcessing\(\)/);

  const providerRoute = sliceFrom(serverCode, "app.patch('/api/admin/tiss/provider-profile'", 5200);
  assert.match(providerRoute, /queueTissProfileRevalidation/);
  assert.doesNotMatch(providerRoute, /await runAffectedTissPipeline/);
  assert.doesNotMatch(providerRoute, /await markTissPreGuidesStale/);

  const professionalUpsert = sliceFrom(serverCode, 'const upsertProfessionalBillingProfile = async', 5000);
  assert.match(professionalUpsert, /queueTissProfileRevalidation/);
  assert.doesNotMatch(professionalUpsert, /await runAffectedTissPipeline/);
  assert.doesNotMatch(professionalUpsert, /await markTissPreGuidesStale/);
  assert.match(serverCode, /queuedTissProfileRevalidations/);
  assert.match(serverCode, /await markTissPreGuidesStale\(/);
});

test('relogin reidrata perfil profissional e dados da clinica pelo professional_profiles', () => {
  const refresh = sliceFrom(appCode, 'const professionalProfile = profileResult?.data?.professional_profile', 3600);
  for (const token of [
    'professionalMetadata',
    'cpf',
    'phone',
    'professionalRoleTitle',
    'professionalProfile',
    'clinicName',
    'clinicPhone',
    'clinicEmail',
    'clinicAddress'
  ]) {
    assert.match(refresh, new RegExp(token));
  }
});

test('relatorio de evolucao usa logo institucional da clinica sem fallback para foto profissional', () => {
  const mediaRefresh = sliceFrom(patientDetailCode, 'const refreshClinicDocumentMedia = async', 1200);
  assert.match(mediaRefresh, /media\?\.clinicLogoUrl/);
  assert.doesNotMatch(mediaRefresh, /profilePictureUrl/);
  assert.doesNotMatch(patientDetailCode, /clinicLogoUrl = sanitizeDocumentImageUrl\(c\.logoUrl \|\| c\.clinicLogoUrl \|\| c\.profilePictureUrl\)/);
  const progressClinic = sliceFrom(patientDetailCode, 'const progressReportClinic =', 1100);
  assert.match(progressClinic, /progressClinicContext\?\.clinicName/);
  assert.match(progressClinic, /progressClinicContext\?\.clinicLogoUrl \|\| progressClinicContext\?\.logoUrl/);
  assert.match(patientDetailCode, /await refreshClinicDocumentMedia\(\)/);
  assert.match(progressReportPdfCode, /<img src=\{clinic\.logoUrl\} alt="Logo da cl.nica"/);
  assert.match(progressReportPdfCode, /\{clinic\.name \|\| 'Cl.nica n.o informada'\}/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} profile/clinic settings checks passed`);
