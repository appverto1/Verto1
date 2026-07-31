import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const activation = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');
const supabaseClient = fs.readFileSync('src/lib/supabase.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260731193000_atomic_clinic_invitation_acceptance.sql', 'utf8');

const section = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const activationUrl = section(server, 'type ActivationRedirectOptions', 'function getRecoveryRedirectUrl');
const inviteRoute = section(server, "app.post('/api/clinic/invite'", "app.get('/api/clinic/invitations'");
const loginRoute = section(server, "app.post('/api/auth/login'", "app.post('/api/auth/logout'");
const acceptRoute = section(server, "app.post('/api/clinic/accept-invite'", "app.post('/api/clinic/assign-role'");
const unlinkRoute = section(server, "app.patch('/api/clinic/members/:memberId/unlink'", "app.get('/api/clinic/anamnesis-template'");

// Link abre a raiz real da SPA e carrega invitation_id, evitando landing page/404.
assert.match(activationUrl, /auth_action: 'activate'/);
assert.match(activationUrl, /params\.set\('invitation_id', invitationId\)/);
assert.match(activationUrl, /return `\$\{baseUrl\.replace[\s\S]*?\}\/\?\$\{params\.toString\(\)\}`/);
assert.doesNotMatch(activationUrl, /\/ativar\?role=/);
assert.match(app, /authAction === 'activate'/);
assert.match(activation, /auth_action/);
assert.match(supabaseClient, /authAction === 'activate'/);

// Conta existente reutiliza Auth e não recebe nova senha/UUID.
assert.match(inviteRoute, /const reusedExistingAuthAccess = Boolean/);
assert.match(inviteRoute, /inviteMode: reusedExistingAuthAccess \? 'existing' : 'new'/);
assert.match(inviteRoute, /const activationLink = reusedExistingAuthAccess[\s\S]*?\? activationEntryUrl/);
assert.match(inviteRoute, /pendingInvitationPredatesUnlink/);
assert.match(inviteRoute, /invitationCreatedAt <= membershipUnlinkedAt/);
assert.match(inviteRoute, /status: 'canceled'/);
assert.match(activation, /isExistingAccountInvite/);
assert.match(activation, /Entrar e aceitar convite/);
assert.match(activation, /passwordSetupCompleted: false/);
assert.match(activation, /signInWithOAuth/);
assert.match(activation, /redirectParams\.set\('invitation_id', invitationId\)/);
assert.match(activation, /window\.history\.replaceState[\s\S]*?continuationParams\.toString\(\)/);
assert.match(activation, /if \(code \|\| tokenHash \|\| accessToken \|\| refreshToken\)/);
assert.doesNotMatch(
  section(activation, 'const establishSessionFromUrl', 'const requestActivationBootstrap'),
  /if \(hasActivationParams\)[\s\S]*?signOut/,
  'um convite simples não pode deslogar uma conta já autenticada',
);

// URL e OAuth preservam o convite; localStorage é apenas fallback, não a única fonte.
assert.match(app, /new URLSearchParams\(window\.location\.search\)\.get\('invitation_id'\)/);
assert.match(app, /const isInvitationContinuation = currentAuthAction === 'activate'/);
assert.match(app, /invitationId: currentInvitationId/);
assert.match(app, /activationFlow: isInvitationContinuation/);
assert.match(app, /publishActivationErrorMessage/);
assert.match(activation, /verto:activation-error/);
assert.match(activation, /verto_activation_error/);

// Aceite usa uma única RPC server-side e não aceita clinic_id/role do navegador.
assert.match(loginRoute, /acceptClinicInvitationAtomically\(\{/);
assert.match(acceptRoute, /acceptClinicInvitationAtomically\(\{/);
assert.match(server, /supabase\.rpc\('accept_clinic_invitation_v1'/);
assert.doesNotMatch(acceptRoute, /req\.body\?\.clinicId|req\.body\?\.clinic_id|req\.body\?\.role/);
assert.match(loginRoute, /\.eq\('id', requestedInvitationId\)/);
assert.match(loginRoute, /\.in\('status', \['pending', 'accepted'\]\)/);
assert.match(loginRoute, /sanitizeEmail\(invitation\.email\) !== safeAuthEmail/);
assert.match(loginRoute, /CLINIC_INVITATION_EMAIL_MISMATCH/);
assert.match(loginRoute, /workspaces\.find\(\(w: any\) => w\.clinicId === invitedWorkspaceId\)/);

// Transação bloqueia corrida, duplicidade, convite antigo e e-mail divergente.
assert.match(migration, /for update/i);
assert.match(migration, /CLINIC_INVITATION_EMAIL_MISMATCH/);
assert.match(migration, /CLINIC_INVITATION_ALREADY_USED/);
assert.match(migration, /v_status <> 'pending'/);
assert.match(migration, /v_invitation\.created_at[\s\S]*?v_existing_membership\.updated_at/);
assert.match(migration, /on conflict \(user_id, clinic_id\)/i);
assert.match(migration, /do update set[\s\S]*?status = 'active'/i);
assert.match(migration, /update public\.invitations[\s\S]*?status = 'accepted'/i);
assert.match(migration, /revoke all[\s\S]*?from authenticated/i);
assert.match(migration, /grant execute[\s\S]*?to service_role/i);

// Desvincular preserva a identidade e só inativa a membership.
assert.match(unlinkRoute, /status: 'inactive'/);
assert.match(unlinkRoute, /userUpdatePayload\.clinic_id = null/);
assert.doesNotMatch(unlinkRoute, /auth\.admin\.deleteUser|deleteUser\(/);

console.log('clinicReinviteAccess.test.ts: ok');
