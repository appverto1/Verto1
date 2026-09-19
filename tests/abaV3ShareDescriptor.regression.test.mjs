import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/AbaV3ClinicalChartPanel.tsx', 'utf8');
const legacy = readFileSync('src/components/AbaClinicalChartsPanel.tsx', 'utf8');

const descriptor = panel.match(/export type AbaV3ShareDescriptor = \{([\s\S]*?)\n\};/)?.[1] || '';
assert.match(descriptor, /schemaVersion: 1;/, 'ABA descriptor must be versioned');
assert.match(descriptor, /family: 'ABA_V3';/, 'ABA descriptor must identify the V3 family');
assert.match(descriptor, /domain: 'skills' \| 'behaviors' \| 'maintenance';/, 'only stable ABA chart domains may be shared');
assert.match(descriptor, /metricSignature: string;/, 'descriptor must preserve the selected metric signature');
assert.match(descriptor, /seriesRefs: AbaV3ShareSeriesRef\[\];/, 'descriptor must reference canonical series identities');
assert.doesNotMatch(descriptor, /points|values|observations/i, 'descriptor must never copy clinical points');

const seriesRef = panel.match(/export type AbaV3ShareSeriesRef = \{([\s\S]*?)\n\};/)?.[1] || '';
for (const field of ['targetId', 'measurementModelVersion', 'phaseAssignmentId', 'metricKey', 'seriesKey']) {
  assert.match(seriesRef, new RegExp(`${field}: string;`), `canonical ABA series ref is missing ${field}`);
}

assert.match(panel, /onShareDescriptorChange\?: \(descriptor: AbaV3ShareDescriptor \| null\) => void;/, 'panel must expose an optional technical callback');
assert.match(panel, /activeDomain === 'overview'[\s\S]*activeDomain === 'mastery'[\s\S]*activeDomain === 'changes'[\s\S]*return null;/, 'aggregate or ambiguous ABA views must not emit a share descriptor');
assert.match(panel, /targetId: clean\(segment\.target_id\)/, 'descriptor must reuse canonical target identity');
assert.match(panel, /measurementModelVersion: clean\(segment\.measurement_model_version\)/, 'descriptor must preserve the V3 model boundary');
assert.match(panel, /phaseAssignmentId: clean\(segment\.phase_assignment_id\)/, 'descriptor must preserve phase continuity');
assert.match(panel, /metricKey: clean\(segment\.metric_key\)/, 'descriptor must reuse the canonical metric key');
assert.match(panel, /seriesKey: clean\(segment\.series_key\)/, 'descriptor must reuse the canonical series key');
assert.match(panel, /seriesRefs\.some\(\(ref\) => !ref\.targetId[\s\S]*!ref\.seriesKey\)/, 'incomplete series identity must fail closed');
assert.match(panel, /onShareDescriptorChange\?\.\(shareDescriptor\)/, 'callback must receive the derived descriptor');
assert.doesNotMatch(legacy, /AbaV3ShareDescriptor|onShareDescriptorChange/, 'legacy ABA panel must remain outside the share contract');

console.log('abaV3ShareDescriptor.regression.test.mjs: ok');
