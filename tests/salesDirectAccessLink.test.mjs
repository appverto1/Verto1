import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/components/SuperAdminDashboard.tsx', import.meta.url), 'utf8');

const route = server.match(
  /app\.post\('\/api\/owner\/users\/:userId\/access-link'[\s\S]*?app\.patch\('\/api\/owner\/users\/:userId\/access-email'/,
)?.[0] || '';

assert.ok(route, 'owner direct first-access link route must exist');
assert.match(route, /checkAuth, checkOwner, resendActivationLimiter/, 'direct link generation must require owner auth/MFA and rate limiting');
assert.match(route, /\.eq\('status', 'paid'\)/, 'only a paid sales offer may produce an access link');
assert.match(route, /metadataOfferId === requestedOfferId/, 'existing Auth metadata must bind the user to the requested paid offer');
assert.match(route, /activationEmail === accessEmail/, 'email equality may be used only when no canonical offer metadata exists');
assert.match(route, /deriveSalesActivationToken\(checkoutSessionId\)/, 'direct access link must reuse the deterministic paid-checkout credential');
assert.match(route, /email: accessEmail,[\s\S]*token: tokenHash,[\s\S]*expires_at: expiresAt/, 'pending activation must be aligned to the current access email and refreshed atomically');
assert.match(route, /loadPublicSalesActivation\(rawToken\)/, 'the exact generated credential must pass the public activation loader before exposure');
assert.match(route, /activationUrl = `\$\{getInvitationAppBaseUrl\(\)\}\/ativacao-comercial\//, 'server must construct the canonical activation URL');
assert.doesNotMatch(route, /emails\.send\(/, 'generating a direct link must not depend on e-mail delivery');
assert.doesNotMatch(route, /checkout\.sessions\.create|subscriptions\.update/, 'generating a direct link must not mutate Stripe');
assert.match(route, /owner_access_link_generation/, 'direct link generation must be audited without persisting the raw token');

const clientsRoute = server.match(
  /app\.get\('\/api\/owner\/clients'[\s\S]*?app\.post\('\/api\/owner\/users\/:userId\/access-link'/,
)?.[0] || '';
assert.ok(clientsRoute, 'owner clients route must exist before direct link route');
assert.match(clientsRoute, /supabase\.auth\.admin\.listUsers\(\{ page: 1, perPage: 500 \}\)/, 'customer recovery must resolve Auth metadata in one bounded read, not N+1');
assert.match(clientsRoute, /activationByOffer/, 'pending activation must be recoverable by immutable offer id after an access-email change');
assert.match(clientsRoute, /can_generate_activation_link: true/, 'customer DTO must explicitly surface direct-link eligibility');

assert.match(ui, /handleGenerateCustomerAccessLink/, 'Super Admin UI must implement direct link generation');
assert.match(ui, /\/api\/owner\/users\/\$\{encodeURIComponent\(customerId\)\}\/access-link/, 'UI must call the owner-only direct link endpoint');
assert.match(ui, /'Gerando\.\.\.' : 'Gerar link'/, 'Base de Clientes must expose a clear Gerar link action');
assert.match(ui, /Link pronto para enviar/, 'generated link must be shown in a dedicated ephemeral modal');
assert.match(ui, /navigator\.clipboard/, 'copy-to-clipboard must be supported without e-mail');

console.log('salesDirectAccessLink.test.mjs: OK');
