import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

const routeStart = server.indexOf("app.patch('/api/aba/patients/:patientId/therapeutic-plans/:planId'");
assert.notEqual(routeStart, -1, 'therapeutic plan PATCH route must exist');
const routeEnd = server.indexOf("app.get('/api/aba/program-templates'", routeStart);
assert.notEqual(routeEnd, -1, 'therapeutic plan PATCH route end marker must exist');
const route = server.slice(routeStart, routeEnd);

assert.match(route, /const isPts = String\(existing\.mode \|\| ''\)\.toLowerCase\(\) === 'interdisciplinary';/);
assert.match(route, /const derivedLastReviewedAt = isPts\s*\? ptsLastReviewedAt\(ptsPayload\)\s*:\s*existing\.last_reviewed_at;/);
assert.match(route, /req\.body\?\.lastReviewedAt \?\? req\.body\?\.last_reviewed_at \?\? derivedLastReviewedAt/);
assert.doesNotMatch(route, /req\.body\?\.lastReviewedAt \?\? req\.body\?\.last_reviewed_at \?\? ptsLastReviewedAt\(ptsPayload\)/);

console.log('Block 6 Test 7 specialty activation 500 regression: PASS');
