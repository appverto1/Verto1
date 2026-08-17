import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');

const start = app.indexOf('let authSubscription: { unsubscribe: () => void } | null = null;');
const end = app.indexOf('const checkSession = async () => {', start);
assert.notEqual(start, -1, 'auth subscription lifecycle guard must exist');
assert.notEqual(end, -1, 'session bootstrap section must exist');
const authEffect = app.slice(start, end);

// Supabase documents a deadlock when async client/API work is awaited directly
// inside onAuthStateChange. The callback must return synchronously.
assert.match(authEffect, /onAuthStateChange\(\(event, session\) => \{/);
assert.doesNotMatch(authEffect, /onAuthStateChange\(async\s*\(/);

// Auth work is deferred to a later macrotask, after the SDK can release its lock.
assert.match(authEffect, /window\.setTimeout\(\(\) => \{/);
assert.match(authEffect, /authChangeQueue\s*=\s*authChangeQueue/);
assert.match(authEffect, /\.then\(async \(\) => \{/);
assert.ok(
  authEffect.indexOf('window.setTimeout(() => {') < authEffect.indexOf('await handleLoginSuccess(session'),
  'login resolution must run only after the auth callback is deferred',
);

// The subscription cleanup must belong to the React effect itself. Returning a
// cleanup function from the async initializer is ignored by React and leaks listeners.
assert.match(authEffect, /authSubscription\?\.unsubscribe\(\)/);
assert.doesNotMatch(authEffect, /return \(\) => subscription\.unsubscribe\(\)/);
assert.match(authEffect, /disposed = true;/);

console.log('authStateChangeDeadlockRegression.test.mjs: ok');
