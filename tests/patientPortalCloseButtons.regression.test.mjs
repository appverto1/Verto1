import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');

const expectedCloseControls = [
  ['configurações', 'Fechar configurações'],
  ['diário da família', 'Fechar diário da família'],
  ['mensagens', 'Fechar mensagens'],
  ['humor', 'Fechar registro de humor'],
  ['tarefa', 'Fechar tarefa'],
];

for (const [label, ariaLabel] of expectedCloseControls) {
  const marker = `aria-label="${ariaLabel}"`;
  const index = dashboard.indexOf(marker);
  assert.notEqual(index, -1, `botão de fechar de ${label} deve existir`);
  const fragment = dashboard.slice(Math.max(0, index - 260), index + 650);
  assert.match(fragment, /type="button"/, `fechar ${label} não pode submeter formulário/contexto ancestral`);
  assert.match(fragment, /event\.preventDefault\(\)/, `fechar ${label} deve neutralizar ação default`);
  assert.match(fragment, /event\.stopPropagation\(\)/, `fechar ${label} deve isolar o clique do painel`);
  assert.match(fragment, /z-30/, `fechar ${label} precisa ficar acima do conteúdo do modal`);
  assert.match(fragment, /touch-manipulation/, `fechar ${label} deve manter hit target confiável em touch`);
}

assert.match(dashboard, /aria-label="Fechar registro de humor"[\s\S]{0,450}?closeMoodModal\(\)/);
assert.match(dashboard, /aria-label="Fechar tarefa"[\s\S]{0,450}?closeTaskModal\(\)/);
assert.match(dashboard, /aria-label="Fechar diário da família"[\s\S]{0,450}?setIsFamilyLogOpen\(false\)/);
assert.match(dashboard, /aria-label="Fechar mensagens"[\s\S]{0,450}?setIsMessagesOpen\(false\)/);
assert.match(dashboard, /aria-label="Fechar configurações"[\s\S]{0,450}?setIsSettingsOpen\(false\)/);

console.log('patientPortalCloseButtons.regression.test.mjs: ok');
