import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildFinancialSpecialtySeriesRow,
  normalizeFinancialSpecialtyLabel,
} from '../src/utils/clinicFinanceReadModel.ts';

const dashboard = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');

const positive = buildFinancialSpecialtySeriesRow({
  name: 'Fonoaudiologia',
  revenue: 4000,
  professionalTransfers: 1800,
  allocatedExpenses: 300,
});
assert.equal(positive.Receita, 4000);
assert.equal(positive.Repasses, -1800);
assert.equal(positive['Despesas alocadas'], -300);
assert.equal(positive.Resultado, 1900);
assert.equal(positive['Margem %'], 47.5);

const loss = buildFinancialSpecialtySeriesRow({
  name: 'Fonoaudiologia',
  revenue: 1000,
  professionalTransfers: 1200,
  allocatedExpenses: 300,
});
assert.equal(loss.Resultado, -500, 'loss must remain mathematically negative');

assert.equal(normalizeFinancialSpecialtyLabel('Fonoaudiologia'), 'Fonoaudiologia');
assert.equal(normalizeFinancialSpecialtyLabel('fono'), 'Fonoaudiologia');
assert.equal(normalizeFinancialSpecialtyLabel('ABA'), 'ABA');
assert.equal(normalizeFinancialSpecialtyLabel('Psicoterapeuta'), null, 'professional title must not become an artificial financial specialty');
assert.equal(normalizeFinancialSpecialtyLabel('Cargo administrativo'), null);

// No proportional allocation of general clinic expenses is allowed.
assert.doesNotMatch(dashboard, /operationalExpenses\s*\*\s*\(basis\s*\/\s*specialtyBasisTotal\)/);
assert.match(dashboard, /paidOperationalExpenseEntries\.forEach/);
assert.match(dashboard, /normalizeFinancialSpecialtyLabel\(entry\?\.specialty\) \|\| "Não alocado"/);

// Professional profile/title is no longer a fallback for specialty allocation.
const paidTransfersStart = dashboard.indexOf('paidProfessionalPayments.forEach');
const paidTransfersEnd = dashboard.indexOf('paidOperationalExpenseEntries.forEach', paidTransfersStart);
assert.ok(paidTransfersStart >= 0 && paidTransfersEnd > paidTransfersStart);
const paidTransfersBlock = dashboard.slice(paidTransfersStart, paidTransfersEnd);
assert.match(paidTransfersBlock, /normalizeFinancialSpecialtyLabel\(payment\?\.specialty\) \|\| "Não alocado"/);
assert.doesNotMatch(paidTransfersBlock, /therapistMembersById|professionalSpecialties|professionalSpecialty/);

// Dataset and visual share the same economic sign semantics.
assert.match(dashboard, /buildFinancialSpecialtySeriesRow/);
assert.match(dashboard, /dataKey="Repasses"/);
assert.match(dashboard, /dataKey="Despesas alocadas"/);
assert.match(dashboard, /dataKey="Resultado"/);
assert.match(dashboard, /fill=\{Number\(row\.Resultado\) < 0 \? "#ef4444" : "#22c55e"\}/);
assert.doesNotMatch(dashboard, /dataKey="Lucro estimado"/);

// Approved drill-down remains and now explains cost formers with the same signs.
assert.match(dashboard, /data-financial-drilldown-professional-transfers/);
assert.match(dashboard, /data-financial-drilldown-operational-expenses/);
assert.match(dashboard, /formatCurrency\(-parseCurrencyValue\(payment\?\.amount\)\)/);
assert.match(dashboard, /formatCurrency\(-clinicExpenseActualAmount\(entry\)\)/);

console.log('financialSpecialtySemantics.regression.test: PASS');
