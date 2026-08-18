import fs from 'node:fs';
import assert from 'node:assert/strict';

const therapeuticPlan = fs.readFileSync(new URL('../src/utils/therapeuticPlan.ts', import.meta.url), 'utf8');
const sessionMode = fs.readFileSync(new URL('../src/components/SessionMode.tsx', import.meta.url), 'utf8');

assert.match(
  therapeuticPlan,
  /const isActiveSessionTarget = programStatus === 'maintenance'[\s\S]*?targetStatus === 'maintenance'[\s\S]*?: targetStatus === 'teaching';/,
  'A sessão deve projetar somente alvos clinicamente ativos do programa (ensino/manutenção), sem antecipar alvos não iniciados.',
);
assert.match(
  therapeuticPlan,
  /if \(!isActiveSessionTarget\) return \[\];/,
  'Alvos pausados, dominados ou ainda não iniciados não devem entrar automaticamente na sessão.',
);
assert.match(
  therapeuticPlan,
  /if \(canonicalTherapeuticGoals\.length > 0\) \{[\s\S]*?return canonicalTherapeuticGoals;/,
  'Quando existe Plano terapêutico canônico, metas PEI/legadas devem funcionar apenas como fallback e não contaminar a sessão.',
);
assert.match(
  sessionMode,
  /mergeLegacyAndTherapeuticSessionGoals\(legacySessionGoals, therapeuticSessionGoals\)/,
  'SessionMode deve continuar usando o resolvedor central, preservando o fallback legado quando não há plano terapêutico.',
);

console.log('abaSessionActivePlanTargets.regression.test.mjs: ok');
