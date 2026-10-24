import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');

const selector = dashboard.match(
  /const professionalPaymentOptions = useMemo\(\s*\(\) => (therapistFilterOptions\.filter\(\(member\) =>[\s\S]*?\n    \)),\s*\[therapistFilterOptions\]/,
);
assert.ok(selector, 'repasse deve ter seletor próprio derivado da equipe autorizada');
const fixtures = [
  { id: 'valid', role: 'therapist', status: 'active', clinicSpecialty: 'Fonoaudiologia' },
  { id: 'revoked', role: 'therapist', status: 'inactive', clinicSpecialty: 'Fonoaudiologia' },
  { id: 'manager', role: 'director', status: 'active', clinicSpecialty: 'Fonoaudiologia' },
  { id: 'pending', role: 'therapist', status: 'pending', clinicSpecialty: 'Fonoaudiologia' },
  { id: 'no-clinic-specialty', role: 'therapist', status: 'active', clinicSpecialty: null },
  { id: 'other-role', role: 'receptionist', status: 'active', clinicSpecialty: 'Fonoaudiologia' },
];
const eligible = runInNewContext(selector[1], { therapistFilterOptions: fixtures });
assert.deepEqual(Array.from(eligible, (item) => item.id), ['valid']);

assert.match(dashboard, /const member = professionalPaymentOptions\.find\(\(item\) => item\.id === selectedProfessionalPaymentId\)/,
  'Salvar deve resolver a mesma lista autorizada exibida ao usuário');
assert.match(dashboard, /\{professionalPaymentOptions\.map\(\(member\) => \(\s*<option key=\{`professional-payment-\$\{member\.id\}`\}/,
  'modal de repasses não pode oferecer membros fora da lista autorizada');
assert.match(dashboard, /\{therapistFilterOptions\.map\(\(member\) => \(\s*<option key=\{`transfer-filter-\$\{member\.id\}`\}/,
  'filtro histórico de repasses permanece intacto');
assert.match(dashboard, /const appointmentProfessionalOptions = useMemo/,
  'lista de profissionais da Agenda permanece independente');
assert.match(dashboard, /canReadTeam \? dataService\.getClinicMembers\(\)/,
  'opções devem vir da equipe autenticada e não de perfil global');
assert.match(dashboard, /dataService\.getClinicSchedulingSpecialties\(workspaceId\)/,
  'especialidade da clínica deve vir do endpoint isolado por tenant');

const identityLoader = server.slice(
  server.indexOf('const loadProfessionalPaymentIdentities ='),
  server.indexOf('const loadPersistedFinancialSeriesRows ='),
);
assert.match(identityLoader, /\.from\('clinic_memberships'\)/);
assert.match(identityLoader, /\.eq\('clinic_id', clinicId\)/);
assert.match(identityLoader, /\.eq\('role', 'therapist'\)/);
assert.match(identityLoader, /\.eq\('status', 'active'\)/);
assert.match(identityLoader, /\.in\('user_id', uniqueIds\)/);
const batchRoute = server.slice(
  server.indexOf("app.post('/api/financial/professional-payments/batch'"),
  server.indexOf("app.post('/api/financial/professional-payments'"),
);
assert.match(batchRoute, /loadProfessionalPaymentIdentities\(clinicId, professionalIds\)/);
assert.match(batchRoute, /professionalIdentities\.size !== professionalIds\.length/);
assert.match(batchRoute, /payload\.professional_name = identity\.name/);
assert.match(batchRoute, /payload\.specialty = identity\.specialty/);
console.log('p1ProfessionalPaymentMembershipOptions.regression.test.mjs: ok');
