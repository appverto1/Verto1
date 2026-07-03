import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  behaviorAllowsMeasurement,
  buildBehaviorEventContextSnapshot,
  formatBehaviorHistoryDetail,
  readBehaviorEventContextSnapshot,
  getBehaviorDefaultMeasurement,
  isDurationOnlyBehavior,
  resolveBehaviorMeasurementForAction
} from '../src/utils/abaBehaviorCapture.ts';
import { normalizeQuickBehaviorShortcuts } from '../src/utils/abaClinicalDock.ts';
import { buildSessionReport, calculateSessionSummary } from '../src/utils/abaSessionSummary.ts';

const root = process.cwd();
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const durationOnlyBehavior = {
  id: 'crying',
  name: 'Choro',
  defaultMeasurement: 'duration',
  allowedMeasurements: ['duration']
};

const frequencyBehavior = {
  id: 'aggression',
  name: 'Agressão',
  defaultMeasurement: 'frequency',
  allowedMeasurements: ['frequency']
};

test('duration-only behavior normalizes stale frequency actions back to duration', () => {
  assert.equal(isDurationOnlyBehavior(durationOnlyBehavior), true);
  assert.equal(getBehaviorDefaultMeasurement(durationOnlyBehavior), 'duration');
  assert.equal(behaviorAllowsMeasurement(durationOnlyBehavior, 'frequency'), false);
  assert.equal(resolveBehaviorMeasurementForAction(durationOnlyBehavior, 'frequency'), 'duration');
  assert.equal(resolveBehaviorMeasurementForAction(frequencyBehavior, 'frequency'), 'frequency');
});

test('dock shortcuts cannot force + frequency for Choro or Fuga when they are duration-only', () => {
  const shortcuts = normalizeQuickBehaviorShortcuts([
    { behaviorId: 'crying', label: 'Choro +1', method: 'frequency', priority: 1, visibleInDock: true },
    { behaviorId: 'escape', label: 'Fuga +1', method: 'frequency', priority: 2, visibleInDock: true },
    { behaviorId: 'aggression', label: 'Agressão +1', method: 'frequency', priority: 3, visibleInDock: true }
  ], [
    durationOnlyBehavior,
    { id: 'escape', name: 'Fuga da atividade', defaultMeasurement: 'duration', allowedMeasurements: ['duration'] },
    frequencyBehavior
  ]);
  assert.equal(shortcuts.find((shortcut) => shortcut.behaviorId === 'crying')?.method, 'duration');
  assert.equal(shortcuts.find((shortcut) => shortcut.behaviorId === 'escape')?.method, 'duration');
  assert.equal(shortcuts.find((shortcut) => shortcut.behaviorId === 'aggression')?.method, 'frequency');
});

test('duration history includes duration, severity and location in one human label', () => {
  assert.equal(formatBehaviorHistoryDetail({
    measurementType: 'duration',
    durationSeconds: 133,
    severity: 2,
    location: 'Mesa',
    status: 'COMPLETED'
  }), 'Duração 02:13 · severidade 2 · Mesa');
});

test('behavior context snapshot preserves the location used when event was recorded', () => {
  const firstSnapshot = buildBehaviorEventContextSnapshot({
    behaviorName: 'Estereotipia',
    behaviorId: 'stereotypy',
    measurementType: 'partial_interval',
    location: 'Brinquedoteca',
    severity: 3,
    sessionId: 'session-1',
    patientId: 'patient-1',
    timestamp: '2026-06-26T16:00:00.000Z'
  });
  const secondSnapshot = buildBehaviorEventContextSnapshot({
    behaviorName: 'Estereotipia',
    behaviorId: 'stereotypy',
    measurementType: 'partial_interval',
    location: 'Mesa',
    severity: 2,
    sessionId: 'session-1',
    patientId: 'patient-1',
    timestamp: '2026-06-26T16:05:00.000Z'
  });
  assert.equal(firstSnapshot.location, 'Brinquedoteca');
  assert.equal(firstSnapshot.severity, 3);
  assert.equal(secondSnapshot.location, 'Mesa');

  const readBack = readBehaviorEventContextSnapshot({
    behavior_name: 'Estereotipia',
    location: 'Mesa',
    severity: 1,
    raw_payload: { contextSnapshot: firstSnapshot }
  });
  assert.equal(readBack?.location, 'Brinquedoteca');
  assert.equal(readBack?.severity, 3);
});

test('duration episodes derive occurrence counts without frequency duplication', () => {
  const summary = calculateSessionSummary('session-1', {
    behaviorEvents: [
      { sessionId: 'session-1', behaviorName: 'Choro', measurementType: 'duration', durationSeconds: 80, status: 'COMPLETED', location: 'Mesa', severity: 2 },
      { sessionId: 'session-1', behaviorName: 'Choro', measurementType: 'duration', durationSeconds: 40, status: 'COMPLETED', location: 'Mesa', severity: 4 },
      { sessionId: 'session-1', behaviorName: 'Choro', measurementType: 'duration', status: 'IN_PROGRESS', location: 'Mesa', severity: 3 },
      { sessionId: 'session-1', behaviorName: 'Agressão', measurementType: 'frequency', countDelta: 1, location: 'Sala', severity: 3 }
    ]
  });
  assert.equal(summary.durationSummary.find((item) => item.behaviorName === 'Choro')?.episodes, 2);
  assert.equal(summary.durationSummary.find((item) => item.behaviorName === 'Choro')?.totalSeconds, 120);
  assert.equal(summary.frequencySummary.find((item) => item.behaviorName === 'Choro'), undefined);
  assert.equal(summary.frequencySummary.find((item) => item.behaviorName === 'Agressão')?.occurrences, 1);

  const report = buildSessionReport(summary, {
    behaviorRecords: [
      { title: 'Choro', measurementType: 'duration', durationSeconds: 80, status: 'COMPLETED', location: 'Mesa', severity: 2 },
      { title: 'Choro', measurementType: 'duration', durationSeconds: 40, status: 'COMPLETED', location: 'Mesa', severity: 4 },
      { title: 'Choro', measurementType: 'duration', status: 'IN_PROGRESS', location: 'Mesa', severity: 3 },
      { title: 'Agressão', measurementType: 'frequency', countDelta: 1, location: 'Sala', severity: 3 }
    ]
  });
  const choroDuration = report.behaviorSummaries.duration.find((item) => item.behavior === 'Choro');
  assert.equal(choroDuration?.episodes, 2);
  assert.equal(choroDuration?.totalSeconds, 120);
  assert.equal(report.behaviorSummaries.frequency.find((item) => item.behavior === 'Choro'), undefined);
});

test('SessionMode renders duration-only actions without + ocorrência inside duration block', () => {
  assert.match(sessionModeCode, /id: 'crying'[\s\S]*?allowedMeasurements: \['duration'\]/m);
  assert.match(sessionModeCode, /id: 'escape'[\s\S]*?allowedMeasurements: \['duration'\]/m);
  const durationBlockStart = sessionModeCode.indexOf("{behaviorMeasurementType === 'duration' &&");
  const durationBlockEnd = sessionModeCode.indexOf("{behaviorMeasurementType === 'rate'", durationBlockStart);
  const durationBlock = sessionModeCode.slice(durationBlockStart, durationBlockEnd);
  assert.match(durationBlock, /Iniciar dura/);
  assert.match(durationBlock, /Encerrar/);
  assert.match(durationBlock, /ABC rápido/);
  assert.doesNotMatch(durationBlock, /\+ ocorr/);
  assert.match(sessionModeCode, /aria-pressed=\{selectedLocation === location\}/m);
  assert.match(sessionModeCode, /aria-pressed=\{selectedSeverity === severity\}/m);
});

test('SessionMode keeps behavior controls in the clinical dock sheet, not the initial body', () => {
  assert.match(sessionModeCode, /\{false && \(\s*<div className="bg-white rounded-\[24px\][\s\S]*?Evento comportamental inteligente/m);
  assert.match(sessionModeCode, /data-aba-clinical-dock[\s\S]*?Ações rápidas[\s\S]*?Contexto atual[\s\S]*?Ajustar contexto[\s\S]*?Últimos registros/m);
  assert.match(sessionModeCode, /buildBehaviorEventContextSnapshot[\s\S]*?contextSnapshot[\s\S]*?context_snapshot/m);
});

test('Dock Clínico abre compacto e recolhe seletores em Ajustar contexto', () => {
  const sheetStart = sessionModeCode.indexOf('data-aba-clinical-dock-sheet');
  const contextPanelGate = sessionModeCode.indexOf('{clinicalDockContextOpen &&', sheetStart);
  const sheetEnd = sessionModeCode.indexOf('const sessionModeContent', sheetStart);
  assert.ok(sheetStart > 0);
  assert.ok(contextPanelGate > sheetStart);
  assert.ok(sheetEnd > contextPanelGate);

  const defaultDockView = sessionModeCode.slice(sheetStart, contextPanelGate);
  assert.match(defaultDockView, /Ações rápidas/);
  assert.match(defaultDockView, /Contexto atual/);
  assert.match(defaultDockView, /Ajustar contexto/);
  assert.match(defaultDockView, /Registrar com contexto atual/);
  assert.match(defaultDockView, /ABC rápido/);
  assert.doesNotMatch(defaultDockView, /<select/);

  const contextPanel = sessionModeCode.slice(contextPanelGate, sheetEnd);
  assert.match(contextPanel, /data-aba-dock-context-panel/);
  assert.match(contextPanel, /data-aba-dock-location-chips/);
  assert.match(contextPanel, /data-aba-dock-severity-chips/);
  assert.match(contextPanel, /data-aba-dock-duration-chips/);
  assert.match(contextPanel, /Gerenciar locais/);
  assert.match(contextPanel, /Mais durações/);
  assert.match(contextPanel, /Personalizar/);
  const locationBlock = contextPanel.slice(contextPanel.indexOf('data-aba-dock-location-chips'), contextPanel.indexOf('data-aba-dock-severity-chips'));
  const severityBlock = contextPanel.slice(contextPanel.indexOf('data-aba-dock-severity-chips'), contextPanel.indexOf('Configurações rápidas'));
  const durationBlock = contextPanel.slice(contextPanel.indexOf('data-aba-dock-duration-chips'), contextPanel.indexOf('Quantidade'));
  assert.doesNotMatch(locationBlock, /<select/);
  assert.doesNotMatch(severityBlock, /<select/);
  assert.doesNotMatch(durationBlock, /<select/);
  assert.match(contextPanel, /Comportamento[\s\S]*?<select/);
  assert.match(contextPanel, /Método de coleta[\s\S]*?<select/);
  assert.match(contextPanel, /Duração/);
  assert.match(contextPanel, /Quantidade/);
  assert.match(contextPanel, /Alerta/);
});

test('Dock Clínico usa seleção rápida de local, severidade e duração no contexto salvo', () => {
  const sheetStart = sessionModeCode.indexOf('data-aba-clinical-dock-sheet');
  const sheetEnd = sessionModeCode.indexOf('const sessionModeContent', sheetStart);
  const dockSheet = sessionModeCode.slice(sheetStart, sheetEnd);
  assert.match(dockSheet, /onClick=\{\(\) => setSelectedLocation\(location\)\}/);
  assert.match(dockSheet, /aria-pressed=\{selectedLocation === location\}/);
  assert.match(dockSheet, /onClick=\{\(\) => setSelectedSeverity\(severity\)\}/);
  assert.match(dockSheet, /aria-pressed=\{selectedSeverity === severity\}/);
  assert.match(dockSheet, /quickIntervalDurationOptions\.map/);
  assert.match(dockSheet, /onClick=\{\(\) => setIntervalDurationMode\(option\.key\)\}/);
  assert.match(sessionModeCode, /location: overrides\.location \?\? selectedLocation/);
  assert.match(sessionModeCode, /severity: overrides\.severity \?\? selectedSeverity/);
  assert.match(sessionModeCode, /durationSeconds: overrides\.durationSeconds \?\? overrides\.duration_seconds \?\? null/);
});

test('Dock Clínico gerencia muitos locais sem requisitar backend nem alterar eventos antigos', () => {
  assert.match(sessionModeCode, /verto\.aba_dock_locations:\$\{resolvedClinicId \|\| patientId \|\| 'local'\}/);
  assert.match(sessionModeCode, /window\.localStorage\.getItem\(dockLocationStorageKey\)/);
  assert.match(sessionModeCode, /window\.localStorage\.setItem\(dockLocationStorageKey/);
  assert.match(sessionModeCode, /visibleDockLocationOptions = dockLocationsExpanded \? dockLocationOptions : dockLocationOptions\.slice\(0, 6\)/);
  assert.match(sessionModeCode, /dockLocationOptions\.length > 6/);
  assert.match(sessionModeCode, /Ver mais/);
  assert.match(sessionModeCode, /Mostrar menos/);
  assert.match(sessionModeCode, /addDockLocation/);
  assert.match(sessionModeCode, /renameDockLocation/);
  assert.match(sessionModeCode, /removeDockLocation/);
  assert.doesNotMatch(sessionModeCode, /saveAbaDockLocation|fetchAbaDockLocation|deleteAbaDockLocation/);
});

test('Dock Clínico não exibe mojibake em textos visíveis', () => {
  const sheetStart = sessionModeCode.indexOf('data-aba-clinical-dock-sheet');
  const sheetEnd = sessionModeCode.indexOf('const sessionModeContent', sheetStart);
  const dockSheet = sessionModeCode.slice(sheetStart, sheetEnd);
  assert.doesNotMatch(dockSheet, /DuraÃ|ConfiguraÃ|MÃ©|SessÃ|HistÃ|Ãƒ|â€¢|â–|ABC rapido|Registro rapido/);
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
