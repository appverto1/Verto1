import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeClinicalTextEntities, normalizeClinicalTextRecord } from '../src/utils/clinicalText.ts';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('decodifica entidades nomeadas, numéricas e apóstrofos', () => {
  assert.equal(decodeClinicalTextEntities('&quot;Faça igual&quot;'), '"Faça igual"');
  assert.equal(decodeClinicalTextEntities('&#34;Faça assim&#34;'), '"Faça assim"');
  assert.equal(decodeClinicalTextEntities('João &amp; Maria'), 'João & Maria');
  assert.equal(decodeClinicalTextEntities('&apos;teste&apos; e &#39;outro&#39;'), "'teste' e 'outro'");
  assert.equal(decodeClinicalTextEntities('um&nbsp;espaço'), 'um espaço');
});

test('decodifica uma camada dupla com limite determinístico', () => {
  assert.equal(decodeClinicalTextEntities('&amp;quot;Texto&amp;quot;'), '"Texto"');
  assert.equal(decodeClinicalTextEntities('&amp;amp;quot;Texto&amp;amp;quot;'), '&quot;Texto&quot;');
});

test('mantém texto comum, vazio e nulo estáveis', () => {
  assert.equal(decodeClinicalTextEntities('Texto sem entidades'), 'Texto sem entidades');
  assert.equal(decodeClinicalTextEntities(''), '');
  assert.equal(decodeClinicalTextEntities(null), '');
});

test('tags decodificadas permanecem texto inerte', () => {
  const decoded = decodeClinicalTextEntities('&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(decoded, '<script>alert(1)</script>');
  const panel = readFileSync(join(process.cwd(), 'src/components/TherapeuticPlanPanel.tsx'), 'utf8');
  const alertDialog = readFileSync(join(process.cwd(), 'src/components/ui/AlertDialog.tsx'), 'utf8');
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(alertDialog, /dangerouslySetInnerHTML/);
});

test('normaliza somente campos clínicos e preserva ids e estados', () => {
  const normalized = normalizeClinicalTextRecord({
    id: 'program&amp;1',
    status: 'TEACHING',
    objective: '&quot;Faça igual&quot;',
    advanced_settings: { antecedent: '&amp;quot;Faça assim&amp;quot;' },
    targets: ['João &amp; Maria', { id: 'target&amp;1', name: '&lt;alvo&gt;' }],
  });
  assert.equal(normalized.id, 'program&amp;1');
  assert.equal(normalized.status, 'TEACHING');
  assert.equal(normalized.objective, '"Faça igual"');
  assert.equal(normalized.advanced_settings.antecedent, '"Faça assim"');
  assert.equal(normalized.targets[0], 'João & Maria');
  assert.equal(normalized.targets[1].id, 'target&amp;1');
  assert.equal(normalized.targets[1].name, '<alvo>');
});

for (const { name, fn } of tests) {
  fn();
  console.log(`[ok] ${name}`);
}

console.log(`[ok] ${tests.length} testes de normalização segura de textos clínicos passaram.`);
