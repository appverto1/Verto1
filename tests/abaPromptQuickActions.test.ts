import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ABA_PROMPTED_PROMPT_KEYS,
  ABA_PROMPTED_PROMPT_OPTIONS,
  resolveAbaPromptLevel
} from '../src/utils/abaPromptLevels.ts';
import { formatAbaTrialHistoryLabel } from '../src/utils/abaTrialLabels.ts';

const root = process.cwd();
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('prompted quick actions expose exactly the six clinical prompts', () => {
  assert.deepEqual([...ABA_PROMPTED_PROMPT_KEYS], [
    'visual',
    'gestural',
    'verbal',
    'model',
    'partial_physical',
    'full_physical'
  ]);
  assert.deepEqual(ABA_PROMPTED_PROMPT_OPTIONS.map((prompt) => prompt.label), [
    'Visual',
    'Gestual',
    'Verbal',
    'Modelo',
    'Física parcial',
    'Física total'
  ]);
});

test('SessionMode records each prompted action in one tap with the canonical key', () => {
  assert.match(
    sessionModeCode,
    /promptedPromptOptions\.map\(\(prompt\) => \{[\s\S]*?onClick=\{\(\) => handleTrialClick\(goal, 0\.5, 'prompted', prompt\.key\)\}/m
  );
  assert.doesNotMatch(
    sessionModeCode,
    /Prompt se houver ajuda/,
    'Prompted trials should no longer depend on a separate dropdown before recording.'
  );
});

test('prompted labels survive normalization and history formatting', () => {
  const partialPhysical = resolveAbaPromptLevel({ promptLevelKey: 'partial_physical' });
  assert.equal(partialPhysical.label, 'Física parcial');
  assert.equal(formatAbaTrialHistoryLabel({
    collectionType: 'cold_probe',
    outcome: 'prompted',
    score: 0.5,
    promptLevelKey: partialPhysical.key
  }), 'Sondagem Cold Probe · Com ajuda física parcial · 0.5');
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
