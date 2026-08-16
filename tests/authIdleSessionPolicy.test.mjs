import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

// Temporary product policy: authenticated users must not be logged out solely
// because the browser stayed idle. Explicit logout remains available.
assert.doesNotMatch(app, /AUTO_LOGOUT_IDLE_MS/);
assert.doesNotMatch(app, /inactivityTimerRef/);
assert.doesNotMatch(app, /autoLogoutInProgressRef/);
assert.doesNotMatch(app, /resetInactivityTimer/);
assert.match(app, /const handleLogout = async \(\) =>/);
assert.match(app, /fetch\('\/api\/auth\/logout'/);

// Server-side session continuity remains rolling/persistent; this change only
// removes the short client-side inactivity cutoff rather than weakening logout.
assert.match(server, /rolling:\s*true/);
assert.match(server, /SESSION_MAX_AGE_DAYS \|\| 30/);
assert.match(server, /app\.post\('\/api\/auth\/logout'/);

console.log('authIdleSessionPolicy.test.mjs: ok');
