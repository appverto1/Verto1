import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const workspace = fs.readFileSync('src/components/PatientFinanceWorkspace.tsx', 'utf8');
const ledgerUtil = fs.readFileSync('src/utils/patientFinancialLedger.ts', 'utf8');

// Finance is a canonical patient-list hydration surface, so cold-load does not depend on visiting Patients first.
assert.match(dashboard, /patientListSurfaceVisible\s*=\s*activeTab === "patients"[\s\S]{0,180}activeTab === "financial"/);
assert.match(dashboard, /onEnsurePatientList\(\)/);
assert.match(dashboard, /Carregando Financeiro/);
assert.match(dashboard, /financialSurfaceLoading[\s\S]{0,500}financialSurfaceError/);
assert.match(dashboard, /className=\{financialSurfaceLoading \|\| financialSurfaceError \? "hidden" : "contents"\}/);

// Dashboard reads the auditable patient ledger, and the workspace reuses the same loaded object instead of a second normal request.
assert.match(dashboard, /dataService\.getPatientFinanceLedger\(financialMonth\)/);
assert.match(dashboard, /preloadedLedger=\{patientFinanceLedger\}/);
assert.match(dashboard, /preloadedLedgerLoading=\{patientFinanceLedgerLoading\}/);
assert.match(dashboard, /preloadedLedgerError=\{patientFinanceLedgerError\}/);
assert.match(workspace, /const usesPreloadedLedger = typeof preloadedLedgerLoading === 'boolean'/);
assert.match(workspace, /if \(usesPreloadedLedger\)[\s\S]{0,700}return;/);

// Stage-2 payment item snapshots are enriched in one tenant-scoped batch, never one query per card/item.
const ledgerRouteStart = server.indexOf("app.get('/api/patient-finance/ledger'");
const ledgerRouteEnd = server.indexOf("app.post('/api/patient-finance/charges'", ledgerRouteStart);
assert.ok(ledgerRouteStart >= 0 && ledgerRouteEnd > ledgerRouteStart, 'patient finance ledger route must exist');
const ledgerRoute = server.slice(ledgerRouteStart, ledgerRouteEnd);
const enrichmentStart = ledgerRoute.indexOf('const readLedgerItemSnapshots');
const enrichmentEnd = ledgerRoute.indexOf('const [relatedResult', enrichmentStart);
assert.ok(enrichmentStart >= 0 && enrichmentEnd > enrichmentStart, 'ledger must contain the single item enrichment batch');
const enrichment = ledgerRoute.slice(enrichmentStart, enrichmentEnd);
assert.match(enrichment, /\.from\('payment_appointment_items'\)/);
assert.match(enrichment, /\.eq\('organization_id', organizationId\)/);
assert.match(enrichment, /\.in\('payment_id', visibleChargeIds\)/);
for (const field of [
  'patient_financial_plan_id', 'patient_financial_plan_logical_id', 'patient_financial_plan_version',
  'payer_id_snapshot', 'payer_name_snapshot', 'competence_month', 'completion_at',
  'professional_name_snapshot', 'service_type_snapshot', 'specialty_snapshot', 'unit_amount', 'subtotal',
]) assert.match(enrichment, new RegExp(field));
assert.equal((enrichment.match(/\.from\('payment_appointment_items'\)/g) || []).length, 1, 'enrichment must remain one batch query');

// Monthly-session presentation and detail are sourced from payments + frozen ledger items.
assert.match(workspace, /Mensal por sessões/);
assert.match(workspace, /charge\.originLabel/);
assert.match(workspace, /payer_name_snapshot/);
assert.match(workspace, /patient_financial_plan_version/);
assert.match(workspace, /item\.completion_at \|\| item\.appointment_scheduled_at/);
assert.match(ledgerUtil, /billingOrigin:\s*payerName \? 'INSURANCE' : 'PRIVATE'/);
assert.match(ledgerUtil, /originLabel:\s*payerName \? `Convênio · \${payerName}` : 'Particular'/);
assert.match(ledgerUtil, /isMonthlySession/);
assert.match(ledgerUtil, /\bitems,\n/);

// Dashboard allocation and drill-down consume ledger snapshots, not the current plan, for realized receivables.
assert.match(dashboard, /ledgerItemsByPaymentId/);
assert.match(dashboard, /item\?\.subtotal/);
assert.match(dashboard, /data-financial-drilldown-trigger/);
assert.match(dashboard, /data-financial-drilldown-payments/);
assert.match(dashboard, /data-financial-drilldown-payment-composition/);
assert.match(dashboard, /Planos fixos formadores da projeção/);
assert.match(dashboard, /Referências projetadas; não são pagamentos/);
assert.match(dashboard, /Receita[\s\S]{0,200}Repasses[\s\S]{0,200}Despesas alocadas[\s\S]{0,200}Lucro estimado/);

// Open material due dates include monthly-session aggregate payments, and the empty state is model-neutral.
assert.match(dashboard, /MONTHLY_SESSION_AGGREGATE/);
assert.match(dashboard, /payment\?\.due_date \|\| payment\?\.dueDate/);
assert.match(dashboard, /Nenhum vencimento financeiro encontrado no período\./);
assert.doesNotMatch(dashboard, /Cadastre mensalidades no paciente para ver vencimentos\./);

// Finance drill-down must not introduce TISS calls; INSURANCE stays a payer/billing origin concern here.
const drilldownStart = dashboard.indexOf('data-financial-drilldown-panel');
const drilldownEnd = dashboard.indexOf('{activeTab === "flow"', drilldownStart);
const drilldown = dashboard.slice(drilldownStart, drilldownEnd);
assert.doesNotMatch(drilldown, /TISS|tiss|insurance_tiss|getPatientTiss|payerTiss/i);

console.log('financialAuditabilityColdLoad.regression.test.mjs: OK');
