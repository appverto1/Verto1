import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(p,'utf8');
test('Main mounts standalone partner API before catchall and protects public signup by origin',()=>{
  const s=read('server.ts'),guard=read('src/utils/sensitiveApiMutationProtection.mjs');
  assert.match(s,/registerPartnershipRoutes\(app,\{supabase,checkAuth,checkPlatformAdmin\}\)/);
  assert.ok(s.indexOf('registerPartnershipRoutes(app,') < s.indexOf("app.all('/api/*'"));
  assert.ok(s.indexOf('createSensitiveApiMutationProtectionMiddleware({') < s.indexOf('registerPartnershipRoutes(app,'));
  assert.match(guard,/partnerEntryPreAuthPattern/);
  assert.match(s,/CLINICAL_SESSION_ACTIVE|Partner portal role check failed/);
});
test('Public landing, dashboard and referral form can reach isolated Parcerias',()=>{
  const app=read('src/App.tsx'),landing=read('src/components/LandingPage.tsx');
  const owner=read('src/components/SuperAdminDashboard.tsx'),therapist=read('src/components/TherapistDashboard.tsx');
  const interest=read('src/components/SalesInterestForm.tsx');
  assert.match(app,/isExternalPartnerRoute/);
  assert.match(app,/<ExternalPartnershipPortal \/>/);
  assert.match(landing,/href="\/parcerias"/);
  assert.match(owner,/<OwnerPartnershipsPanel \/>/);
  assert.match(therapist,/<PartnershipPanel onBack=\{handleBackView\}/);
  assert.match(interest,/Quem te indicou\?/);
});

test('partner Google login preserves active clinical sessions and explains denials',()=>{
  const portal=read('src/components/ExternalPartnershipPortal.tsx');
  const exchange=portal.split('const exchangeSession = async ')[1]?.split('  useEffect(() => {')[0];
  assert.ok(exchange,'partner OAuth session exchange must exist');
  assert.match(exchange,/CLINICAL_SESSION_ACTIVE: 'Existe uma sessão clínica ativa/);
  assert.match(exchange,/EMAIL_VERIFICATION_REQUIRED: 'Não foi possível validar/);
  assert.doesNotMatch(exchange,/\['CLINICAL_SESSION_ACTIVE', 'PARTNER_NOT_REGISTERED'/);
  const passwordLogin=portal.split('const loginWithPassword = async ')[1]?.split('const activateWithPassword = async ')[0];
  assert.ok(passwordLogin,'password login form must exist');
  assert.doesNotMatch(passwordLogin,/\.auth\.signOut\(/,'failed password login must not sign out a clinical session');
});
