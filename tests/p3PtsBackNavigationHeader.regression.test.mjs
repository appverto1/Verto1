import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');
const header = dashboard.slice(
  dashboard.indexOf('<header className={`rounded-3xl border p-5 sm:p-6 ${surface}`}>'),
  dashboard.indexOf('</header>', dashboard.indexOf('data-testid="pts-therapeutic-dashboard"')),
);

assert.ok(header.startsWith('<header'), 'cabeçalho do PTS deve continuar presente');
assert.match(header, /<ChevronLeft size=\{16\} aria-hidden="true" \/> Voltar aos planos/);
assert.match(header, /data-testid="pts-back-to-plans"/);
assert.match(header, /\{canManagePlans && \([\s\S]*?onClick=\{onManagePlans\}/);
assert.equal((header.match(/onClick=\{onManagePlans\}/g) || []).length, 1,
  'retorno não pode ficar duplicado em ações clínicas');
const back = header.indexOf('data-testid="pts-back-to-plans"');
const title = header.indexOf('Projeto Terapêutico Singular');
const actions = header.indexOf('aria-label="Ações do PTS"');
assert.ok(back > 0 && title > back && actions > title,
  'navegação deve estar à esquerda acima do título; ações clínicas à direita');
const clinicalActions = header.slice(actions);
assert.doesNotMatch(clinicalActions, /Voltar aos planos|onManagePlans/);
for (const action of ['onRecordReview', 'onRecordRisk', 'onNewVersion']) {
  assert.match(clinicalActions, new RegExp(action),
    `ação clínica ${action} não deve ser removida`);
}
assert.match(header, /\{canManagePlans && \(/,
  'permissão existente deve continuar controlando o retorno');
console.log('P3-16: navegação à esquerda, ações clínicas à direita e permissão preservadas.');
