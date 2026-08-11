import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const workspace = fs.readFileSync('src/components/BillerWorkspace.tsx', 'utf8');
const authorizationModel = fs.readFileSync('src/constants/authorizationModel.ts', 'utf8');


const billingRoutePrefixes = [
  '/api/admin/tiss/',
  '/api/tiss/',
  '/api/admin/payers',
  '/api/admin/payer-requirements',
  '/api/admin/tuss/',
  '/api/conference/monthly',
  '/api/payer-options',
  '/api/patients/tiss-authorizations',
  '/api/patients/:patientId/tiss-authorizations',
];
const allowedLegacySelfRoutes = new Set([
  '/api/tiss/professional-profile/me',
]);
for (const line of server.split(/\r?\n/)) {
  const match = line.match(/app\.(get|post|patch|delete)\('([^']+)'/);
  if (!match) continue;
  const route = match[2];
  if (!billingRoutePrefixes.some((prefix) => route.startsWith(prefix))) continue;
  if (allowedLegacySelfRoutes.has(route)) continue;
  assert.doesNotMatch(
    line,
    /requireRoles\(/,
    `${match[1].toUpperCase()} ${route} não deve voltar ao gate legado por role`,
  );
}

const expectRouteCapability = (method: string, route: string, capability: string) => {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `app\\.${method}\\('${escapedRoute}'[^\\n]*requireClinicCapability\\('${capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`,
  );
  assert.match(server, pattern, `${method.toUpperCase()} ${route} deve exigir ${capability}`);
};

expectRouteCapability('get', '/api/tiss/pre-guides', 'billing.preguide.view');
expectRouteCapability('post', '/api/tiss/pre-guides/revalidate-period', 'billing.preguide.manage');
expectRouteCapability('post', '/api/tiss/official-documents', 'billing.xml.generate');
expectRouteCapability('post', '/api/tiss/xml-drafts/:draftId/validate', 'billing.xml.validate');
expectRouteCapability('get', '/api/conference/monthly', 'billing.sessions.view');
expectRouteCapability('post', '/api/conference/monthly/export', 'billing.xml.export');
expectRouteCapability('get', '/api/admin/tuss/mappings', 'billing.mapping.manage');
expectRouteCapability('get', '/api/admin/payers/:payerId/requirements', 'billing.antiglosa.view');
expectRouteCapability('post', '/api/admin/payers/:payerId/requirements', 'billing.antiglosa.manage');
expectRouteCapability('post', '/api/tiss/patient-payer-authorizations', 'patient.insurance.authorization.edit');

assert.match(
  server,
  /async function canAccessPatientBillingInCurrentClinic[\s\S]*clinic_memberships[\s\S]*status', 'active'/,
  'escopo de faturamento por paciente deve validar membership ativa na clínica',
);
assert.match(
  server,
  /const membershipRole = sanitizeString\(membershipResult\.data\.role[\s\S]*isClinicBaseRole\(membershipRole\)/,
  'papel efetivo do faturamento deve vir da membership ativa, não de owner/admin legado na sessão',
);
assert.match(
  server,
  /membershipRole === 'therapist' \|\| membershipRole === 'supervisor'[\s\S]*canAccessPatientInCurrentClinic/,
  'atores clínicos não podem usar o escopo amplo de faturamento para escapar do escopo de caso',
);
assert.match(app, /const BillerWorkspace = React\.lazy/);
assert.match(app, /user\.role === 'biller'[\s\S]{0,120}<BillerWorkspace/);
assert.doesNotMatch(
  app,
  /user\.role === 'director' \|\| user\.role === 'supervisor' \|\| user\.role === 'biller'\) \? \([\s\S]{0,120}<ClinicRoleFoundationPending/,
  'Faturista não deve permanecer preso à tela temporária de fundação',
);
assert.match(workspace, /MonthlyConferenceCenter/);
assert.match(workspace, /PayerRequirementsPanel/);
assert.doesNotMatch(workspace, /PatientDetailView|clinical\.record|anamnesis/i);
assert.match(
  authorizationModel,
  /biller: internal\([\s\S]*'patient\.insurance\.authorization\.edit'[\s\S]*'billing\.xml\.generate'/,
  'pacote padrão do faturista deve cobrir autorização operacional e geração TISS',
);

console.log('billerTissCapabilityRoutes.test.ts: ok');
