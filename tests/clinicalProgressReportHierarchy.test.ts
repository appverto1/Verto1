import { buildClinicalProgressReportSections } from '../src/utils/clinicalProgressReport';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const sections = buildClinicalProgressReportSections({
  plans: [
    { id: 'plan-pts', mode: 'interdisciplinary', status: 'active' },
    { id: 'plan-fono', mode: 'specialty', specialty: 'Fonoaudiologia', status: 'active' },
  ],
  programs: [
    { id: 'program-communication', therapeuticPlanId: 'plan-pts', domainName: 'Comunicação', name: 'Pedidos funcionais' },
    { id: 'program-autonomy', therapeuticPlanId: 'plan-fono', domainName: 'Autonomia', name: 'Rotina de alimentação' },
  ],
  observations: [
    { id: 'o1', planId: 'plan-pts', programId: 'program-communication', itemId: 'target-1', itemLabel: 'Pedir ajuda', metricKey: 'accuracy', metricLabel: 'Acurácia', unit: '%', direction: 'higher_is_better', value: 50, observedAt: '2026-08-01T10:00:00Z' },
    { id: 'o2', planId: 'plan-pts', programId: 'program-communication', itemId: 'target-1', itemLabel: 'Pedir ajuda', metricKey: 'accuracy', metricLabel: 'Acurácia', unit: '%', direction: 'higher_is_better', value: 75, observedAt: '2026-08-20T10:00:00Z' },
    { id: 'o3', planId: 'plan-pts', programId: 'program-communication', itemId: 'target-1', itemLabel: 'Pedir ajuda', metricKey: 'frequency', metricLabel: 'Ajuda necessária', unit: 'vezes', direction: 'lower_is_better', value: 5, observedAt: '2026-08-01T10:00:00Z' },
    { id: 'o4', planId: 'plan-pts', programId: 'program-communication', itemId: 'target-1', itemLabel: 'Pedir ajuda', metricKey: 'frequency', metricLabel: 'Ajuda necessária', unit: 'vezes', direction: 'lower_is_better', value: 3, observedAt: '2026-08-20T10:00:00Z' },
    { id: 'o5', planId: 'plan-fono', programId: 'program-autonomy', itemId: 'target-2', itemLabel: 'Tempo de refeição', metricKey: 'duration', metricLabel: 'Duração', unit: 'min', direction: 'lower_is_better', value: 40, observedAt: '2026-08-02T12:00:00Z' },
    { id: 'o6', planId: 'plan-fono', programId: 'program-autonomy', itemId: 'target-2', itemLabel: 'Tempo de refeição', metricKey: 'duration', metricLabel: 'Duração', unit: 'min', direction: 'lower_is_better', value: 30, observedAt: '2026-08-22T12:00:00Z' },
  ],
});

assert(sections.length === 2, 'deve manter PTS e plano individual separados');
assert(sections[0].planKind === 'PTS' && sections[0].planLabel === 'PTS interdisciplinar', 'PTS deve ser identificado explicitamente');
assert(sections[0].domains[0].name === 'Comunicação', 'domínio canônico do programa deve aparecer');
assert(sections[0].domains[0].programs[0].name === 'Pedidos funcionais', 'nome do programa deve aparecer');
assert(sections[0].domains[0].programs[0].metrics.length === 2, 'métricas com unidades/semânticas diferentes não podem ser agregadas em um score');
assert(sections[0].domains[0].programs[0].metrics.every((metric) => metric.trend === 'favorable'), 'higher/lower is better deve respeitar a direção clínica');
assert(sections[1].planLabel.includes('Fonoaudiologia'), 'plano individual deve preservar a especialidade');
assert(sections[1].domains[0].programs[0].metrics[0].evolutionDisplay === '40 min → 30 min', 'evolução deve preservar a unidade original');

console.log('clinicalProgressReportHierarchy.test.ts: ok');
