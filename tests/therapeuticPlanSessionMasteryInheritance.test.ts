import { therapeuticProgramsToSessionGoals } from '../src/utils/therapeuticPlan';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const programCriterion = {
  type: 'independent_trials',
  requiredIndependentCorrectTrials: 5,
};

const inherited = therapeuticProgramsToSessionGoals([{
  id: 'program-1',
  name: 'Solicitar ajuda',
  status: 'teaching',
  mastery_criteria: programCriterion,
  targets: [{
    id: 'target-1',
    name: 'Olhar nos olhos',
    phase: 'teaching',
    mastery_criteria: {},
  }],
}]);

assert(inherited.length === 1, 'deve materializar o alvo ativo na sessão');
assert(inherited[0].mastery_criteria.requiredIndependentCorrectTrials === 5, 'alvo com mastery_criteria vazio deve herdar o critério do programa');
assert(inherited[0].mastery_criteria.sourceLabel === 'Critério do programa', 'a sessão deve identificar corretamente a origem do critério herdado');

const targetOverride = therapeuticProgramsToSessionGoals([{
  id: 'program-2',
  name: 'Programa com override',
  status: 'teaching',
  mastery_criteria: { requiredIndependentCorrectTrials: 5 },
  targets: [{
    id: 'target-2',
    name: 'Alvo específico',
    phase: 'teaching',
    mastery_criteria: { requiredIndependentCorrectTrials: 3 },
  }],
}]);

assert(targetOverride[0].mastery_criteria.requiredIndependentCorrectTrials === 3, 'critério específico do alvo deve continuar tendo precedência');
assert(targetOverride[0].mastery_criteria.sourceLabel !== 'Critério do programa', 'override do alvo não deve ser rotulado como herança do programa');

const unconfigured = therapeuticProgramsToSessionGoals([{
  id: 'program-3',
  name: 'Sem critério',
  status: 'teaching',
  mastery_criteria: {},
  targets: [{ id: 'target-3', name: 'Sem critério', phase: 'teaching', mastery_criteria: {} }],
}]);

assert(Object.keys(unconfigured[0].mastery_criteria).length === 0, 'programa e alvo sem critério devem continuar não configurados');

console.log('therapeuticPlanSessionMasteryInheritance.test.ts: ok');
