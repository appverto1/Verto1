import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatDocument,
  maskCep,
  maskCnpj,
  maskCpf,
  maskPhoneBR,
  onlyDigits,
  parseDocumentForStorage,
} from '../src/utils/brMasks';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const settingsPanelCode = read('src/components/ClinicGlobalSettingsPanel.tsx');
const tissPanelCode = read('src/components/BillingTissSettingsPanel.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const serverCode = read('server.ts');
const professionalSelfServiceMigration = read('supabase/migrations/20260615193000_professional_billing_profile_self_service.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 3000) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} não encontrado.`);
  return source.slice(start, start + chars);
}

test('máscaras brasileiras aceitam CPF, CNPJ, telefone fixo/celular e CEP', () => {
  assert.equal(maskCpf('12345678901'), '123.456.789-01');
  assert.equal(maskCnpj('12345678000199'), '12.345.678/0001-99');
  assert.equal(formatDocument('12345678901', 'CPF'), '123.456.789-01');
  assert.equal(formatDocument('12345678000199', 'CNPJ'), '12.345.678/0001-99');
  assert.equal(maskPhoneBR('21998765432'), '(21) 99876-5432');
  assert.equal(maskPhoneBR('3134567890'), '(31) 3456-7890');
  assert.equal(maskCep('30140071'), '30140-071');
  assert.equal(onlyDigits('(21) 99876-5432'), '21998765432');
  assert.equal(parseDocumentForStorage('12.345.678/0001-99'), '12345678000199');
});

test('aba settings usa a nova central global e deixa legado fora da rota ativa', () => {
  assert.match(coordinatorCode, /<ClinicGlobalSettingsPanel/);
  assert.match(coordinatorCode, /activeTab === "settings_legacy"/);
  assert.match(settingsPanelCode, /id="clinic-master-data"/);
  assert.match(settingsPanelCode, /onEditClinicData=\{scrollToClinicData\}/);
  for (const label of [
    'Dados da clínica',
    'Dados de contato',
    'Dados fiscais e documentais',
    'Profissional responsável',
    'Dados assistenciais e documentos',
    'Preferências da clínica',
  ]) {
    assert.match(settingsPanelCode, new RegExp(label));
  }
});

test('logo assinatura e foto continuam usando os mesmos fluxos de mídia', () => {
  assert.match(settingsPanelCode, /setClinicLogoDataUrl/);
  assert.match(settingsPanelCode, /setTherapistSignatureDataUrl/);
  assert.match(settingsPanelCode, /setTherapistProfilePhotoUrl/);
  assert.match(settingsPanelCode, /readImageAsDataUrl\(file, setters\.setClinicLogoDataUrl\)/);
  assert.match(settingsPanelCode, /readImageAsDataUrl\(file, setters\.setTherapistSignatureDataUrl\)/);
  assert.match(settingsPanelCode, /readImageAsDataUrl\(file, setters\.setTherapistProfilePhotoUrl\)/);
  assert.match(settingsPanelCode, /retryMediaIfBroken\("logo"\)/);
  assert.match(settingsPanelCode, /retryMediaIfBroken\("signature"\)/);
  assert.match(settingsPanelCode, /retryMediaIfBroken\("profile"\)/);
});

test('salvamento normaliza dados globais e sincroniza perfil TISS do prestador', () => {
  const save = sliceFrom(coordinatorCode, 'const handleSaveClinicSettings = async', 9000);
  for (const token of [
    'cleanClinicDocumentNumber',
    'parseDocumentForStorage(clinicCnpj)',
    'onlyDigits(clinicPhone, 11)',
    'onlyDigits(clinicWhatsapp, 11)',
    'onlyDigits(clinicPostalCode, 8)',
    'onlyDigits(clinicCnesCode, 12)',
    'dataService.updateClinicTissProfile',
    'dataService.updateProfessionalBillingProfile',
    'clinicDocumentType',
    'clinicProviderCode',
  ]) {
    assert.match(save, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('backend persiste novos campos cadastrais em sessão, metadata e clinics', () => {
  const compact = sliceFrom(serverCode, 'function compactClinicSettingsForSession', 2400);
  for (const token of [
    'clinicLegalName',
    'clinicDocumentType',
    'clinicDocumentNumber',
    'clinicWhatsapp',
    'clinicSite',
    'clinicAddressLine',
    'clinicPostalCode',
    'clinicCnesCode',
    'clinicProviderCode',
  ]) {
    assert.match(compact, new RegExp(token));
  }

  const profileRoute = sliceFrom(serverCode, "app.post('/api/profile/:userId'", 26000);
  for (const token of [
    'clinicLegalName',
    'clinicDocumentNumber',
    'clinicWhatsapp',
    'clinicSite',
    'clinicCnesCode',
    'clinicProviderCode',
    'document_number',
    'cnes_code',
    'provider_code',
    'patchTableSafely',
  ]) {
    assert.match(profileRoute, new RegExp(token));
  }
});

test('painel Faturamento e TISS não duplica formulário de prestador', () => {
  assert.match(tissPanelCode, /Resumo do prestador \/ clínica/);
  assert.match(tissPanelCode, /Editar em Dados da clínica/);
  assert.match(tissPanelCode, /onEditClinicData/);
  assert.doesNotMatch(tissPanelCode, /const saveProvider/);
  assert.doesNotMatch(tissPanelCode, /updateProvider/);
  assert.doesNotMatch(tissPanelCode, /dataService\.updateClinicTissProfile/);
  assert.doesNotMatch(tissPanelCode, /Salvar dados do prestador/);
});

test('painel Faturamento e TISS mantém formulários próprios para pagadores e profissionais', () => {
  for (const token of [
    'formatDocument',
    'savePayer',
    'saveProfessional',
    'dataService.updatePayerTissProfile',
    'dataService.updateProfessionalBillingProfile',
    'parseDocumentForStorage(professionalForm.documentNumber)',
    'onlyDigits(professionalForm.cboCode, 12)',
  ]) {
    assert.match(tissPanelCode, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('profissional edita o próprio perfil faturável e a clínica mantém gestão global', () => {
  assert.match(settingsPanelCode, /Perfil profissional e faturável/);
  assert.match(settingsPanelCode, /cadastro profissional e faturável global/);
  assert.match(settingsPanelCode, /therapistDocumentType/);
  assert.match(settingsPanelCode, /therapistProviderCode/);
  assert.match(coordinatorCode, /dataService\.getOwnProfessionalBillingProfile\(\)/);
  assert.match(coordinatorCode, /dataService\.updateOwnProfessionalBillingProfile/);
  assert.match(coordinatorCode, /dataService\.updateProfessionalBillingProfile\(ownProfessionalId/);
  assert.match(tissPanelCode, /Profissionais executantes/);
  assert.match(tissPanelCode, /Abrir cadastro completo/);
  assert.match(tissPanelCode, /!\["equipe", "team"\]\.includes\(name\)/);
  assert.match(dataServiceCode, /\/api\/tiss\/professional-profile\/me/);
});

test('backend e RLS restringem autoedição ao próprio profissional', () => {
  const ownReadStart = serverCode.indexOf("app.get('/api/tiss/professional-profile/me'");
  const ownPatchStart = serverCode.indexOf("app.patch('/api/tiss/professional-profile/me'");
  const adminListStart = serverCode.indexOf("app.get('/api/admin/tiss/professional-profiles'", ownPatchStart);
  const ownReadRoute = serverCode.slice(ownReadStart, ownPatchStart);
  const ownPatchRoute = serverCode.slice(ownPatchStart, adminListStart);
  assert.match(ownReadRoute, /requireRoles\('therapist', 'coordinator', 'admin', 'owner'\)/);
  assert.match(ownReadRoute, /professionalId = sanitizeString\(req\.session\.user\?\.id/);
  assert.doesNotMatch(ownReadRoute, /req\.params\.professionalId/);
  assert.match(ownPatchRoute, /professionalId = sanitizeString\(req\.session\.user\?\.id/);
  assert.match(ownPatchRoute, /upsertProfessionalBillingProfile/);
  assert.doesNotMatch(ownPatchRoute, /req\.params\.professionalId/);
  assert.match(serverCode, /\['equipe', 'team'\]\.includes\(ownerName\)/);
  assert.match(professionalSelfServiceMigration, /professional_id = auth\.uid\(\)/);
  assert.match(professionalSelfServiceMigration, /u\.role = 'therapist'/);
  assert.match(professionalSelfServiceMigration, /u\.clinic_id = professional_billing_profiles\.clinic_id/);
  assert.doesNotMatch(professionalSelfServiceMigration, /using\s*\(\s*true\s*\)/i);
});

test('endpoints TISS normalizam documento, CNES, telefone, CEP e CBO no backend', () => {
  const providerRoute = sliceFrom(serverCode, "app.patch('/api/admin/tiss/provider-profile'", 3600);
  assert.match(providerRoute, /document_number:[\s\S]*replace\(\/\\D\/g, ''\)/);
  assert.match(providerRoute, /cnes_code:[\s\S]*replace\(\/\\D\/g, ''\)/);
  assert.match(providerRoute, /postal_code:[\s\S]*replace\(\/\\D\/g, ''\)/);
  assert.match(providerRoute, /phone:\s*sanitizePhone\(req\.body\?\.phone\)/);

  const professionalUpsert = sliceFrom(serverCode, 'const upsertProfessionalBillingProfile = async', 4200);
  assert.match(professionalUpsert, /document_number:[\s\S]*replace\(\/\\D\/g, ''\)/);
  assert.match(professionalUpsert, /cbo_code:[\s\S]*replace\(\/\\D\/g, ''\)/);
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

console.log(`${passed}/${tests.length} settings checks passed`);
