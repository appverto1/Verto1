import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ABA_DEFAULT_PROMPT_TYPES,
  buildAbaPromptSnapshot,
  normalizeAbaPromptTypeConfig,
  resolveTrialPromptInfo
} from '../src/utils/abaPromptLevels.ts';
import { calculateTrialIndependence, buildSessionReport, calculateSessionSummary } from '../src/utils/abaSessionSummary.ts';

const root = process.cwd();
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const settingsCode = readFileSync(join(root, 'src/components/ClinicGlobalSettingsPanel.tsx'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260708120000_aba_prompt_types.sql'), 'utf8');
const clinicalSettingsStart = settingsCode.indexOf('function AbaPromptTypesClinicalSettings');
const clinicalSettingsEnd = settingsCode.indexOf('function MediaDropzone', clinicalSettingsStart);
const clinicalSettingsCode = settingsCode.slice(clinicalSettingsStart, clinicalSettingsEnd);

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('defaults include configurable Visual parcial without duplicating legacy prompt levels', () => {
  const defaults = normalizeAbaPromptTypeConfig();
  assert.equal(defaults.some((prompt) => prompt.name === 'Visual parcial' && prompt.independenceScore === 80), true);
  assert.equal(ABA_DEFAULT_PROMPT_TYPES.some((prompt) => prompt.name === 'Visual parcial'), true);
});

test('custom clinic prompt names and scores are preserved', () => {
  const custom = normalizeAbaPromptTypeConfig([
    {
      id: 'prompt-1',
      name: 'Visual parcial leve',
      category: 'Visual',
      independence_score: 85,
      intrusiveness_order: 1,
      counts_as_independent: false,
      show_in_session: true,
      active: true
    }
  ]).find((prompt) => prompt.id === 'prompt-1');
  assert.ok(custom);
  assert.equal(custom.label, 'Visual parcial leve');
  assert.equal(custom.independenceScore, 85);
  assert.equal(custom.category, 'Visual');
});

test('trial prompt snapshot drives configured independence score', () => {
  const info = resolveTrialPromptInfo({
    promptTypeId: 'prompt-1',
    promptTypeNameSnapshot: 'Visual parcial',
    promptCategorySnapshot: 'Visual',
    promptIndependenceScoreSnapshot: 80,
    promptIntrusivenessOrderSnapshot: 1,
    promptLevelKey: 'visual_partial'
  });
  assert.equal(info.label, 'Visual parcial');
  assert.equal(info.independenceScore, 80);
  assert.equal(info.hasScoreSnapshot, true);
  const snapshot = buildAbaPromptSnapshot({
    promptTypeId: 'prompt-1',
    promptTypeNameSnapshot: 'Visual parcial',
    promptCategorySnapshot: 'Visual',
    promptIndependenceScoreSnapshot: 80,
    promptIntrusivenessOrderSnapshot: 1
  });
  assert.equal(snapshot.prompt_type_name_snapshot, 'Visual parcial');
  assert.equal(snapshot.prompt_independence_score_snapshot, 80);
});

test('old events keep the legacy binary independence fallback', () => {
  assert.equal(calculateTrialIndependence([
    { promptLevelKey: 'independent', independent: true, correct: true },
    { promptLevelKey: 'visual', independent: false, correct: true },
    { promptLevelKey: 'error', independent: false, correct: false }
  ]), 33);
});

test('new events use prompt score snapshots in session independence', () => {
  assert.equal(calculateTrialIndependence([
    { promptLevelKey: 'visual_partial', promptIndependenceScoreSnapshot: 80, correct: true, independent: false },
    { promptLevelKey: 'independent', promptIndependenceScoreSnapshot: 100, correct: true, independent: true }
  ]), 90);
});

test('session report lists configured prompt names', () => {
  const summary = calculateSessionSummary('session-1', {
    patientId: 'patient-1',
    patientName: 'Paciente Teste',
    startedAt: '2026-07-08T10:00:00.000Z',
    endedAt: '2026-07-08T10:50:00.000Z',
    trials: [
      { id: 't1', kind: 'trial', title: 'Nomear cores', promptLevelKey: 'visual_partial', promptTypeNameSnapshot: 'Visual parcial', promptIndependenceScoreSnapshot: 80, correct: true, independent: false, score: 0.5 }
    ]
  });
  const report = buildSessionReport({
    ...summary,
    sourceRecords: [
      { id: 't1', kind: 'trial', title: 'Nomear cores', promptLevelKey: 'visual_partial', promptTypeNameSnapshot: 'Visual parcial', promptIndependenceScoreSnapshot: 80, correct: true, independent: false, score: 0.5 }
    ]
  });
  assert.equal(report.teachingSummary.promptsUsed.some((prompt) => prompt.label === 'Visual parcial'), true);
});

test('SessionMode loads clinic prompt types and saves snapshots with trials and maintenance probes', () => {
  assert.match(sessionModeCode, /dataService\.getAbaPromptTypes\(\)/);
  assert.match(sessionModeCode, /buildSessionPromptSnapshot\(selectedPrompt\)/);
  assert.match(sessionModeCode, /promptTypeId: promptSnapshot\.promptTypeId/);
  assert.match(sessionModeCode, /promptIndependenceScoreSnapshot: promptSnapshot\.promptIndependenceScoreSnapshot/);
  assert.match(sessionModeCode, /promptedPromptOptions\.map\(\(prompt\) =>/);
  assert.match(sessionModeCode, /handleTrialClick\(goal, 0\.5, 'prompted', prompt\.key\)/);
});

test('data service and server expose tenant-scoped prompt type APIs', () => {
  assert.match(dataServiceCode, /getAbaPromptTypes/);
  assert.match(dataServiceCode, /saveAbaPromptType/);
  assert.match(dataServiceCode, /buildAbaPromptSnapshot/);
  assert.match(serverCode, /app\.get\('\/api\/aba\/prompt-types'/);
  assert.match(serverCode, /app\.patch\('\/api\/aba\/prompt-types\/:promptTypeId'/);
  assert.match(serverCode, /Tipo de ajuda não pertence a esta clínica/);
  assert.match(serverCode, /prompt_independence_score_snapshot/);
});

test('clinic settings exposes Tipos de ajuda ABA management', () => {
  assert.match(settingsCode, /<AbaPromptTypesClinicalSettings \/>/);
  assert.match(clinicalSettingsCode, /function AbaPromptTypesClinicalSettings/);
  assert.match(clinicalSettingsCode, /Tipos de ajuda ABA/);
  assert.match(clinicalSettingsCode, /Visual parcial leve/);
  assert.match(clinicalSettingsCode, /Inativar/);
  assert.match(clinicalSettingsCode, /Reativar/);
});

test('clinic prompt settings explains score and suggested scale in clinical language', () => {
  assert.match(clinicalSettingsCode, /Como funciona a pontuação/);
  assert.match(clinicalSettingsCode, /100 = resposta independente/);
  assert.match(clinicalSettingsCode, /0 = resposta totalmente dependente ou erro/);
  assert.match(clinicalSettingsCode, /Escala sugerida/);
  assert.match(clinicalSettingsCode, /Ajuda mínima/);
  assert.match(clinicalSettingsCode, /Ajuda moderada/);
  assert.match(clinicalSettingsCode, /Ajuda intensa/);
});

test('clinic prompt settings renders compact list instead of open spreadsheet rows', () => {
  const listStart = clinicalSettingsCode.indexOf('Lista de tipos ativos');
  const listEnd = clinicalSettingsCode.indexOf('{inactivePromptTypes.length', listStart);
  const listCode = clinicalSettingsCode.slice(listStart, listEnd);
  assert.match(listCode, /<table/);
  assert.match(listCode, /Tipo de ajuda/);
  assert.match(listCode, /Categoria da ajuda/);
  assert.match(listCode, /Pontuação de independência/);
  assert.match(listCode, /Mostrar durante a sessão/);
  assert.match(listCode, /Conta como resposta independente/);
  assert.match(listCode, /Editar/);
  assert.doesNotMatch(listCode, /<input/);
  assert.doesNotMatch(listCode, /value=\{prompt\.name\}/);
});

test('clinic prompt settings uses modal with validation and persistent save feedback', () => {
  assert.match(clinicalSettingsCode, /role="dialog"/);
  assert.match(clinicalSettingsCode, /max-h-\[90vh\]/);
  assert.match(clinicalSettingsCode, /overflow-y-auto/);
  assert.match(clinicalSettingsCode, /Editar tipo de ajuda/);
  assert.match(clinicalSettingsCode, /Novo tipo de ajuda/);
  assert.match(clinicalSettingsCode, /Nome do tipo de ajuda/);
  assert.match(clinicalSettingsCode, /A pontuação de independência deve ficar entre 0 e 100/);
  assert.match(clinicalSettingsCode, /Salvar alterações/);
  assert.match(clinicalSettingsCode, /Salvando\.\.\./);
  assert.match(clinicalSettingsCode, /✓ Salvo/);
});

test('clinic prompt settings preview and inactive handling are clinically clear', () => {
  assert.match(clinicalSettingsCode, /Prévia na sessão/);
  assert.match(clinicalSettingsCode, /sessionPreviewPromptTypes/);
  assert.match(clinicalSettingsCode, /filter\(\(prompt\) => prompt\.showInSession\)/);
  assert.match(clinicalSettingsCode, /Nenhum tipo de ajuda ativo para aparecer na sessão/);
  assert.match(clinicalSettingsCode, /Tipos inativos/);
  assert.match(clinicalSettingsCode, /<details/);
});

test('migration is additive and multi-tenant scoped', () => {
  assert.match(migrationCode, /create table if not exists public\.aba_prompt_types/);
  assert.match(migrationCode, /organization_id uuid not null/);
  assert.match(migrationCode, /alter table public\.aba_trials[\s\S]*prompt_type_id/);
  assert.match(migrationCode, /alter table public\.aba_maintenance_probe_results[\s\S]*prompt_type_id/);
  assert.match(migrationCode, /enable row level security/);
  assert.match(migrationCode, /aba_prompt_types_clinic_write/);
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
