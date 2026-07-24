import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  filterTherapeuticRecommendationGroups,
  groupTherapeuticRecommendations,
  recommendationHasTrustedProgramOrigin,
  resolveTherapeuticRecommendationActionPolicy,
} from '../src/utils/therapeuticPlan.ts';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const panel = read('src/components/TherapeuticPlanPanel.tsx');
const drawer = read('src/components/ui/ResponsiveDrawer.tsx');
const alertDialog = read('src/components/ui/AlertDialog.tsx');
const server = read('server.ts');
const dataService = read('src/services/dataService.ts');
const planningEngine = read('src/utils/abaPlanningEngine.ts');
const migration = read('supabase/migrations/20260716170000_therapeutic_recommendation_context.sql');
const recommendationIdentity = read('src/server/abaRecommendationIdentity.ts');
const integrityMigration = read('supabase/migrations/20260724163000_aba_recommendation_transactional_integrity.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const recommendation = (overrides: Record<string, any> = {}) => ({
  id: 'rec-1',
  patient_id: 'patient-1',
  recommendation_type: 'REGRESSION_ATTENTION',
  priority: 'HIGH',
  title: 'Ponto de atencao para regressao',
  summary: 'Dois probes abaixo do criterio.',
  status: 'SUGGESTED',
  target_id: 'target-1',
  program_id: 'program-1',
  source_session_id: 'session-1',
  created_at: '2026-07-08T12:00:00.000Z',
  can_create_program: false,
  clinical_context: {
    target: { id: 'target-1', name: 'Responder ao proprio nome', protocol_id: 'protocol-1' },
    program: { id: 'program-1', name: 'Atencao social' },
    protocol: { id: 'protocol-1', title: 'VB-MAPP' },
    domain: { id: 'domain-1', name: 'Habilidades sociais' },
    source_session: { id: 'session-1', occurred_at: '2026-07-08T12:00:00.000Z' },
    responsible_professional: { id: 'professional-1', display_name: 'Psicologo Mateus' },
    converted_program: null,
  },
  ...overrides,
});

test('agrupa ocorrencias equivalentes por ids canonicos e preserva o historico', () => {
  const groups = groupTherapeuticRecommendations([
    recommendation(),
    recommendation({
      id: 'rec-2',
      source_session_id: 'session-2',
      created_at: '2026-07-09T12:00:00.000Z',
      clinical_context: {
        ...recommendation().clinical_context,
        source_session: { id: 'session-2', occurred_at: '2026-07-09T12:00:00.000Z' },
      },
    }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrenceCount, 2);
  assert.deepEqual(groups[0].occurrences.map((item) => item.id), ['rec-2', 'rec-1']);
});

test('texto igual sem origem canonica nao e usado para deduplicar', () => {
  const legacyContext = { target: null, program: null, protocol: null };
  const groups = groupTherapeuticRecommendations([
    recommendation({ id: 'legacy-1', target_id: null, program_id: null, can_create_program: false, clinical_context: legacyContext }),
    recommendation({ id: 'legacy-2', target_id: null, program_id: null, can_create_program: false, clinical_context: legacyContext }),
  ]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every((group) => group.occurrenceCount === 1));
});

test('recomendacao incompleta nao permite criar programa', () => {
  const incomplete = recommendation({ can_create_program: false, target_id: null, clinical_context: { target: null } });
  assert.equal(recommendationHasTrustedProgramOrigin(incomplete), false);
  assert.equal(groupTherapeuticRecommendations([incomplete])[0].canCreateProgram, false);
});

test('somente aquisicao sem programa oferece criacao direta', () => {
  const acquisition = recommendation({
    recommendation_type: 'INTRODUCE_NEW_TARGET',
    can_create_program: true,
    program_id: null,
    clinical_context: {
      ...recommendation().clinical_context,
      program: null,
    },
  });
  assert.equal(recommendationHasTrustedProgramOrigin(acquisition), true);
  assert.equal(resolveTherapeuticRecommendationActionPolicy(acquisition).primaryAction, 'create_program');

  const existingProgram = recommendation({
    recommendation_type: 'INTRODUCE_NEW_TARGET',
    can_create_program: false,
  });
  assert.equal(resolveTherapeuticRecommendationActionPolicy(existingProgram).primaryAction, 'open_program');
});

test('regressao, generalizacao, manutencao e ajuda usam acoes do contexto existente', () => {
  assert.equal(resolveTherapeuticRecommendationActionPolicy(recommendation()).primaryAction, 'review_regression');
  assert.equal(resolveTherapeuticRecommendationActionPolicy(recommendation({ recommendation_type: 'GENERALIZATION' })).primaryAction, 'configure_generalization');
  assert.equal(resolveTherapeuticRecommendationActionPolicy(recommendation({ recommendation_type: 'MAINTENANCE_PROBE' })).primaryAction, 'schedule_maintenance');
  assert.equal(resolveTherapeuticRecommendationActionPolicy(recommendation({ recommendation_type: 'PROMPT_FADING' })).primaryAction, 'review_prompt_fading');
  assert.equal(resolveTherapeuticRecommendationActionPolicy(recommendation({ recommendation_type: 'CONTINUE_TRAINING' })).primaryAction, 'review_acquisition');
});

test('recomendacao convertida aponta para o programa e bloqueia nova conversao', () => {
  const converted = recommendation({
    can_create_program: false,
    clinical_context: {
      ...recommendation().clinical_context,
      converted_program: { id: 'created-program', name: 'Responder ao nome' },
    },
  });
  const [group] = groupTherapeuticRecommendations([converted]);
  assert.equal(group.convertedProgram.id, 'created-program');
  assert.equal(group.canCreateProgram, false);
});

test('busca e filtros usam habilidade, protocolo, tipo, profissional e periodo', () => {
  const groups = groupTherapeuticRecommendations([
    recommendation(),
    recommendation({
      id: 'rec-other',
      target_id: 'target-2',
      program_id: 'program-2',
      recommendation_type: 'GENERALIZATION',
      created_at: '2026-04-01T12:00:00.000Z',
      clinical_context: {
        target: { id: 'target-2', name: 'Solicitar ajuda' },
        program: { id: 'program-2', name: 'Comunicacao funcional' },
        responsible_professional: { id: 'professional-2', display_name: 'Psicologa Ana' },
      },
    }),
  ]);
  assert.equal(filterTherapeuticRecommendationGroups(groups, { query: 'responder ao proprio nome' }).length, 1);
  assert.equal(filterTherapeuticRecommendationGroups(groups, { query: 'VB-MAPP' }).length, 1);
  assert.equal(filterTherapeuticRecommendationGroups(groups, { type: 'GENERALIZATION' }).length, 1);
  assert.equal(filterTherapeuticRecommendationGroups(groups, { professionalId: 'professional-1' }).length, 1);
  assert.equal(filterTherapeuticRecommendationGroups(groups, { periodDays: 30, now: '2026-07-16T12:00:00.000Z' }).length, 1);
});

test('fluxo de criacao usa drawer lateral unico e remove o modal central antigo', () => {
  assert.match(panel, /<ResponsiveDrawer/);
  assert.match(panel, /therapeutic-program-drawer-title/);
  assert.doesNotMatch(panel, /\{creationStep && <div className="fixed/);
  assert.match(drawer, /right-0/);
  assert.match(drawer, /max-w-\[820px\]/);
  assert.match(drawer, /h-\[100dvh\]/);
  assert.match(drawer, /sm:w-\[min\(820px,calc\(100vw-2rem\)\)\]/);
  assert.match(drawer, /createPortal\(drawer, document\.body\)/);
  assert.match(drawer, /data-portal-root="document-body"/);
  assert.match(drawer, /fixed inset-0 z-\[240\]/);
});

test('drawer tem uma unica regiao rolavel, header e footer fixos', () => {
  assert.equal((drawer.match(/overflow-y-auto/g) || []).length, 1);
  assert.match(drawer, /overflow-x-hidden/);
  assert.match(drawer, /data-testid="therapeutic-program-drawer-header"/);
  assert.match(drawer, /data-testid="therapeutic-program-drawer-scroll"/);
  assert.match(drawer, /data-testid="therapeutic-program-drawer-footer"/);
  assert.match(drawer, /shrink-0 border-t/);
});

test('drawer bloqueia body, prende foco, fecha com Esc e devolve foco', () => {
  assert.match(drawer, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(drawer, /FOCUSABLE_SELECTOR/);
  assert.match(drawer, /event\.key === 'Escape'/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /aria-labelledby=\{titleId\}/);
  assert.match(drawer, /returnFocusRef\?\.current\?\.focus/);
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.match(panel, /closeConfirmationOpen/);
  assert.match(panel, /Continuar editando/);
  assert.match(panel, /Descartar alterações/);
  assert.match(panel, /Salvar como rascunho/);
  assert.match(panel, /interactionBlocked=\{closeConfirmationOpen\}/);
  assert.match(alertDialog, /role="alertdialog"/);
  assert.match(alertDialog, /aria-modal="true"/);
  assert.match(alertDialog, /primaryButtonRef\.current\?\.focus/);
  assert.match(alertDialog, /document\.addEventListener\('keydown', handleKeyDown, true\)/);
  assert.match(alertDialog, /z-\[300\]/);
  const footer = panel.match(/const renderCreationFooter = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.doesNotMatch(footer, /closeConfirmationOpen|Há alterações não salvas/);
});

test('estado dirty compara snapshot normalizado e não usa a existência do programa como alteração', () => {
  assert.match(panel, /buildCreationDraftSnapshot/);
  assert.match(panel, /initialCreationSnapshotRef/);
  assert.match(panel, /currentCreationSnapshot !== initialCreationSnapshotRef\.current/);
  const dirtyBlock = panel.match(/const hasUnsavedCreationChanges =[\s\S]*?;\n/)?.[0] || '';
  assert.doesNotMatch(dirtyBlock, /editingProgramId|originContext/);
  assert.match(panel, /initialCreationSnapshotRef\.current = buildCreationDraftSnapshot\(nextForm, ''\)/);
});

test('criacao rapida mostra essenciais e recolhe configuracoes avancadas', () => {
  assert.match(panel, /Nome do programa/);
  assert.match(panel, /Objetivo terapêutico/);
  assert.match(panel, /Digite um alvo e pressione Enter/);
  assert.match(panel, /Durante a sessão, o aplicador verá/);
  assert.match(panel, /form\.masteryPreset === 'custom'/);
  assert.match(panel, /data-testid="custom-mastery-fields"/);
  assert.match(panel, /Ajustes avançados/);
  assert.match(panel, /advancedSection\('procedure'/);
  assert.match(panel, /advancedSection\('support'/);
  assert.match(panel, /advancedSection\('generalization'/);
  assert.match(panel, /advancedSection\('management'/);
});

test('alvos aceitam lote, bloqueiam duplicados e podem ser editados ou reordenados', () => {
  assert.match(panel, /split\(\/\[\\n,;\]\+\//);
  assert.match(panel, /duplicado\(s\) ignorado\(s\)/);
  assert.match(panel, /const commitTargetEdit/);
  assert.match(panel, /const moveTarget/);
  assert.match(panel, /onPaste=/);
  assert.match(panel, /Mover \$\{target\} para cima/);
});

test('sugestoes pedem decisao antes de sobrescrever e permitem desfazer', () => {
  assert.match(panel, /requestQuickSuggestion/);
  assert.match(panel, /Preencher apenas campos vazios/);
  assert.match(panel, /Substituir campos preenchidos/);
  assert.match(panel, /Desfazer sugestão/);
  assert.doesNotMatch(panel.match(/const applyQuickSuggestion[^]*?\n  \};/)?.[0] || '', /createTherapeuticProgram|submitProgram/);
});

test('grupo convertido abre o programa existente e nao reoferece criacao', () => {
  assert.match(panel, /const policyRecommendation = group\.convertedProgram/);
  assert.match(panel, /converted_program: group\.convertedProgram/);
  assert.match(panel, /Programa criado:/);
});

test('estado, filtros e posicao da recomendacao sao preservados ao voltar', () => {
  assert.match(panel, /recommendationScrollTopRef\.current = drawerScrollRef\.current\?\.scrollTop/);
  assert.match(panel, /drawerScrollRef\.current\.scrollTop = recommendationScrollTopRef\.current/);
  assert.match(panel, /if \(creationSource === 'recommendation'\) setCreationStep\('recommendation'\)/);
  assert.doesNotMatch(panel.match(/const resetCreation = \(\) => \{[^]*?\n  \};/)?.[0] || '', /setRecommendation(Query|Scope|Type|Origin|ProfessionalId|PeriodDays)/);
});

test('recomendacoes sao paginadas e carregadas em lote sem fetch por card', () => {
  const route = server.match(/app\.get\('\/api\/aba\/patients\/:patientId\/next-session\/recommendations'[^]*?\n  \}\);/)?.[0] || '';
  const enrichment = server.match(/const enrichTherapeuticRecommendationContexts = async[^]*?\n  \};/)?.[0] || '';
  assert.match(route, /\.limit\(limit \+ 1\)/);
  assert.match(route, /query\.lt\('created_at', beforeIso\)/);
  assert.match(route, /hasMore/);
  assert.match(route, /nextCursor/);
  assert.match(enrichment, /Promise\.all\(/);
  assert.match(enrichment, /targetIds/);
  assert.match(enrichment, /behaviorIds/);
  assert.match(enrichment, /sessionIds/);
  assert.match(enrichment, /professionalIds/);
  assert.match(enrichment, /assessmentIds/);
  assert.match(enrichment, /assessmentById/);
  assert.doesNotMatch(enrichment, /for \(const recommendation[^]*?supabase\.from/);
  assert.match(dataService, /before: options\.before/);
  assert.match(panel, /Carregar recomendacoes anteriores|Carregar recomenda/u);
});

test('avaliacao e profissional so entram no contexto depois de validacao no tenant', () => {
  const enrichment = server.match(/const enrichTherapeuticRecommendationContexts = async[^]*?\n  \};/)?.[0] || '';
  assert.match(enrichment, /\.from\('aba_mastery_evaluations'\)/);
  assert.match(enrichment, /\.eq\('organization_id', params\.organizationId\)/);
  assert.match(enrichment, /\.eq\('patient_id', params\.patientId\)/);
  assert.match(enrichment, /const profile: any = user \?/);
  assert.match(enrichment, /const scopedProfessionalId = user \? professionalId : ''/);
  assert.match(enrichment, /avaliação de origem fora do paciente ou da clínica atual/);
});

test('backend rejeita criacao para recomendacao que deve atuar no programa existente', () => {
  const createRoute = server.match(/app\.post\('\/api\/aba\/patients\/:patientId\/therapeutic-programs'[^]*?app\.patch\('\/api\/aba\/patients\/:patientId\/therapeutic-programs\/:programId\/status'/)?.[0] || '';
  assert.match(createRoute, /THERAPEUTIC_PROGRAM_CREATION_RECOMMENDATION_TYPES\.has\(recommendationType\)/);
  assert.match(createRoute, /THERAPEUTIC_RECOMMENDATION_ACTION_MISMATCH/);
  assert.match(createRoute, /targetProgramId/);
  assert.match(createRoute, /return res\.json\(\{ success: true, data: convertedResult\.data, idempotent: true/);
});

test('backend valida protocolo, dominio e habilidade na fonte canonica da clinica', () => {
  const createRoute = server.match(/app\.post\('\/api\/aba\/patients\/:patientId\/therapeutic-programs'[^]*?app\.patch\('\/api\/aba\/patients\/:patientId\/therapeutic-programs\/:programId\/status'/)?.[0] || '';
  const resolverStart = server.indexOf('function resolveProtocolSkillOriginForRoute');
  const resolverEnd = server.indexOf('function effortEmojiForPercent', resolverStart);
  const resolver = resolverStart >= 0 && resolverEnd > resolverStart ? server.slice(resolverStart, resolverEnd) : '';
  assert.match(createRoute, /THERAPEUTIC_PROGRAM_ORIGIN_TYPES\.has\(originType\)/);
  assert.match(createRoute, /originType === 'protocol'/);
  assert.match(createRoute, /fetchClinicStateWithSchemaFallback\(\{ supabase, clinicId/);
  assert.match(createRoute, /resolveProtocolSkillOriginForRoute\(stateResult\.data\?\.protocols/);
  assert.match(createRoute, /THERAPEUTIC_PROTOCOL_CONTEXT_INVALID/);
  assert.match(createRoute, /resolvedProtocolTitle = protocolOrigin\.protocolTitle/);
  assert.match(createRoute, /resolvedDomainName = protocolOrigin\.domainName/);
  assert.match(resolver, /item\?\.id/);
  assert.doesNotMatch(resolver, /title.*includes|name.*includes|localeCompare/i);
});

test('backend devolve contexto rastreavel e nao permite origem por texto', () => {
  const enrichment = server.match(/const enrichTherapeuticRecommendationContexts = async[^]*?\n  \};/)?.[0] || '';
  const applyBlock = panel.match(/const applyRecommendation = \(recommendation: any\) => \{[^]*?\n  \};/)?.[0] || '';
  assert.match(enrichment, /clinical_context/);
  assert.match(enrichment, /target:/);
  assert.match(enrichment, /behavior:/);
  assert.match(enrichment, /program:/);
  assert.match(enrichment, /protocol:/);
  assert.match(enrichment, /assessment:/);
  assert.match(enrichment, /source_session:/);
  assert.match(enrichment, /responsible_professional:/);
  assert.match(enrichment, /converted_program:/);
  assert.match(applyBlock, /target\?\.id/);
  assert.match(applyBlock, /target\?\.name/);
  assert.doesNotMatch(applyBlock, /recommendation\?\.title/);
  assert.match(applyBlock, /const objective = String\(target\?\.description \|\| context\?\.program\?\.objective \|\| targetName\)/);
  assert.match(applyBlock, /motive: context\?\.indicator\?\.reason \|\| recommendation\?\.summary/);
});

test('vinculo explicito valida paciente, tenant, alvo e permissao no servidor', () => {
  const route = server.match(/app\.post\('\/api\/aba\/recommendations\/:recommendationId\/link-target'[^]*?\n  \}\);/)?.[0] || '';
  assert.match(route, /requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(route, /String\(recommendation\.organization_id \|\| ''\) !== organizationId/);
  assert.match(route, /canAccessPatientInCurrentClinic/);
  assert.match(route, /link_therapeutic_recommendation_target/);
  assert.match(migration, /recommendation\.organization_id = p_organization_id/);
  assert.match(migration, /recommendation\.patient_id = p_patient_id/);
  assert.match(migration, /target\.organization_id = p_organization_id/);
  assert.match(migration, /target\.patient_id = p_patient_id/);
});

test('conversao e idempotente e serializada entre retries ou duas abas', () => {
  assert.match(migration, /guard_therapeutic_recommendation_conversion/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /THERAPEUTIC_RECOMMENDATION_ALREADY_CONVERTED/);
  assert.match(migration, /before insert or update on public\.aba_programs/);
  assert.match(migration, /create index if not exists idx_aba_programs_recommendation_origin_lookup/);
  assert.match(recommendationIdentity, /createHash\('sha256'\)/);
  assert.match(recommendationIdentity, /rec-sha256-/);
  assert.match(planningEngine, /pushUnique/);
  assert.match(planningEngine, /contextHash/);
  assert.doesNotMatch(migration, /drop table|delete from public\.aba_clinical_recommendations/i);
});

test('aplicacao contextual usa ids criptograficos e RPC transacional em retries', () => {
  assert.match(integrityMigration, /v_event_id := 'audit-sha256-'/);
  assert.match(integrityMigration, /'plan-sha256-' \|\| public\.aba_recommendation_sha256/);
  assert.match(integrityMigration, /p_idempotency_key/);
  assert.match(integrityMigration, /apply_aba_clinical_recommendation_decision_v2/);
  assert.match(
    integrityMigration,
    /v_recommendation\.id \|\| '\|' \|\| v_action \|\| '\|' \|\| p_idempotency_key/
  );
});

test('programa so e vinculado no RPC final e cancelar nao trata recomendacao', () => {
  const createRoute = server.match(/app\.post\('\/api\/aba\/patients\/:patientId\/therapeutic-programs'[^]*?app\.patch\('\/api\/aba\/patients\/:patientId\/therapeutic-programs\/:programId\/status'/)?.[0] || '';
  const resetBlock = panel.match(/const resetCreation = \(\) => \{[^]*?\n  \};/)?.[0] || '';
  assert.match(createRoute, /originType === 'recommendation'/);
  assert.match(createRoute, /recommendationTargetId/);
  assert.match(createRoute, /p_origin_id: originId/);
  assert.match(createRoute, /create_therapeutic_program/);
  assert.doesNotMatch(resetBlock, /updateAbaRecommendation|createTherapeuticProgram|acceptAbaRecommendation/);
  assert.match(panel, /disabled=\{saving\}/);
});

test('migration e aditiva, idempotente e preserva historico', () => {
  assert.match(migration, /create index if not exists/);
  assert.match(migration, /create or replace function public\.link_therapeutic_recommendation_target/);
  assert.match(migration, /drop trigger if exists/);
  assert.match(migration, /on conflict \(id\) do nothing/);
  assert.match(migration, /aba_clinical_recommendation_audit_logs/);
  assert.match(migration, /revoke all on function/);
  assert.match(migration, /grant execute .* to service_role/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from/i);
});

for (const { name, fn } of tests) {
  fn();
  console.log(`[ok] ${name}`);
}

console.log(`[ok] ${tests.length} testes do drawer e das recomendacoes terapeuticas passaram.`);
