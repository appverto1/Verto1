import { buildClinicalProgressReportSections } from '../src/utils/clinicalProgressReport';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const payload = {
  plans: [
    { id: 'pts-1', mode: 'interdisciplinary', status: 'active' },
    { id: 'spec-1', mode: 'specialty', specialty: 'Psicologia', status: 'active' },
  ],
  programs: [
    { id: 'prog-1', therapeuticPlanId: 'pts-1', domainName: 'Regulação emocional', name: 'Identificação de gatilhos' },
    { id: 'prog-2', therapeuticPlanId: 'spec-1', domainName: 'Autonomia', name: 'Rotina funcional' },
  ],
  observations: [
    {
      id: 'obs-1', planId: 'spec-1', programId: 'prog-2', itemId: 'target-2', itemLabel: 'Execução independente',
      metricKey: 'independence', metricLabel: 'Independência', unit: '%', direction: 'higher_is_better',
      value: 60, observedAt: '2026-08-10T10:00:00Z',
    },
    {
      id: 'obs-2', planId: 'spec-1', programId: 'prog-2', itemId: 'target-2', itemLabel: 'Execução independente',
      metricKey: 'independence', metricLabel: 'Independência', unit: '%', direction: 'higher_is_better',
      value: 80, observedAt: '2026-08-20T10:00:00Z',
    },
  ],
  activityEvidence: [
    {
      assignedTaskId: 'task-1',
      planId: 'pts-1',
      programId: 'prog-1',
      targetId: 'target-1',
      taskTitle: 'Registrar situação, emoção e resposta',
      patientEffort: 70,
      patientEffortLabel: 'Muito esforço',
      patientComment: 'Consegui identificar o gatilho no trabalho.',
      professionalScore: 3,
      maxScore: 4,
      professionalReviewNote: 'Boa identificação; revisar estratégias de resposta.',
      completedAt: '2026-08-22T18:00:00Z',
      reviewedAt: '2026-08-23T10:00:00Z',
      clinicalLinkSnapshot: {
        planId: 'pts-1',
        planLabel: 'PTS interdisciplinar',
        domainName: 'Regulação emocional',
        programId: 'prog-1',
        programName: 'Identificação de gatilhos',
        targetId: 'target-1',
        targetName: 'Reconhecer gatilhos em contexto natural',
      },
      evidenceKind: 'contextual_task_review',
      sourceAuthority: 'contextual',
      isClinicalMetric: false,
    },
  ],
};

const sections = buildClinicalProgressReportSections(payload);
assert(sections.length === 2, 'planos com somente atividade contextual também devem aparecer no relatório');

const pts = sections.find((section) => section.planId === 'pts-1');
assert(Boolean(pts), 'PTS com tarefa revisada deve existir no relatório');
assert(pts?.observationCount === 0, 'revisão de tarefa não pode aumentar contagem de observações clínicas');
assert(pts?.activityEvidenceCount === 1, 'atividade contextual deve ter contagem própria');
assert(pts?.domains[0]?.name === 'Regulação emocional', 'atividade deve manter domínio canônico');
assert(pts?.domains[0]?.programs[0]?.name === 'Identificação de gatilhos', 'atividade deve manter programa canônico');
assert(pts?.domains[0]?.programs[0]?.metrics.length === 0, 'pontuação da revisão não pode virar métrica clínica');
assert(pts?.domains[0]?.programs[0]?.activities.length === 1, 'atividade deve aparecer separada das métricas');
assert(pts?.domains[0]?.programs[0]?.activities[0]?.targetLabel === 'Reconhecer gatilhos em contexto natural', 'alvo clínico deve permanecer identificado');
assert(pts?.domains[0]?.programs[0]?.activities[0]?.patientEffortDisplay === '70% · Muito esforço', 'esforço deve aparecer apenas como contexto da atividade');
assert(pts?.domains[0]?.programs[0]?.activities[0]?.professionalReviewDisplay === '3/4', 'nota profissional deve permanecer descritiva/contextual');

const specialty = sections.find((section) => section.planId === 'spec-1');
assert(Boolean(specialty), 'plano de especialidade deve continuar funcionando');
assert(specialty?.activityEvidenceCount === 0, 'plano sem atividade não deve inventar evidência contextual');
assert(specialty?.domains[0]?.programs[0]?.metrics.length === 1, 'métrica clínica real deve permanecer na série quantitativa');
assert(specialty?.domains[0]?.programs[0]?.metrics[0]?.evolutionDisplay === '60% → 80%', 'evolução clínica quantitativa deve permanecer intacta');

console.log('clinicalProgressReportActivityEvidence.test.ts: ok');
