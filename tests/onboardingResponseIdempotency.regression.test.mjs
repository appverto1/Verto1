import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/components/OnboardingHost.tsx', import.meta.url), 'utf8');

assert.match(source, /useRef<\{ fingerprint: string; idempotencyKey: string \} \| null>\(null\)/, 'response intent must persist across retryable submit attempts');
assert.match(source, /const fingerprint = JSON\.stringify\(\[publication\.id, slotId, participants\]\)/, 'intent identity must include publication, slot and participants');
assert.match(source, /submitIntentRef\.current = \{ fingerprint, idempotencyKey: crypto\.randomUUID\(\) \}/, 'a new key must be created only when the intent fingerprint changes');
assert.match(source, /idempotencyKey,\n\s*\}\);/, 'submit must reuse the persisted intent key');
assert.doesNotMatch(source, /idempotencyKey:\s*crypto\.randomUUID\(\)/, 'submit payload must not generate a new key per attempt');
assert.match(source, /else \{\n\s*setFeedback\('Não foi possível confirmar agora\.[\s\S]*?\n\s*\}/, 'retryable failure must preserve the current intent');
assert.match(source, /SLOT_TAKEN[\s\S]*?submitIntentRef\.current = null;[\s\S]*?setSlotId\(''\)/, 'slot conflict must retire the old intent before a new slot is chosen');

console.log('onboarding response idempotency regression: PASS');
