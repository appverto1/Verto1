import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('background lease failure is contained without running unleased jobs or crashing Node', () => {
  const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const runWithDistributedJobLease = async');
  const end = source.indexOf('const runQueuedActivePatientReconciliation = async', start);
  assert.ok(start >= 0 && end > start, 'background lease wrapper must exist');
  const wrapper = source.slice(start, end);
  assert.match(wrapper, /acquired = await tryAcquireDistributedJobLease\(/);
  assert.match(wrapper, /if \(!acquired\)[\s\S]*?return null;/);
  assert.match(wrapper, /return await task\(\);[\s\S]*?catch \(error: any\) \{/);
  assert.match(wrapper, /catch \(error: any\)[\s\S]*?return null;\s*\} finally \{/);
  assert.match(wrapper, /if \(acquired\)[\s\S]*?await releaseDistributedJobLease\(/);
});
