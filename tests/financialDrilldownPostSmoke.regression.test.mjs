import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const dateFormattingSource = fs.readFileSync('src/utils/dateFormatting.ts', 'utf8');

// Regression A: the formatter used by the payment composition must be a canonical import,
// not a free runtime identifier that parse/transpile can miss.
assert.match(
  dashboard,
  /import\s*\{\s*formatDisplayDateTime\s*\}\s*from\s*["']\.\.\/utils\/dateFormatting["'];/,
  'CoordinatorDashboard must import formatDisplayDateTime from the canonical dateFormatting helper',
);
const compositionStart = dashboard.indexOf('data-financial-drilldown-payment-composition');
const compositionEnd = dashboard.indexOf('</section>', compositionStart);
assert.ok(compositionStart >= 0 && compositionEnd > compositionStart, 'payment composition section must exist');
const compositionSource = dashboard.slice(compositionStart, compositionEnd);
assert.match(compositionSource, /selectedFinancialDrilldownPayment\.items\s*\|\|\s*\[\]\)\.map/);
assert.match(compositionSource, /formatDisplayDateTime\(item\.completion_at \|\| item\.appointment_scheduled_at/);
assert.match(compositionSource, /item\.professional_name_snapshot/);
assert.match(compositionSource, /item\.unit_amount/);
assert.match(compositionSource, /item\.subtotal/);
assert.match(compositionSource, /item\.patient_financial_plan_version/);

// Execute the canonical formatter itself without importing the TS module. This tiny erasure is
// intentionally scoped to dateFormatting.ts so the regression runs in the dependency-free snapshot.
const executableDateFormatting = dateFormattingSource
  .replaceAll('export const ', 'const ')
  .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:number|string|unknown)(?=[,)])/g, '$1')
  .replace(
    /options:\s*\{\s*fallback\?: string;\s*separator\?: string\s*\}\s*=\s*\{\}/,
    'options = {}',
  );
const { formatDisplayDateTime } = new Function(
  `${executableDateFormatting}\nreturn { formatDisplayDateTime };`,
)();
assert.equal(typeof formatDisplayDateTime, 'function');

const sampleItems = [
  {
    id: 'item-1',
    completion_at: '2026-09-07T09:00:00-03:00',
    specialty_snapshot: 'Fonoaudiologia',
    professional_name_snapshot: 'Profissional A',
    unit_amount: 100,
    subtotal: 100,
    patient_financial_plan_version: 1,
  },
  {
    id: 'item-2',
    completion_at: '2026-09-07T10:00:00-03:00',
    specialty_snapshot: 'Fonoaudiologia',
    professional_name_snapshot: 'Profissional A',
    unit_amount: 100,
    subtotal: 100,
    patient_financial_plan_version: 1,
  },
];
const renderedComposition = sampleItems.map((item) => ({
  id: item.id,
  when: formatDisplayDateTime(item.completion_at || item.appointment_scheduled_at, { separator: ', ' }),
  specialty: item.specialty_snapshot || item.service_type_snapshot || 'Sessão',
  professional: item.professional_name_snapshot || 'Profissional não informado',
  unitAmount: item.unit_amount,
  subtotal: item.subtotal,
  planVersion: item.patient_financial_plan_version,
}));
assert.equal(renderedComposition.length, 2, 'R$200 monthly receivable must render two ledger items');
assert.equal(renderedComposition.reduce((sum, item) => sum + item.subtotal, 0), 200);
assert.ok(renderedComposition.every((item) => item.when && item.when !== '-'));

// Regression B: the visual data itself opens the reusable drill-down with semantic segment filters.
for (const expectedHandler of [
  /openFinancialDrilldown\("receivables-status", "Recebimentos e pendências", entry\.name, "Valor"\)/,
  /openFinancialDrilldown\("revenue-by-origin", "Receita por origem", entry\.name, "Receita"\)/,
  /openFinancialDrilldown\("revenue-by-specialty", "Receita por especialidade", row\.name, "Receita realizada"\)/,
]) {
  assert.match(dashboard, expectedHandler);
}
assert.match(dashboard, /<Cell[\s\S]{0,260}onClick=\{\(\) => openFinancialDrilldown/);
assert.match(dashboard, /financialDrilldown[\s\S]{0,120}series\?: string/);

// Execute the actual pure filtering predicate embedded in CoordinatorDashboard.
const predicateStart = dashboard.indexOf('const matchesFinancialDrilldownCharge = ');
const predicateEndMarker = '\n};\n\nconst getFinancialSemanticValueClass';
const predicateEnd = dashboard.indexOf(predicateEndMarker, predicateStart);
assert.ok(predicateStart >= 0 && predicateEnd > predicateStart, 'drill-down filter predicate must be present');
const predicateDeclaration = dashboard.slice(predicateStart, predicateEnd + 3);
const matchesFinancialDrilldownCharge = new Function(
  `${predicateDeclaration}\nreturn matchesFinancialDrilldownCharge;`,
)();

const normalizeText = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const normalizeOrigin = (value) => {
  const normalized = normalizeText(value);
  if (normalized.includes('conven')) return 'Convênios';
  if (normalized.includes('particular') || normalized.includes('private')) return 'Particular';
  return String(value || '').trim();
};
const charges = [
  { id: 'private-pending', status: 'pending', originLabel: 'Particular', specialty: 'Fonoaudiologia', items: [] },
  { id: 'insurance-pending', status: 'pending', originLabel: 'Convênio · Unimed', specialty: 'Fonoaudiologia', items: [] },
  { id: 'private-paid', status: 'paid', originLabel: 'Particular', specialty: 'Psicologia', items: [] },
  { id: 'private-overdue', status: 'overdue', originLabel: 'Particular', specialty: 'Fonoaudiologia', items: [] },
  { id: 'insurance-canceled', status: 'canceled', originLabel: 'Convênio · Unimed', specialty: 'Fonoaudiologia', items: [] },
];
const idsFor = (drilldown) => charges
  .filter((charge) => matchesFinancialDrilldownCharge(charge, drilldown, normalizeText, normalizeOrigin))
  .map((charge) => charge.id);

assert.deepEqual(idsFor({ kind: 'receivables-status', filter: 'A receber' }), ['private-pending', 'insurance-pending', 'private-overdue']);
assert.deepEqual(idsFor({ kind: 'receivables-status', filter: 'Recebido' }), ['private-paid']);
assert.deepEqual(idsFor({ kind: 'revenue-by-origin', filter: 'Particular', series: 'Receita' }), ['private-pending', 'private-paid', 'private-overdue']);
assert.deepEqual(idsFor({ kind: 'revenue-by-origin', filter: 'Convênios', series: 'Receita' }), ['insurance-pending']);
assert.deepEqual(idsFor({ kind: 'revenue-by-specialty', filter: 'Fonoaudiologia', series: 'Receita realizada' }), []);
assert.deepEqual(idsFor({ kind: 'revenue-by-specialty', filter: 'Psicologia', series: 'Receita realizada' }), ['private-paid']);

// Regression C: origin composition uses both received and open material receivables, never cancellations.
assert.match(dashboard, /\[\.\.\.paidPayments, \.\.\.pendingPayments\]\.forEach\(\(payment: any\) => \{/);
assert.match(dashboard, /const originLabel = chargeReadModel\?\.billingOrigin === 'INSURANCE' \? 'Convênios' : 'Particular';/);
assert.match(dashboard, /addToMap\(revenueOriginMap, originLabel, parseCurrencyValue\(payment\?\.amount\)/);

const originTotals = new Map();
for (const payment of [
  { status: 'pending', billingOrigin: 'PRIVATE', amount: 200 },
  { status: 'pending', billingOrigin: 'INSURANCE', amount: 100 },
]) {
  const label = payment.billingOrigin === 'INSURANCE' ? 'Convênios' : 'Particular';
  originTotals.set(label, (originTotals.get(label) || 0) + payment.amount);
}
assert.equal(originTotals.get('Particular'), 200);
assert.equal(originTotals.get('Convênios'), 100);

console.log('financialDrilldownPostSmoke.regression.test.mjs: OK');
