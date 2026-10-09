import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript');
const source = (path) => readFileSync(path, 'utf8');
const sessionMode = source('src/components/SessionMode.tsx');
const detail = source('src/components/PatientDetailView.tsx');
const therapeuticSource = source('src/utils/therapeuticPlan.ts');

const exports = {};
const normalized = ts.transpileModule(therapeuticSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(normalized, {
  exports,
  require(id) {
    assert.equal(id, './clinicalText');
    return {
      decodeClinicalTextEntities: (text) => String(text || ''),
      normalizeClinicalTextRecord: (value) => value,
    };
  },
});
const { normalizeTherapeuticPrograms, therapeuticProgramsToSessionGoals } = exports;
assert.equal(typeof normalizeTherapeuticPrograms, 'function');
assert.equal(typeof therapeuticProgramsToSessionGoals, 'function');

const planA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const planB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const payload = {
  programs: [
    { id: 'prog-kids', therapeutic_plan_id: planA, status: 'teaching', measurement_type: 'correct_incorrect' },
    { id: 'prog-other-specialty', therapeutic_plan_id: planB, status: 'teaching' },
    { id: 'prog-draft', therapeutic_plan_id: planA, status: 'draft' },
  ],
  targets: [
    { id: 'kid-1', program_id: 'prog-kids', name: 'Alvo infantil ativo', phase: 'teaching' },
    { id: 'other-1', program_id: 'prog-other-specialty', name: 'Alvo de outra especialidade', phase: 'teaching' },
    { id: 'draft-1', program_id: 'prog-draft', name: 'Alvo em rascunho', phase: 'teaching' },
    { id: 'kid-paused', program_id: 'prog-kids', name: 'Alvo pausado', phase: 'paused' },
  ],
};
const programs = normalizeTherapeuticPrograms(payload);
const planGoals = (planId) => therapeuticProgramsToSessionGoals(
  programs.filter((program) => String(program?.therapeutic_plan_id || program?.therapeuticPlanId || '').trim() === planId),
);
assert.deepEqual(Array.from(planGoals(planA), (goal) => goal.targetId), ['kid-1'],
  'a coleta infantil lê somente o alvo em ensino do PTS selecionado');
assert.deepEqual(Array.from(planGoals(planB), (goal) => goal.targetId), ['other-1'],
  'alvos de outra especialidade nunca são incluídos');
assert.equal(planGoals('unknown').length, 0, 'não criar alvos sintéticos se não houver vínculo');
assert.equal(therapeuticProgramsToSessionGoals(normalizeTherapeuticPrograms({ programs: [], targets: [] })).length, 0);

// O fluxo de sessão sem alvos de um paciente infantil não pode mostrar o
// mesmo editor genérico que o paciente adulto nem fingir coleta realizada.
assert.match(sessionMode, /resolvePatientPortalKind\(patient\) === 'KIDS'/);
assert.match(sessionMode, /dataService\.getPatientTherapeuticPlan\(patientId, \{ force: true \}\)/);
assert.match(sessionMode, /normalizedPrograms\.filter\(\(program: any\) => String\(program\?\.therapeutic_plan_id/);
assert.match(sessionMode, /if \(isPediatricSession && !isCompletedSessionReview\) \{/);
assert.match(sessionMode, /data-testid="pediatric-session-targets-unavailable"/);
assert.match(sessionMode, /Recarregar alvos do PTS/);
assert.match(sessionMode, /setTherapeuticPlanReloadKey\(\(value\) => value \+ 1\)/);
assert.match(sessionMode, /Voltar ao prontuário e revisar o plano/);
assert.match(sessionMode, /A sessão e seus registros existentes foram preservados/);
assert.ok(sessionMode.indexOf('if (isPediatricSession && !isCompletedSessionReview)') <
  sessionMode.indexOf('const emptyStateContent = ('),
  'o guard pediátrico precede o fallback de evolução genérica');
assert.match(detail, /if \(isKidsProfile && requestedPlanId\) \{[\s\S]{0,560}therapeuticProgramsToSessionGoals\(scopedPrograms\)\.length === 0/);
assert.match(detail, /scopedPrograms = normalizeTherapeuticPrograms\(planResult\?\.data \|\| planResult\)/);
assert.match(detail, /program\?\.therapeutic_plan_id \|\| program\?\.therapeuticPlanId/);
assert.match(detail, /Nenhum registro foi alterado/);
assert.match(detail, /confirmedPlanId !== expectedPlanId/, 'não permitir substituir o PTS do servidor');

console.log('p000PediatricTargetCollection.regression.test.mjs: ok (real target normalization, scope isolation, blocked generic fallback, retry)');
