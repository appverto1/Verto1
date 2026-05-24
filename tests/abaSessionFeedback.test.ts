import assert from 'node:assert/strict';
import {
  ClinicalActionDebounceGate,
  buildClinicalActionToast,
  buildClinicalOfflineToast,
  buildClinicalSaveErrorToast
} from '../src/utils/abaSessionFeedback.ts';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('toast aparece após registrar frequência', () => {
  const toast = buildClinicalActionToast({
    action: 'frequency',
    behaviorName: 'Agressão',
    countDelta: 1,
    location: 'Mesa',
    severity: 2
  });
  assert.equal(toast.variant, 'success');
  assert.equal(toast.title, 'Agressão registrada');
  assert.equal(toast.subtitle, '+1 ocorrência • Mesa • severidade 2');
});

test('toast aparece após tentativa independente e com ajuda', () => {
  const independent = buildClinicalActionToast({
    action: 'trial',
    outcome: 'independent',
    collectionLabel: 'DTT',
    score: 1
  });
  const prompted = buildClinicalActionToast({
    action: 'trial',
    outcome: 'prompted',
    collectionLabel: 'DTT',
    promptLabel: 'Verbal',
    score: 0.5
  });
  assert.equal(independent.title, 'Tentativa registrada');
  assert.equal(independent.subtitle, 'Independente • DTT • 1.0');
  assert.equal(prompted.subtitle, 'Com ajuda verbal • DTT • 0.5');
});

test('toast aparece após encerrar duração', () => {
  const toast = buildClinicalActionToast({
    action: 'duration_end',
    behaviorName: 'Choro',
    durationSeconds: 42
  });
  assert.equal(toast.title, 'Choro encerrado');
  assert.equal(toast.subtitle, 'Duração: 00:42');
});

test('toast de erro aparece se salvar falhar', () => {
  const toast = buildClinicalSaveErrorToast();
  assert.equal(toast.variant, 'error');
  assert.equal(toast.title, 'Não foi possível salvar');
  assert.equal(toast.subtitle, 'Tente novamente. Nenhum dado foi perdido.');
});

test('toast offline informa sincronização futura', () => {
  const toast = buildClinicalOfflineToast();
  assert.equal(toast.variant, 'warning');
  assert.equal(toast.title, 'Salvo no dispositivo');
  assert.equal(toast.subtitle, 'Será sincronizado quando houver conexão.');
});

test('debounce impede duplo registro acidental em tentativa', () => {
  const gate = new ClinicalActionDebounceGate();
  assert.equal(gate.acquire('trial:goal-1:independent', 600, 1000), true);
  assert.equal(gate.acquire('trial:goal-1:independent', 600, 1200), false);
  assert.equal(gate.acquire('trial:goal-1:independent', 600, 1700), true);
});

test('intervalo SIM/NÃO não permite dupla resposta no mesmo intervalo', () => {
  const gate = new ClinicalActionDebounceGate();
  assert.equal(gate.acquire('interval:run-1:4', 0, 1000), true);
  assert.equal(gate.acquire('interval:run-1:4', 0, 1001), false);
  assert.equal(gate.acquire('interval:run-1:5', 0, 1002), true);
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
