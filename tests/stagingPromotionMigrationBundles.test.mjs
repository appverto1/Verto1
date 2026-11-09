import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const sourceDirectory = 'supabase/operations/promotion_staging_sources';
const migrations = readdirSync('supabase/migrations');
const original = readdirSync(sourceDirectory).filter(name => name.endsWith('.sql')).sort();
const groups = [
  { suffix: '_promote_group_sessions_and_finance.sql', files: original.filter(name => /^2026101[56].*group_/.test(name)).concat(original.filter(name => name.startsWith('20261021223000'))) },
  { suffix: '_promote_therapeutic_specialty_cycles.sql', files: original.filter(name => /^2026102(?:2130000|3143000|3155000)/.test(name)) },
  { suffix: '_promote_portal_and_commercial_integrity.sql', files: original.filter(name => /^(?:20261022091000|20261105101500|20261108195000)/.test(name)) },
];
assert.deepEqual(groups.map(group => group.files.length), [13, 3, 3]);
for (const group of groups) {
  const matching = migrations.filter(name => name.endsWith(group.suffix));
  assert.equal(matching.length, 1, group.suffix);
  const bundle = readFileSync(`supabase/migrations/${matching[0]}`, 'utf8');
  assert.match(bundle, /\bbegin;[\s\S]*\bcommit;\s*$/i);
  let position = 0;
  for (const name of group.files) {
    const source = readFileSync(`${sourceDirectory}/${name}`, 'utf8');
    const hash = createHash('sha256').update(source).digest('hex');
    const body = source.replace(/^\s*(?:begin|commit);\s*$/gim, '').trim();
    const marker = `-- Source: ${name}; sha256 ${hash}`;
    const markerAt = bundle.indexOf(marker, position);
    assert.ok(markerAt >= position, `source and digest in order: ${name}`);
    assert.ok(bundle.indexOf(body, markerAt) > markerAt, `unchanged SQL source: ${name}`);
    position = markerAt + marker.length;
  }
}
