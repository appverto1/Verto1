import assert from 'node:assert/strict';
import {
  getDockVisibleShortcuts,
  normalizeQuickBehaviorShortcuts,
  shouldShowClinicalDock
} from '../src/utils/abaClinicalDock.ts';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const behaviors = [
  { id: 'crying', name: 'Choro', defaultMeasurement: 'duration' },
  { id: 'escape', name: 'Fuga da atividade', defaultMeasurement: 'duration' },
  { id: 'aggression', name: 'Agressão', defaultMeasurement: 'frequency' },
  { id: 'self_injury', name: 'Autoagressão', defaultMeasurement: 'frequency' },
  { id: 'refusal', name: 'Recusa', defaultMeasurement: 'frequency' },
  { id: 'stereotypy', name: 'Estereotipia', defaultMeasurement: 'partial_interval' }
];

test('dock aparece no mobile/tablet e não aparece no desktop por padrão', () => {
  assert.equal(shouldShowClinicalDock(360), true);
  assert.equal(shouldShowClinicalDock(768), true);
  assert.equal(shouldShowClinicalDock(1024), true);
  assert.equal(shouldShowClinicalDock(1280), false);
});

test('dock pode aparecer no desktop quando modo foco força a experiência compacta', () => {
  assert.equal(shouldShowClinicalDock(1280, true), true);
});

test('atalhos padrão priorizam frequência e duração de crise sem depender do formulário selecionado', () => {
  const shortcuts = normalizeQuickBehaviorShortcuts(null, behaviors);
  const visible = getDockVisibleShortcuts(shortcuts);
  assert.deepEqual(visible.map((shortcut) => shortcut.behaviorId), ['aggression', 'escape', 'refusal']);
  assert.equal(visible.find((shortcut) => shortcut.behaviorId === 'aggression')?.method, 'frequency');
  assert.equal(visible.find((shortcut) => shortcut.behaviorId === 'escape')?.method, 'duration');
});

test('modo crise mantém atalhos críticos no dock', () => {
  const shortcuts = normalizeQuickBehaviorShortcuts(null, behaviors);
  const visible = getDockVisibleShortcuts(shortcuts, { crisisMode: true, limit: 3 });
  assert.deepEqual(visible.map((shortcut) => shortcut.behaviorId), ['aggression', 'self_injury', 'escape']);
});

test('configuração futura por paciente/clínica controla prioridade e visibilidade', () => {
  const shortcuts = normalizeQuickBehaviorShortcuts([
    { behaviorId: 'crying', label: 'Choro rápido', method: 'duration', priority: 1, visibleInDock: true, color: 'sky' },
    { behaviorId: 'aggression', label: 'AG +1', method: 'frequency', priority: 2, visibleInDock: false, color: 'red' },
    { behaviorId: 'refusal', label: 'Recusa +1', method: 'frequency', priority: 3, visibleInDock: true, color: 'violet' }
  ], behaviors);
  const visible = getDockVisibleShortcuts(shortcuts);
  assert.deepEqual(visible.map((shortcut) => shortcut.behaviorId), ['crying', 'refusal']);
  assert.equal(shortcuts[0].label, 'Choro rápido');
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
