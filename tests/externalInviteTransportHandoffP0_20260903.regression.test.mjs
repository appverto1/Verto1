import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExternalEvolutionActivationHandoffUrl,
  externalEvolutionInvitationCookieOptions,
} from '../src/utils/externalEvolutionInviteHandoff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src/components/ExternalEvolutionShare.tsx'), 'utf8');

const publicId = 'd438e831-6293-4c95-b9c3-ffd5be9a49a7';
const rawToken = 'x'.repeat(43);
const url = buildExternalEvolutionActivationHandoffUrl(`https://staging.appverto.com.br/evolucao-compartilhada/${publicId}`, rawToken);
const parsed = new URL(url);
assert.equal(parsed.pathname, `/evolucao-compartilhada/${publicId}/convite`);
assert.equal(parsed.searchParams.get('t'), rawToken);
assert.equal(parsed.hash, '');

const railwayCookie = externalEvolutionInvitationCookieOptions({ secureValue: true });
assert.deepEqual(
  { httpOnly: railwayCookie.httpOnly, secure: railwayCookie.secure, sameSite: railwayCookie.sameSite, path: railwayCookie.path },
  { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/external' },
);

// Server route: validate once, set signed HttpOnly context, never consume at click, redirect clean.
assert.match(server, /app\.get\('\/evolucao-compartilhada\/:publicId\/convite'/);
assert.match(server, /Referrer-Policy', 'no-referrer'/);
assert.match(server, /Cache-Control', 'no-store, max-age=0'/);
assert.match(server, /validateExternalEvolutionActivationToken\(publicId, rawToken\)/);
assert.match(server, /setExternalEvolutionInvitationCookie\(res, validated\.loaded, validated\.tokenRow\)/);
assert.match(server, /res\.redirect\(303, cleanPath\)/);
const handoffStart = server.indexOf("app.get('/evolucao-compartilhada/:publicId/convite'");
const handoffEnd = server.indexOf("app.get('/api/external/evolution/:publicId'", handoffStart);
const handoffBlock = server.slice(handoffStart, handoffEnd);
assert.doesNotMatch(handoffBlock, /consume_external_evolution_activation_token_v1/, 'handoff must not consume the activation token');
assert.doesNotMatch(handoffBlock, /rawToken[^\n]*(console|log)|console[^\n]*rawToken/, 'handoff logs must not contain raw token');

// Bootstrap accepts COOKIE or legacy BODY and staging diagnostics expose only safe state labels.
assert.match(server, /resolveExternalEvolutionInvitationCredential\(req, res, publicId, rawActivationToken\)/);
assert.match(server, /transport: 'COOKIE'/);
assert.match(server, /transport: 'BODY'/);
assert.match(server, /RAILWAY_ENVIRONMENT_NAME|RAILWAY_ENVIRONMENT/);
assert.doesNotMatch(server, /VERTO_DEPLOYMENT_ENV/);
assert.match(server, /inviteTransport/);
assert.match(server, /tokenState/);
assert.match(server, /externalSessionState/);
assert.match(server, /resolvedMode/);

// Revocation is rechecked on every cookie bootstrap; the cookie is never authority by itself.
const cookieInspectorStart = server.indexOf('async function inspectExternalEvolutionInvitationCookie');
const cookieInspectorEnd = server.indexOf('async function resolveExternalEvolutionInvitationCredential', cookieInspectorStart);
const cookieInspector = server.slice(cookieInspectorStart, cookieInspectorEnd);
assert.match(cookieInspector, /loadActiveExternalEvolutionShare\(publicId\)/);
assert.match(cookieInspector, /external_evolution_activation_tokens/);
assert.match(cookieInspector, /invalidated_at/);
assert.match(cookieInspector, /consumed_at/);
assert.match(cookieInspector, /expires_at/);

// Successful login/activation clears the invitation cookie. Legacy raw token is not kept in browser storage.
assert.match(server, /clearExternalEvolutionInvitationCookie\(res, publicId\)/);
assert.doesNotMatch(ui, /sessionStorage\.setItem\([^\n]*activation/i);
assert.doesNotMatch(ui, /localStorage\.setItem\([^\n]*activation/i);
assert.match(ui, /readExternalEvolutionActivationTokenFromUrl/);

console.log('externalInviteTransportHandoffP0_20260903.regression: PASS');
