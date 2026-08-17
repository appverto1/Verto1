import { therapeuticProgramsToSessionGoals } from '../src/utils/therapeuticPlan';
import { abaMasteryCriterionSourceLabel, formatAbaMasteryCriterion, normalizeAbaMasteryCriterion } from '../src/utils/abaMasteryEngine';

const goal = therapeuticProgramsToSessionGoals([{
  id: 'program-1',
  name: 'Solicitar ajuda',
  status: 'teaching',
  mastery_criteria: { type: 'independent_trials', requiredIndependentCorrectTrials: 5 },
  targets: [{ id: 'target-1', name: 'Olhar nos olhos', phase: 'teaching', mastery_criteria: {} }],
}])[0];

const criterion = normalizeAbaMasteryCriterion({
  ...goal.mastery_criteria,
  program_id: goal.program_id,
  target_id: goal.target_id,
});

if (!criterion) throw new Error('a sessão não pode perder o critério configurado no programa');
if (!formatAbaMasteryCriterion(criterion).includes('5 acertos independentes')) throw new Error('o critério herdado deve aparecer na sessão');
if (abaMasteryCriterionSourceLabel(criterion) !== 'Critério do programa') throw new Error('a origem herdada deve ser exibida como critério do programa');

console.log('sessionMasteryDisplayRegression.test.ts: ok');
