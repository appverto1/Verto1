import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const patientDashboardCode = readFileSync(join(root, 'src/components/PatientDashboard.tsx'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function between(startMarker: string, endMarker: string) {
  const start = patientDashboardCode.indexOf(startMarker);
  const end = patientDashboardCode.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} nao encontrado.`);
  assert.ok(end > start, `${endMarker} nao encontrado depois de ${startMarker}.`);
  return patientDashboardCode.slice(start, end);
}

test('home Kids continua renderizando metricas, graficos, protocolo e diario da familia', () => {
  const kidsBlock = between('if (isKidsProfile) {', 'const dailyReviewTasks = useMemo');
  const requiredMarkers = [
    "portalSection === 'home' &&",
    'Registros 7d',
    'kidsGamification.weekLogs',
    'kidsGamification.stars',
    'Fotos 7d',
    'kidsGamification.weekPhotos',
    'Protocolo ativo atual',
    'selectedBaseDate',
    'selectedCompareDate',
    'EvolutionBarChart',
    'CumulativeGrowthChart',
    'Últimos Registros do Diário da Família',
    'familyDiaryHistory',
    'Diário da Família',
    'handleConfirmFamilyNote',
    'DrawingCanvas'
  ];

  for (const marker of requiredMarkers) {
    assert.ok(kidsBlock.includes(marker), `${marker} deve permanecer na home Kids.`);
  }
});

test('menu Kids usa hamburger sem remover atalhos clinicos da home', () => {
  assert.match(patientDashboardCode, /const portalMenu = isKidsProfile \? null : \(/);
  assert.match(patientDashboardCode, /portalMenuItems\.map\(\(item\) =>/);
  assert.match(patientDashboardCode, /onClick=\{\(\) => \{ setPortalSection\(item\.id\); setIsMenuOpen\(false\); \}\}/);
  assert.match(patientDashboardCode, /\.\.\.\(!isKidsProfile \? \[\{ id: 'tasks', label: 'Tarefas'/);
  assert.match(patientDashboardCode, /{!isKidsProfile && \(\s*<div className="mb-6 grid gap-3 sm:grid-cols-2">[\s\S]*setPortalSection\('tasks'\)/);
  const homeSummary = between('const portalAnamnesisTopNotice =', 'const renderPortalAnamnesisField');
  assert.doesNotMatch(homeSummary, /setPortalSection\('appointments'\)|Pr.xima consulta|Abrir agenda/);
});

test('persistencia visual Kids continua baseada em dados existentes e nao mocks', () => {
  assert.match(patientDashboardCode, /familyDiaryHistory = useMemo/);
  assert.match(patientDashboardCode, /history\s*\.filter\(\(item: any\) => item\.type === 'family_note' \|\| item\.type === 'photo'\)/);
  assert.match(patientDashboardCode, /kidsGamification = useMemo/);
  assert.match(patientDashboardCode, /activeKidsProtocolEvents/);
  assert.doesNotMatch(patientDashboardCode, /mock[A-Z]|fake[A-Z]|dummy[A-Z]/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} patient dashboard checks passed`);
