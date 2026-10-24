import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const session = readFileSync('src/components/SessionMode.tsx', 'utf8');
const adultStart = session.indexOf('Registre a evolução desta sessão');
const adultEnd = session.indexOf('const abaV3RevisionModal', adultStart);
assert.ok(adultStart >= 0 && adultEnd > adultStart, 'adult session empty state must exist');
const adultEmptyState = session.slice(adultStart, adultEnd);
assert.match(adultEmptyState, /Evolução e observações da sessão/);
assert.match(adultEmptyState, /value=\{sessionNote\}/);
assert.match(adultEmptyState, /onClick=\{requestEndSession\}/);
for (const label of ['Tentativas', 'Comportamentos', 'Sincronização', 'Prontuário']) {
  assert.doesNotMatch(adultEmptyState, new RegExp('>' + label + '<'), 'adult close view must not show technical card: ' + label);
}
assert.match(session, /if \(isPediatricSession && !isCompletedSessionReview\)/, 'pediatric target collection guard preserved');
assert.match(session, /postClosureSummary\.totalTrials/, 'persisted closure audit/report remains available');
assert.match(session, /postClosureSummary\.syncStatus/, 'technical sync status remains in audit/report');
console.log('p2AdultSessionNoTechnicalCards.regression.test.mjs: PASS');
