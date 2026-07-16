import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTherapeuticPlanSummary,
  formatTherapeuticPlanDate,
  mergeLegacyAndTherapeuticSessionGoals,
  normalizeTherapeuticProgramStatus,
  normalizeTherapeuticPrograms,
  therapeuticProgramsToSessionGoals,
} from '../src/utils/therapeuticPlan.ts';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const migration = read('supabase/migrations/20260716160000_therapeutic_plan_programs.sql');
const server = read('server.ts');
const panel = read('src/components/TherapeuticPlanPanel.tsx');
const library = read('src/components/TherapeuticProgramLibrary.tsx');
const patientDetail = read('src/components/PatientDetailView.tsx');
const sessionMode = read('src/components/SessionMode.tsx');
const protocols = read('src/components/Protocols.tsx');
const dataService = read('src/services/dataService.ts');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('normaliza estados legados sem alterar a permissao operacional', () => {
  assert.equal(normalizeTherapeuticProgramStatus('active'), 'teaching');
  assert.equal(normalizeTherapeuticProgramStatus('on_hold'), 'paused');
  assert.equal(normalizeTherapeuticProgramStatus('maintenance'), 'maintenance');
  assert.equal(normalizeTherapeuticProgramStatus('desconhecido'), 'draft');
});

test('normaliza programas e alvos existentes sem duplicar estruturas', () => {
  const programs = normalizeTherapeuticPrograms({
    programs: [{ id: 'program-1', status: 'active', description: 'Pedir ajuda', category: 'Comunicacao' }],
    targets: [
      { id: 'target-2', program_id: 'program-1', name: 'Ajuda para abrir', phase: 'mastered', sort_order: 2 },
      { id: 'target-1', program_id: 'program-1', name: 'Ajuda para alcancar', phase: 'teaching', sort_order: 1 },
    ],
  });
  assert.equal(programs.length, 1);
  assert.equal(programs[0].status, 'teaching');
  assert.equal(programs[0].objective, 'Pedir ajuda');
  assert.equal(programs[0].targets[0].id, 'target-1');
  assert.equal(programs[0].masteredTargetCount, 1);
});

test('resumo separa ensino, manutencao, conclusao e revisao', () => {
  const summary = buildTherapeuticPlanSummary([
    { status: 'teaching', targets: [{ phase: 'mastered' }], review_due_date: '2026-08-10' },
    { status: 'maintenance', targets: [{ phase: 'maintenance' }], review_due_date: '2026-07-30' },
    { status: 'completed', targets: [] },
  ]);
  assert.deepEqual(summary, {
    teaching: 1,
    maintenance: 1,
    completed: 1,
    masteredTargets: 1,
    nextReview: '2026-07-30',
  });
  assert.equal(formatTherapeuticPlanDate('2026-07-30'), '30/07/2026');
});

test('somente programas aplicaveis alimentam o coletor ABA existente', () => {
  const goals = therapeuticProgramsToSessionGoals([
    { id: 'program-active', name: 'Solicitar ajuda', status: 'teaching', targets: [{ id: 'target-active', name: 'Ajuda para abrir', phase: 'teaching' }] },
    { id: 'program-draft', name: 'Rascunho', status: 'draft', targets: [{ id: 'target-draft', name: 'Nao aplicar' }] },
    { id: 'program-paused', name: 'Pausado', status: 'paused', targets: [{ id: 'target-paused', name: 'Nao aplicar' }] },
  ]);
  assert.equal(goals.length, 1);
  assert.equal(goals[0].targetId, 'target-active');
  assert.equal(goals[0].programId, 'program-active');
  assert.equal(goals[0].source, 'therapeutic_program');
});

test('merge com PEI legado prefere o alvo estruturado e evita duplicidade', () => {
  const merged = mergeLegacyAndTherapeuticSessionGoals(
    [{ id: 'same-target', name: 'Legado' }, { id: 'legacy-only', name: 'Meta antiga' }],
    [{ id: 'same-target', name: 'Estruturado', source: 'therapeutic_program' }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((goal) => goal.id === 'same-target')?.name, 'Estruturado');
});

test('migration e aditiva, versionada, auditavel e idempotente', () => {
  assert.match(migration, /create table if not exists public\.patient_therapeutic_objectives/);
  assert.match(migration, /create table if not exists public\.aba_program_templates/);
  assert.match(migration, /create table if not exists public\.aba_program_versions/);
  assert.match(migration, /create table if not exists public\.aba_program_audit_events/);
  assert.match(migration, /idx_aba_programs_therapeutic_idempotency/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /THERAPEUTIC_PROGRAM_VERSION_CONFLICT/);
  assert.doesNotMatch(migration, /drop table/i);
});

test('RLS preserva tenant e limita profissional aos pacientes atribuidos', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /p\.therapist_id = auth\.uid\(\)/);
  assert.match(migration, /u\.role in \('owner', 'admin', 'coordinator'\)/);
  assert.match(migration, /source_scope = 'VERTO' and status = 'PUBLISHED'/);
  assert.match(migration, /owner_user_id = auth\.uid\(\)::text/);
});

test('RPC cria programa, objetivo, alvos e historico na mesma transacao', () => {
  const createBlock = migration.match(/create or replace function public\.create_therapeutic_program[\s\S]*?create or replace function public\.update_therapeutic_program_status/)?.[0] || '';
  assert.match(createBlock, /insert into public\.patient_therapeutic_objectives/);
  assert.match(createBlock, /insert into public\.aba_programs/);
  assert.match(createBlock, /insert into public\.aba_targets/);
  assert.match(createBlock, /insert into public\.aba_program_versions/);
  assert.match(createBlock, /insert into public\.aba_program_audit_events/);
  assert.match(createBlock, /return public\.therapeutic_program_payload/);
});

test('endpoint do plano faz cargas em lote e sem query por programa', () => {
  const route = server.match(/app\.get\('\/api\/aba\/patients\/:patientId\/therapeutic-plan'[\s\S]*?app\.get\('\/api\/aba\/program-templates'/)?.[0] || '';
  assert.match(route, /Promise\.all\(/);
  assert.match(route, /meta: \{ queryCount: 5, batched: true/);
  assert.match(route, /\.eq\('patient_id', patientId\)/);
  assert.match(route, /\.eq\('organization_id', organizationId\)/);
  assert.match(route, /targetsByProgram/);
  assert.match(route, /historyByProgram/);
});

test('backend separa aprovacao estrutural de aplicacao clinica', () => {
  const createRoute = server.match(/app\.post\('\/api\/aba\/patients\/:patientId\/therapeutic-programs'[\s\S]*?app\.patch\('\/api\/aba\/patients\/:patientId\/therapeutic-programs\/:programId\/status'/)?.[0] || '';
  assert.match(createRoute, /const canApprove = \['owner', 'admin', 'coordinator'\]\.includes\(role\)/);
  assert.match(createRoute, /'awaiting_approval'/);
  assert.match(createRoute, /checkPatientAccess/);
  assert.match(createRoute, /p_organization_id: organizationId/);
  assert.match(createRoute, /templateScope === 'VERTO' && templateStatus === 'PUBLISHED'/);
  assert.match(createRoute, /sameOrganization && templateScope === 'CLINIC'/);
  assert.match(createRoute, /String\(template\.owner_user_id \|\| ''\) === actorId/);
});

test('edicao versionada preserva alvos existentes e inclui apenas novos na mesma RPC', () => {
  const updateBlock = migration.match(/create or replace function public\.update_therapeutic_program\([\s\S]*?create or replace function public\.add_therapeutic_program_target/)?.[0] || '';
  assert.match(updateBlock, /p_targets jsonb/);
  assert.match(updateBlock, /jsonb_array_elements\(coalesce\(p_targets, '\[\]'::jsonb\)\)/);
  assert.match(updateBlock, /not exists \(\s*select 1 from public\.aba_targets target/);
  assert.match(updateBlock, /insert into public\.aba_targets/);
  assert.doesNotMatch(updateBlock, /delete from public\.aba_targets/);
  assert.match(updateBlock, /therapeutic_objective_id = v_objective_id/);
  assert.match(updateBlock, /id <> p_program_id/);

  const updateRoute = server.match(/app\.patch\('\/api\/aba\/patients\/:patientId\/therapeutic-programs\/:programId'[\s\S]*?app\.post\('\/api\/aba\/patients\/:patientId\/therapeutic-programs\/:programId\/targets'/)?.[0] || '';
  assert.match(updateRoute, /p_targets: sanitizeClinicalPayload\(targets\)/);
  assert.ok(panel.includes('Alvos já usados em sessões permanecem protegidos.'));
  assert.ok(panel.includes('setLockedTargetNames(existingTargets)'));
});

test('adicao repetida de alvo nao cria auditoria falsa', () => {
  const targetBlock = migration.match(/create or replace function public\.add_therapeutic_program_target\([\s\S]*?insert into public\.aba_program_templates/)?.[0] || '';
  const duplicateReturn = targetBlock.indexOf('if v_existing_target_id is not null then');
  const auditInsert = targetBlock.indexOf("'TARGET_ADDED'");
  assert.ok(duplicateReturn >= 0 && auditInsert > duplicateReturn);
  assert.match(targetBlock.slice(duplicateReturn, auditInsert), /return public\.therapeutic_program_payload\(p_program_id\)/);
});

test('biblioteca retorna modelos e uso em duas consultas em lote', () => {
  const route = server.match(/app\.get\('\/api\/aba\/program-templates'[\s\S]*?app\.post\('\/api\/aba\/patients\/:patientId\/therapeutic-programs'/)?.[0] || '';
  assert.match(route, /Promise\.all\(/);
  assert.match(route, /patient_usage_count/);
  assert.match(route, /queryCount: 2, batched: true/);
  assert.match(route, /canManageLibrary \|\| status === 'PUBLISHED'/);
});

test('UI oferece as quatro origens e adaptacao rapida antes de ativar', () => {
  for (const label of ['Usar modelo pronto', 'Criar manualmente', 'Criar a partir de protocolo', 'Criar a partir de recomendação']) {
    assert.ok(panel.includes(label), `origem ausente: ${label}`);
  }
  assert.ok(panel.includes('Digite um alvo e pressione Enter'));
  assert.ok(panel.includes('Ajustes avançados'));
  assert.ok(panel.includes('Revise antes de salvar'));
  assert.ok(panel.includes('Ativar programa'));
  assert.ok(panel.includes('Enviar para aprovação'));
});

test('Plano terapeutico substitui a entrada principal e preserva PEI legado recolhido', () => {
  assert.ok(patientDetail.includes('<TherapeuticPlanPanel'));
  assert.ok(patientDetail.includes('Plano terapêutico'));
  assert.ok(patientDetail.includes('Estruturas legadas do PEI'));
  assert.ok(patientDetail.includes('<details'));
});

test('sessao carrega programas uma vez e reutiliza o coletor existente', () => {
  assert.ok(sessionMode.includes('getPatientTherapeuticPlan(patientId'));
  assert.ok(sessionMode.includes('therapeuticProgramsToSessionGoals(therapeuticPrograms)'));
  assert.ok(sessionMode.includes('mergeLegacyAndTherapeuticSessionGoals'));
  assert.ok(sessionMode.includes('data-therapeutic-programs-today'));
  assert.ok(sessionMode.includes('Programas de hoje'));
  assert.ok(!sessionMode.includes('fetchTherapeuticProgramForEachTarget'));
});

test('biblioteca de programas fica junto da biblioteca de protocolos', () => {
  assert.ok(protocols.includes("import { TherapeuticProgramLibrary }"));
  assert.ok(protocols.includes("useState<'protocols' | 'programs'>('protocols')"));
  assert.ok(protocols.includes('<TherapeuticProgramLibrary'));
  assert.ok(protocols.includes('Programas de ensino'));
  assert.ok(library.includes('Modelos Verto'));
  assert.ok(library.includes('Modelos da clínica'));
  assert.ok(library.includes('Meus modelos'));
  assert.ok(library.includes('Usado por'));
});

test('dataService recarrega apenas os recursos terapeuticos afetados', () => {
  assert.ok(dataService.includes('async getPatientTherapeuticPlan'));
  assert.ok(dataService.includes('async createTherapeuticProgram'));
  assert.ok(dataService.includes('async updateTherapeuticProgramStatus'));
  assert.ok(dataService.includes('async addTherapeuticProgramTarget'));
  assert.ok(dataService.includes('async getTherapeuticProgramTemplates'));
  assert.ok(dataService.includes("options.force ? `?_reload=${Date.now()}` : ''"));
  assert.ok(panel.includes('await loadPlan(true)'));
  assert.ok(library.includes('await loadTemplates(true)'));
});

for (const { name, fn } of tests) {
  fn();
  console.log(`[ok] ${name}`);
}

console.log(`[ok] ${tests.length} testes do Plano terapeutico e Programas de ensino passaram.`);
