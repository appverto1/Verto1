import assert from 'node:assert/strict';
import fs from 'node:fs';

const settings = fs.readFileSync('src/components/ClinicGlobalSettingsPanel.tsx', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const matrix = fs.readFileSync('src/components/RoleCapabilityMatrix.tsx', 'utf8');

assert.match(settings, /hasInsuranceTissModule[\s\S]*?<BillingTissSettingsPanel/, 'painel TISS deve depender do entitlement insurance_tiss');
assert.match(coordinator, /hasInsuranceTissModule=\{hasModule\("insurance_tiss"\)\}/, 'settings deve receber entitlement canônico do dashboard');
assert.match(coordinator, /saveScope === "clinic" && canManageClinicSettings && hasModule\("insurance_tiss"\)/, 'salvar clínica sem TISS não deve disparar persistência TISS desnecessária');
assert.match(matrix, /moduleAllowsCapability\(moduleAccessMode, organizationModules, item\.key\)/, 'matriz de acessos deve esconder capabilities de módulos não contratados');
assert.match(coordinator, /canManageClinicSettings && hasModule\("insurance_tiss"\)[\s\S]*?<BillingTissSettingsPanel/, 'settings legado também deve ocultar TISS quando não contratado');

console.log('organizationModuleSettingsVisibility.test.ts: ok');
