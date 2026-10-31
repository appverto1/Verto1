import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { calculateOwnerDreCosts } from '../src/utils/ownerDreCostCalculator.mjs';

const dashboard = readFileSync('src/components/SuperAdminDashboard.tsx','utf8');
const intelligence = readFileSync('src/components/OwnerDreIntelligence.tsx','utf8');
const readModel = readFileSync('services/ownerDreReadModel.ts','utf8');
const costPanel = readFileSync('src/components/OwnerDreCostsPanel.tsx','utf8');
const invoiceSql = readFileSync('supabase/migrations/20260827153000_platform_financial_ledger_and_subscription_state.sql','utf8');

test('a margem considera receita paga bruta e somente despesas operacionais cadastradas', () => {
  const variable = {cost_type:'variable',category:'operating',amount_cents:0,rate_basis_points:0,
    starts_month:'2026-10-01',ends_month:null};
  // 60 reais variáveis lançados como valor unitário em uma fatura.
  const c=calculateOwnerDreCosts([{...variable,amount_cents:6000}],
    [{clinicId:'test-only',invoiceAmountsCents:[149400]}], '2026-10');
  const gross=149400,operatingCost=c.perClinic.get('test-only').operatingCents;
  assert.equal(gross,149400);
  assert.equal(operatingCost,6000);
  assert.equal(Number(((gross-operatingCost)/gross*100).toFixed(2)),95.98);
  const below=calculateOwnerDreCosts([{...variable,amount_cents:6000,category:'below_ebitda'}],
    [{clinicId:'test-only',invoiceAmountsCents:[149400]}], '2026-10');
  assert.equal(below.perClinic.get('test-only').operatingCents,0);
  assert.equal(below.perClinic.get('test-only').belowEbitdaCents,6000);
});

test('faturas são filtradas por data do pagamento, não pela data em que foram criadas', () => {
  assert.match(readModel,/\.gte\('paid_at',first\+'-01T00:00:00\.000Z'\)/);
  assert.match(readModel,/\.order\('paid_at',\{ascending:true\}\)\.limit\(1000\)/);
  assert.doesNotMatch(readModel,/\.gte\('created_at',first/);
  assert.match(invoiceSql,/idx_platform_billing_invoice_ledger_paid_period[\s\S]*?\(paid_at, organization_id\)/);
  assert.match(readModel,/\.not\('paid_at','is',null\)/);
  assert.match(readModel,/\.gt\('amount_paid_cents',0\)/);
});

test('gráficos comerciais estão exclusivamente na aba de inteligência do Comercial', () => {
  assert.match(dashboard,/commercialView === 'analytics' && <CommercialDashboard \/>/);
  assert.match(dashboard,/onMetrics=\{\(\)=>setCommercialView\('analytics'\)\}/);
  assert.match(dashboard,/aria-label="Abas comerciais"/);
  assert.doesNotMatch(dashboard,/financialView === 'sales'/);
  assert.match(dashboard,/commercialView === 'kanban'/);
});

test('DRE apresenta visão financeira, evolução, planos/clínicas e custos sem novas consultas', () => {
  for(const mode of ['overview','evolution','customers','costs']){
    assert.ok(dashboard.includes('view="' + mode + '"'), 'DRE view missing: ' + mode);
  }
  assert.match(dashboard,/aria-label="Seções do DRE"/);
  assert.match(intelligence,/Demonstrativo de resultados por mês/);
  assert.match(intelligence,/Rentabilidade detalhada por clínica/);
  assert.match(intelligence,/Faturamento detalhado por plano/);
  assert.match(intelligence,/Margens de contribuição e EBITDA/);
  assert.match(intelligence,/Despesas por categoria/);
  assert.match(intelligence,/Resultado após custos/);
  assert.doesNotMatch(intelligence,/\bfetch\(|\bsupabase\.|\baxios\./);
  assert.match(intelligence,/financial\.monthly/);
  assert.match(intelligence,/financial\.byPlan/);
  assert.match(intelligence,/financial\.topCustomers/);
  assert.match(intelligence,/não representa dinheiro disponível/);
});

test('Salvar custo mantém autoridade da persistência e atualização sem F5', () => {
  assert.match(dashboard,/OwnerDreCostsPanel rules=\{financial\.costRules\|\|\[\]\} onChanged=\{refreshOwnerDre\}/);
  assert.match(costPanel,/type="submit"/);
  assert.match(costPanel,/await request\(editing\?/);
  assert.match(costPanel,/await onChanged\(\)/);
  assert.match(costPanel,/setNotice\('Custo salvo\. DRE e gráficos atualizados sem F5\.'\)/);
  assert.match(intelligence,/custos efetivamente cadastrados/);
});

console.log('ownerDreFinancialIntelligence.regression: PASS');
