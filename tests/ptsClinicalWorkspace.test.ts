import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hydratePtsClinicalPayloadFromPlan,
  normalizePtsClinicalPayload,
  ptsCommonObjectives,
  ptsLastReviewedAt,
  ptsSpecialtyObjectives,
} from '../src/utils/ptsClinicalWorkspace';

const normalized = normalizePtsClinicalPayload({
  schemaVersion: 99,
  caseManagerId: 'professional-1',
  unknownSecret: 'must not persist',
  strengths: ['Comunicação por figuras', 'Comunicação por figuras'],
  goals: [
    {
      id: 'goal-1',
      title: 'Ampliar comunicação funcional',
      goalType: 'quantitative',
      responsibleProfessionalIds: ['professional-1', 'professional-other'],
      specialties: ['Fonoaudiólogo', 'Especialidade inventada'],
      status: 'in_progress',
    },
  ],
  responsibilities: [
    {
      id: 'responsibility-1',
      actorType: 'professional',
      actorId: 'professional-other',
      action: 'Ação fora do escopo',
    },
    {
      id: 'responsibility-2',
      actorType: 'family',
      actorName: 'Família',
      action: 'Generalizar em casa',
    },
  ],
  reviews: [
    {
      id: 'review-1',
      completedAt: '2026-08-03T12:00:00.000Z',
      summary: 'Reavaliação concluída',
    },
  ],
  nextReviewDate: '2026-09-03',
}, {
  participantIds: ['professional-1'],
  specialties: ['Fonoaudiólogo'],
  defaultCaseManagerId: 'professional-1',
  defaultStartedAt: '2026-08-03',
});

assert.equal(normalized.schemaVersion, 1);
assert.equal(normalized.caseManagerId, 'professional-1');
assert.deepEqual(normalized.strengths, ['Comunicação por figuras']);
assert.deepEqual(normalized.goals[0].responsibleProfessionalIds, ['professional-1']);
assert.deepEqual(normalized.goals[0].specialties, ['Fonoaudiólogo']);
assert.equal(normalized.responsibilities.length, 1, 'responsabilidade profissional fora do PTS é descartada');
assert.equal(normalized.responsibilities[0].actorType, 'family');
assert.deepEqual(ptsCommonObjectives(normalized), ['Ampliar comunicação funcional']);
assert.deepEqual(ptsSpecialtyObjectives(normalized), {
  Fonoaudiólogo: ['Ampliar comunicação funcional'],
});
assert.equal(ptsLastReviewedAt(normalized), '2026-08-03T12:00:00.000Z');
assert.equal((normalized as any).unknownSecret, undefined, 'campos não contratados não são persistidos');

const legacy = hydratePtsClinicalPayloadFromPlan({
  responsible_professional_id: 'professional-1',
  participant_professional_ids: ['professional-1', 'professional-2'],
  participant_specialties: ['Fonoaudiólogo', 'Psicoterapeuta'],
  created_at: '2026-08-01T10:00:00.000Z',
  pts_payload: {},
  common_objectives: ['Ampliar autonomia'],
  specialty_objectives: {
    Fonoaudiólogo: ['Aumentar vocabulário funcional'],
  },
});
assert.equal(legacy.goals.length, 2, 'objetivos legados são preservados ao abrir o PTS estruturado');
assert.equal(legacy.caseManagerId, 'professional-1');

const server = fs.readFileSync('server.ts', 'utf8');
assert.match(server, /update_patient_therapeutic_plan_v3/);
assert.match(server, /pts_payload,pts_schema_version,review_due_date,last_reviewed_at/);
assert.match(server, /normalizePtsClinicalPayload/);
assert.match(server, /96 \* 1024, 'Escopo do Plano terapêutico'/);

const component = fs.readFileSync('src/components/PtsWorkspaceEditor.tsx', 'utf8');
for (const label of [
  'Visão compartilhada do caso',
  'Metas compartilhadas',
  'Evidências do cuidado',
  'Responsabilidades pactuadas',
  'Rede de apoio e articulação',
  'Riscos e plano de proteção',
  'Reavaliações e decisões da equipe',
]) {
  assert.ok(component.includes(label), `seção obrigatória ausente: ${label}`);
}
assert.ok(component.includes('Salvar nova versão do PTS'));
assert.match(component, /const strongText = isDark \? 'text-slate-100' : 'text-slate-900'/, 'títulos do editor PTS devem respeitar o tema explícito do componente');
assert.doesNotMatch(component, /dark:text-slate-(?:100|200)/, 'editor PTS não deve deixar o seletor global dark apagar títulos e valores em superfície clara');

const migration = fs.readFileSync('supabase/migrations/20260803010000_pts_clinical_workspace_v1.sql', 'utf8');
assert.match(migration, /add column if not exists pts_payload jsonb/);
assert.match(migration, /create or replace function public\.update_patient_therapeutic_plan_v3/);
assert.match(migration, /security definer/);
assert.match(migration, /grant execute[\s\S]*to service_role/);
assert.doesNotMatch(migration, /\b(delete|truncate|drop table)\b/i);

console.log('ptsClinicalWorkspace.test.ts: ok');
