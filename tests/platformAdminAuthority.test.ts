import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260811213000_platform_admin_authority_v1.sql',
  'utf8',
);

assert.match(
  server,
  /async function isPlatformAdminUserId[\s\S]*?from\('platform_admins'\)[\s\S]*?eq\('user_id', userId\)[\s\S]*?eq\('active', true\)/,
  'autoridade de plataforma deve vir de platform_admins ativo',
);
assert.match(
  server,
  /async function checkPlatformAdmin[\s\S]*?isPlatformAdminUserId\(userId\)[\s\S]*?PLATFORM_ADMIN_REQUIRED/,
  'middleware de plataforma deve falhar fechado sem registro explícito',
);
assert.doesNotMatch(
  server,
  /const checkPlatformAdmin[\s\S]{0,500}role === 'admin'/,
  'admin legado não pode provar autoridade de plataforma pelo role',
);
assert.match(
  server,
  /function hasGlobalClinicAccess[\s\S]*?activeAccessContext\?\.kind[\s\S]*?platform_support[\s\S]*?breakGlass === true/,
  'acesso clínico global não pode ser implícito para platform admin',
);
assert.match(
  server,
  /const checkOwner = checkPlatformAdmin/,
  'rotas owner legadas devem herdar a autoridade canônica de plataforma',
);
assert.match(
  server,
  /app\.get\('\/api\/internal\/schema-status', checkAuth, checkPlatformAdmin/,
);
assert.match(
  server,
  /app\.post\('\/api\/admin\/billing\/sync-stripe-plans', checkAuth, checkPlatformAdmin/,
);

assert.match(migration, /create table public\.platform_admins/i);
assert.match(migration, /active boolean not null default true/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on table public\.platform_admins from anon, authenticated/i);
assert.match(
  migration,
  /clinic_membership_current_actor_is_global_v1[\s\S]*?select false/i,
  'owner/admin legado não pode continuar como autoridade global da clínica',
);
assert.match(
  migration,
  /manager_membership\.role in \('director', 'coordinator'\)/i,
  'gestão da membership deve ficar restrita a Diretor/Coordenador ativos',
);
assert.match(
  migration,
  /clinical_supervision_links[\s\S]*?supervisor_user_id = auth\.uid\(\)/i,
  'RLS clínica reconhece supervisão explícita sem liberar tenant inteiro',
);
assert.doesNotMatch(
  migration,
  /insert\s+into\s+public\.platform_admins/i,
  'migration nunca deve promover owner/admin automaticamente',
);


const app = fs.readFileSync('src/App.tsx', 'utf8');

assert.match(
  server,
  /function buildSessionUserPayload[\s\S]*?isPlatformAdmin:\s*input\?\.isPlatformAdmin === true/,
  'flag de platform admin precisa sobreviver à compactação/hidratação da sessão',
);
assert.match(
  server,
  /app\.post\('\/api\/auth\/2fa\/login'[\s\S]*?isPlatformAdminUserId\(boundUserId\)[\s\S]*?isPlatformAdmin:\s*isPlatformAdminLogin/,
  'login após MFA precisa devolver a autoridade de plataforma para o frontend',
);
assert.match(
  server,
  /app\.post\('\/api\/auth\/login'[\s\S]*?const isPlatformAdminLogin = await isPlatformAdminUserId[\s\S]*?isPlatformAdmin:\s*isPlatformAdminLogin/,
  'login normal precisa carregar a autoridade de plataforma na sessão',
);
assert.match(
  server,
  /app\.get\('\/api\/auth\/me'[\s\S]*?isPlatformAdminUserId\(sessionUserId\)[\s\S]*?hasVerifiedOwnerMfaSession\(req\.session\.user\)/,
  'auth/me precisa restaurar autoridade de plataforma e continuar exigindo MFA privilegiado',
);
const platformPanelIndex = app.indexOf("user?.isPlatformAdmin === true ? (");
const workspacePickerIndex = app.indexOf('showWorkspacePicker && (accessContextOptions.length > 0 || pendingClinicInvitations.length > 0) ? (');
const helpRouteIndex = app.indexOf("isHelpRoute && isProfessionalClinicRole(user.role) ? (");
assert.ok(platformPanelIndex >= 0, 'frontend precisa rotear platform admin pelo flag canônico');
assert.ok(workspacePickerIndex > platformPanelIndex, 'painel da plataforma deve ter prioridade sobre workspaces clínicos');
assert.ok(helpRouteIndex > platformPanelIndex, 'painel da plataforma deve ter prioridade sobre /ajuda');
assert.match(
  app.slice(platformPanelIndex, platformPanelIndex + 220),
  /<SuperAdminDashboard onLogout=\{handleLogout\} \/>/,
  'platform admin deve abrir diretamente o painel administrativo da Verto',
);
assert.doesNotMatch(
  app,
  /user\.role === 'owner' \? \([\s\S]{0,120}<SuperAdminDashboard/,
  'papel owner legado não pode decidir o painel de plataforma no frontend',
);

console.log('platformAdminAuthority.test.ts: ok');
