import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260816213000_aba_v3_prompt_catalog_defaults.sql', 'utf8');
const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');

// Defaults are persisted once, set-based and without mutating any existing prompt.
assert.match(migration, /create or replace function public\.aba_prompt_type_system_defaults_v1\(\)/i);
assert.match(migration, /create trigger clinics_initialize_aba_prompt_types_v1[\s\S]*?after insert on public\.clinics/i);
assert.match(migration, /cross join public\.aba_prompt_type_system_defaults_v1\(\) defaults/i);
assert.match(migration, /where not exists \([\s\S]*?existing\.organization_id = clinic\.id[\s\S]*?existing\.key = defaults\.key/i);
assert.doesNotMatch(migration, /update\s+public\.aba_prompt_types/i);
assert.doesNotMatch(migration, /delete\s+from\s+public\.aba_prompt_types/i);
for (const key of [
  'independent', 'visual_partial', 'visual_total', 'gestural', 'verbal_partial',
  'verbal_total', 'model', 'partial_physical', 'full_physical', 'error_block', 'positional_cue',
]) {
  assert.match(migration, new RegExp(`'${key}'`));
}

// V3 collection only advertises prompt rows that actually exist in the clinic catalog.
assert.match(
  sessionMode,
  /const v3PromptedPromptOptions = useMemo\(\(\) => \([\s\S]*?activePromptOptions\.filter\(\(prompt\) => Boolean\(prompt\.id\)\)/,
);
assert.doesNotMatch(sessionMode, /defaultV3PromptedPromptOptions/);

// Tampered clients cannot use a prompt hidden from session collection.
const v3TrialStart = server.indexOf("'/api/aba/v3/trials'");
const v3TrialEnd = server.indexOf('const handleAbaV3ReadRpcError', v3TrialStart);
assert.ok(v3TrialStart >= 0 && v3TrialEnd > v3TrialStart);
const v3TrialRoute = server.slice(v3TrialStart, v3TrialEnd);
assert.match(v3TrialRoute, /\.eq\('active', true\)[\s\S]*?\.eq\('show_in_session', true\)/);
assert.match(v3TrialRoute, /ABA_V3_PROMPT_NOT_CONFIGURED/);

console.log('abaV3PromptCatalogPersistence.test.mjs: OK');
