import assert from 'node:assert/strict';
import fs from 'node:fs';

const sessionModePath = new URL('../src/components/SessionMode.tsx', import.meta.url);
const attestationV2Path = new URL('../supabase/verification/20260823182500_aba_v3_default_on_pure_inherit_ui_binding_attestation_v2.sql', import.meta.url);

const sessionMode = fs.readFileSync(sessionModePath, 'utf8');
const attestationV2 = fs.readFileSync(attestationV2Path, 'utf8');

// Selecting/entering one explicit V3 target must be enough to freeze its immutable
// session binding. It must not wait for the first clinical trial write.
assert.match(sessionMode, /const primeAbaV3BindingForGoal = \(goal: any\) =>/);
assert.match(sessionMode, /abaV3PlannedModelForGoal\(goal\) !== 'V3'/);
assert.match(sessionMode, /primeAbaV3BindingForGoal\(goal\)/);
assert.match(sessionMode, /setMobileSelectedGoalKey\(goalKey\)[\s\S]{0,300}primeAbaV3BindingForGoal\(goal\)/);
assert.match(sessionMode, /onPointerDown=\{\(\) => \{ syncTrialTypeForGoal\(goal\); primeAbaV3BindingForGoal\(goal\); \}\}/);

// Pointer-down priming and the subsequent click may occur in the same gesture;
// one in-flight promise per session+target prevents duplicate resolver requests.
assert.match(sessionMode, /abaV3BindingInflightRef = useRef<Map<string, Promise<AbaV3BindingDecision \| null>>>/);
assert.match(sessionMode, /const pending = abaV3BindingInflightRef\.current\.get\(cacheKey\);[\s\S]{0,100}if \(pending\) return pending/);
assert.match(sessionMode, /abaV3BindingInflightRef\.current\.set\(cacheKey, request\)/);
assert.match(sessionMode, /abaV3BindingInflightRef\.current\.delete\(cacheKey\)/);
assert.match(sessionMode, /abaV3BindingInflightRef\.current\.clear\(\)/);

// The corrected gate must inspect the newest session even when that session has no
// binding yet. The original inner join hid this exact production defect.
assert.match(attestationV2, /left join public\.aba_session_target_measurement_bindings b/i);
assert.match(attestationV2, /when f\.binding_id is null[\s\S]{0,120}BLOCKED_FRESH_SESSION_BINDING_MISSING/i);
assert.match(attestationV2, /PASS_PURE_DEFAULT_ON_FRESH_SESSION_BINDING/);
assert.match(attestationV2, /Safety: READ ONLY/i);
assert.doesNotMatch(attestationV2, /\b(insert|update|delete)\s+(into|public\.|from)/i);

console.log('abaV3FreshSessionBindingPrime.regression: PASS');
