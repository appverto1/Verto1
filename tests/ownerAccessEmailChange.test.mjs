import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/SuperAdminDashboard.tsx', import.meta.url), 'utf8');
const activation = fs.readFileSync(new URL('../src/components/ActivationAccess.tsx', import.meta.url), 'utf8');

const route = server.match(
  /app\.patch\(\s*['"]\/api\/owner\/users\/:userId\/access-email['"][\s\S]*?app\.get\(\s*['"]\/api\/owner\/financial-overview['"]/
)?.[0] || '';

assert.ok(route, 'owner access-email route must exist');
assert.match(route, /checkAuth,\s*checkOwner/);
assert.match(route, /requestReason\.length < 6/);
assert.match(route, /supabase\.auth\.admin\.getUserById\(targetUserId\)/);
assert.match(route, /findAuthUserByEmail\(nextEmail\)/);
assert.match(route, /supabase\.auth\.admin\.updateUserById\(targetUserId,\s*\{[\s\S]*?email: nextEmail/);
assert.match(route, /\.from\('users'\)[\s\S]*?\.update\(\{ email: nextEmail \}\)/);
assert.match(route, /rollbackFailed/);
assert.match(route, /persistIdentityAuditLog/);
assert.doesNotMatch(route, /stripe\./i, 'access email change must not mutate Stripe');
assert.doesNotMatch(route, /sales_offers[\s\S]*?\.update/i, 'access email change must not rewrite commercial contracts');

assert.match(dashboard, /Trocar e-mail de acesso/);
assert.match(dashboard, /requestReason: reason/);
assert.match(dashboard, /Não altera e-mail contratual, proposta ou cobrança Stripe/);
assert.match(dashboard, /\/api\/owner\/users\/\$\{encodeURIComponent\(userId\)\}\/access-email/);

assert.match(activation, /aria-label=\{showPassword \? 'Ocultar senha' : 'Mostrar senha'\}/);
assert.match(activation, /type=\{showPassword \? 'text' : 'password'\}/);

console.log('ownerAccessEmailChange.test.mjs: ok');
