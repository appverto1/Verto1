import assert from 'node:assert/strict';
import fs from 'node:fs';

const builder = fs.readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
const selectSection = builder.match(/const selectSimulation = async[\s\S]*?const renameSimulation = async/)?.[0] || '';
const summarySection = builder.match(/const summaryPreview =[\s\S]*?const selectedSimulationHasVersionedEconomics/)?.[0] || '';
const publicPreview = builder.match(/const publicPreviewOffer = useMemo[\s\S]*?if \(useLegacyFallback\)/)?.[0] || '';
const summaryScope = builder.match(/\{\(\(\) => \{\s*const preview = summaryPreview;[\s\S]*?<\/aside>[\s\S]*?\}\)\(\)\}/)?.[0] || '';

assert.match(builder, /assumptions_snapshot: SalesAssumptionSnapshot/);
assert.match(summarySection, /selectedSimulation\?\.results_snapshot \|\| preview/);
assert.match(summarySection, /selectedSimulation\?\.modular_input_snapshot \|\| input/);
assert.match(summarySection, /selectedSimulation[\s\S]*?selectedSimulation\.assumptions_snapshot \|\| null[\s\S]*?: assumptions/);
assert.match(summarySection, /period: summaryPreview\.promotional/);
assert.match(summarySection, /lines: summaryPreview\.lines/);

assert.match(selectSection, /setSelectedSimulationId\(simulation\.id\)/);
assert.doesNotMatch(selectSection, /setInput\(\(current\)[\s\S]*?simulation\.modular_input_snapshot/);
assert.match(selectSection, /candidate\.status === 'selected'[\s\S]*?status: 'saved'/);
assert.match(selectSection, /snapshot congelado deste cenário/);

assert.match(publicPreview, /const previewSource = summaryPreview/);
assert.match(publicPreview, /const inputSource = summaryInput/);
assert.match(publicPreview, /selectedSimulation\?\.scenario_name/);
assert.match(publicPreview, /selectedSimulation\?\.public_notes/);

assert.match(summaryScope, /Snapshot selecionado/);
assert.match(summaryScope, /const promotionalMoneyFlow = summaryMoneyFlow/);
assert.match(summaryScope, /const currentCommercialCapacity/);
assert.match(summaryScope, /selectedCommercialModuleNames = preview/);
assert.doesNotMatch(builder, /selectedSimulationTrialMismatch/);

console.log('salesScenarioSelectionSnapshotRestore20260831.regression.test.mjs: OK');
