import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const activation = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');
const supabaseClient = fs.readFileSync('src/lib/supabase.ts', 'utf8');

const section = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const activationUrl = section(
  server,
  'type ActivationRedirectOptions',
  'function getRecoveryRedirectUrl',
);
const inviteRoute = section(
  server,
  "app.post('/api/clinic/invite'",
  "app.get('/api/clinic/invitations'",
);
const loginRoute = section(
  server,
  "app.post('/api/auth/login'",
  "app.post('/api/auth/logout'",
);
const unlinkRoute = section(
  server,
  "app.patch('/api/clinic/members/:memberId/unlink'",
  "app.get('/api/clinic/anamnesis-template'",
);

// O link deve abrir a raiz da SPA, evitando 404 de rota profunda no host público.
assert.match(activationUrl, /auth_action: 'activate'/);
assert.match(activationUrl, /return `\$\{baseUrl\.replace[\s\S]*?\}\/\?\$\{params\.toString\(\)\}`/);
assert.doesNotMatch(activationUrl, /\/ativar\?role=/);
assert.match(app, /authAction === 'activate'/);
assert.match(activation, /auth_action/);
assert.match(supabaseClient, /authAction === 'activate'/);

// O convite carrega identidade exata e distingue conta nova de acesso existente.
assert.match(inviteRoute, /const reusedExistingAuthAccess = Boolean/);
assert.match(inviteRoute, /email_confirmed_at \|\| authUser\?\.confirmed_at/);
assert.match(inviteRoute, /invitationId: data\?\.id/);
assert.match(inviteRoute, /inviteMode: reusedExistingAuthAccess \? 'existing' : 'new'/);
assert.match(inviteRoute, /const activationLink = reusedExistingAuthAccess[\s\S]*?\? activationEntryUrl/);
assert.match(inviteRoute, /type: authUserAlreadyExisted \? 'recovery' : 'signup'/);

// Conta existente usa senha/Google atuais, sem criar outra identidade Auth.
assert.match(activation, /isExistingAccountInvite/);
assert.match(activation, /Use o mesmo acesso que você já possui na Verto/);
assert.match(activation, /Entrar e aceitar convite/);
assert.match(activation, /passwordSetupCompleted: false/);
assert.match(activation, /invitationId,/);
assert.match(activation, /verto_activation_invitation_id/);
assert.match(activation, /redirectTo: `\$\{window\.location\.origin\}\/\?\$\{redirectParams\.toString\(\)\}`/);
assert.match(app, /invitationId: authContext\?\.invitationId \|\| null/);
assert.match(app, /activationInvitationId/);

// O backend aceita o convite pelo UUID + e-mail autenticado, mesmo se houver outro workspace.
assert.match(loginRoute, /const requestedInvitationId = sanitizeString\(req\.body\?\.invitationId, 120\)/);
assert.match(loginRoute, /\.eq\('id', requestedInvitationId\)/);
assert.match(loginRoute, /\.eq\('email', safeAuthEmail\)/);
assert.match(loginRoute, /\.in\('status', \['pending', 'accepted'\]\)/);
assert.match(loginRoute, /let invitationForWorkspace = requestedClinicInvitation/);
assert.match(loginRoute, /if \(invitationForWorkspace && ensureClinicRole\(invitationForWorkspace\.role\)\)/);
assert.match(loginRoute, /onConflict: 'user_id,clinic_id'/);
assert.match(loginRoute, /clinic_id: invitationForWorkspace\.clinic_id/);
assert.match(loginRoute, /role: invitationForWorkspace\.role/);
assert.match(loginRoute, /workspaces\.find\(\(w: any\) => w\.clinicId === invitedWorkspaceId\)/);
assert.match(loginRoute, /CLINIC_INVITATION_ALREADY_USED/);
assert.match(loginRoute, /activeAcceptedMembership/);

// Desvincular mantém a identidade e apenas inativa a membership anterior.
assert.match(unlinkRoute, /status: 'inactive'/);
assert.match(unlinkRoute, /userUpdatePayload\.clinic_id = null/);
assert.doesNotMatch(unlinkRoute, /auth\.admin\.deleteUser|deleteUser\(/);

console.log('clinicReinviteAccess.test.ts: ok');
