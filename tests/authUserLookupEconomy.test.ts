import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const start = server.indexOf('const AUTH_USER_EMAIL_CACHE_TTL_MS');
const end = server.indexOf('type AtomicClinicInvitationAcceptance', start);
assert.ok(start >= 0 && end > start, 'canonical Auth email lookup block must exist');

const lookup = server.slice(start, end);
const indexedLookupIndex = lookup.indexOf(".from('users')");
const directAuthLookupIndex = lookup.indexOf('supabase.auth.admin.getUserById');
const legacyPaginationIndex = lookup.indexOf('supabase.auth.admin.listUsers');

assert.ok(indexedLookupIndex >= 0, 'lookup must use the canonical public user identity first');
assert.ok(directAuthLookupIndex > indexedLookupIndex, 'Auth must be fetched directly by canonical UID');
assert.ok(legacyPaginationIndex > directAuthLookupIndex, 'global pagination must remain fallback-only');
assert.match(lookup, /\.eq\('email', target\)/, 'canonical email lookup must be indexable');
assert.match(lookup, /authUserByEmailCache\.get\(target\)/);
assert.match(lookup, /authUserByEmailInFlight\.get\(target\)/);
assert.match(lookup, /while \(page <= 20\)/);
assert.doesNotMatch(lookup, /for \(;;\)/, 'email lookup must not use an open-ended loop');

console.log('authUserLookupEconomy.test.ts: OK');
