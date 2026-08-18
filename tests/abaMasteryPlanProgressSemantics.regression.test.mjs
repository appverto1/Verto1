import fs from 'node:fs';
import assert from 'node:assert/strict';

const plan = fs.readFileSync(new URL('../src/components/TherapeuticPlanPanel.tsx', import.meta.url), 'utf8');

assert.match(plan, /data-pts-program-mastery-progress/, 'PTS deve ter indicador próprio de domínio do programa.');
assert.match(plan, /Domínio do programa/, 'A barra principal deve representar apenas alvos efetivamente dominados.');
assert.match(
  plan,
  /\{mastered\} de \{total \|\| 0\} alvos dominados · \{masteryProgress\}%/,
  'Contagem de alvos dominados e percentual da barra principal devem usar a mesma métrica.',
);
assert.match(plan, /data-pts-current-target-criterion-progress/, 'Progresso parcial do critério deve possuir indicador separado.');
assert.match(plan, /Critério do alvo atual/, 'PTS deve rotular explicitamente o progresso parcial do alvo atual.');
assert.match(
  plan,
  /style=\{\{ width: `\$\{currentCriterionProgress\}%` \}\}/,
  'Barra parcial do alvo deve usar somente o progresso do critério atual.',
);
assert.doesNotMatch(
  plan,
  /\{mastered\} de \{total \|\| 0\} alvos dominados · \{criterionProgress\}% dos critérios/,
  'PTS não deve mais misturar domínio do programa e progresso parcial do critério na mesma barra.',
);

console.log('abaMasteryPlanProgressSemantics.regression.test.mjs: ok');
