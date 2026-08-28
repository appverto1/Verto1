import fs from 'node:fs';
import assert from 'node:assert/strict';

const component = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');

const start = component.indexOf('{isCreatingNewTask ? (');
const end = component.indexOf('<div className="animate-fade-in space-y-4">', start);
assert.ok(start >= 0 && end > start, 'adult weekly plan creation block must be present');

const creationBlock = component.slice(start, end);

assert.equal(
  creationBlock.includes('dark:'),
  false,
  'new adult protocol creation controls must not depend on the global Tailwind dark selector',
);

assert.match(
  creationBlock,
  /isPanelDark \? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500' : 'bg-white border-slate-200 text-slate-800 placeholder:text-slate-400'/,
  'text controls must derive their light/dark appearance from the canonical panel theme',
);

assert.match(
  creationBlock,
  /isPanelDark \? 'bg-green-500\/10 border-green-400\/20' : 'bg-green-50\/30 border-green-100'/,
  'intervention creation container must keep a light green surface in light mode',
);

assert.match(
  creationBlock,
  /isPanelDark \? 'bg-slate-900\/70 border-slate-700' : 'bg-\[#F4F7FE\] border-blue-100'/,
  'assessment creation container must keep a light surface in light mode',
);

assert.ok(
  creationBlock.includes("isPanelDark ? 'bg-slate-800 border-[#7551FF] text-violet-200' : 'bg-white border-[#7551FF] text-[#7551FF]'"),
  'protocol mode buttons must preserve the existing dark appearance while rendering light controls in light mode',
);

console.log('adultWeeklyPlanLightTheme.regression: PASS');
