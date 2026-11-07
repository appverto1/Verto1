import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Item 20: never tell a clinician that a plan/PTS was saved or activated
// without an explicit backend acknowledgement. Keep the API and RLS authoritative.
const panel = readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const sections = [
  ['createPlanScope', 'const createPlanScope = async () => {', '  const draftVersionForScope ='],
  ['changePlanScopeStatus', 'const changePlanScopeStatus = async (', '  const savePlanScope ='],
  ['savePlanScope', 'const savePlanScope = async () => {', '  const savePtsScope ='],
  ['savePtsScope', 'const savePtsScope = async (', '  const savePtsEvent ='],
];

for (const [name, start, end] of sections) {
  const from = panel.indexOf(start);
  const until = panel.indexOf(end, from + start.length);
  assert.ok(from >= 0 && until > from, `missing ${name} boundary`);
  const action = panel.slice(from, until);
  const guard = action.match(/if \\((response\\?\\.success !== true)\\) \\{/g) || [];
  assert.equal(guard.length, 1, `${name}: exactly one final explicit-ACK guard`);
  const expression = 'response?.success !== true';
  const cases = [
    [undefined, true], [null, true], [{}, true],
    [{ success: false }, true], [{ success: null }, true],
    [{ success: 0 }, true], [{ success: 1 }, true],
    [{ success: 'true' }, true], [{ success: true }, false],
  ];
  for (const [response, mustReject] of cases) {
    assert.equal(vm.runInNewContext(expression, { response }), mustReject,
      `${name}: invalid response must not be treated as success`);
  }
  assert.match(action, /setError\\(response\\?\\.message \\|\\| response\\?\\.error/,
    `${name}: keep the existing error feedback`);
}
const creation = panel.slice(panel.indexOf('const createPlanScope = async () => {'), panel.indexOf('  const draftVersionForScope ='));
assert.match(creation, /idempotencyKey: scopeIdempotencyKeyRef\\.current/,
  'plan creation must preserve the existing idempotency key');
const editing = panel.slice(panel.indexOf('const savePlanScope = async () => {'), panel.indexOf('  const savePtsScope ='));
assert.match(editing, /expectedVersion: scopeEditDraft\\.expectedVersion/,
  'plan editing must preserve optimistic version control');
const pts = panel.slice(panel.indexOf('const savePtsScope = async ('), panel.indexOf('  const savePtsEvent ='));
assert.match(pts, /PTS_DRAFT_VERSION_CONFLICT/, 'PTS conflict handling must remain intact');
assert.match(pts, /ptsDraftWriteInFlightRef\\.current = true/, 'PTS must keep the synchronous write guard');
assert.match(pts, /ptsDraftWriteInFlightRef\\.current = false/, 'PTS must release its write guard');
assert.match(pts, /expectedDraftRevision/, 'PTS must preserve CAS revision checks');
console.log('critical20TherapeuticPlanAck.regression.test.mjs: ok');
