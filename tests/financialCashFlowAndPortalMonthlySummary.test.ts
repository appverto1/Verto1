import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const dashboard=readFileSync(new URL('../src/components/CoordinatorDashboard.tsx',import.meta.url),'utf8');
const portal=readFileSync(new URL('../src/components/PatientDashboard.tsx',import.meta.url),'utf8');
const service=readFileSync(new URL('../src/services/dataService.ts',import.meta.url),'utf8');

test('financial dashboard surfaces cash flow without adding queries or confusing forecast and cash',()=>{
  assert.match(dashboard,/data-financial-cashflow-summary/);
  assert.match(dashboard,/navigateToTab\("financial", financialIntent\("Fluxo de caixa"\)\)/);
  assert.match(dashboard,/Somente movimentações registradas como pagas/);
  const start=dashboard.indexOf('const financialCashFlowRows = useMemo(');
  const rows=dashboard.slice(start,start+600);
  assert.ok(start>0);
  assert.match(rows,/"Entradas": financialDashboard\.cashIn/);
  assert.match(rows,/"Repasses": -financialDashboard\.professionalPaid/);
  assert.match(rows,/"Despesas": -financialDashboard\.cashOperationalExpenses/);
  assert.match(rows,/"Saldo líquido": financialDashboard\.cashFlow/);
  assert.doesNotMatch(rows,/revenueRows\.map/,'incomplete historical months must not appear as precise cash flow');
  assert.match(dashboard,/data-financial-cashflow-view/,'existing financial navigation retained');
});

test('patient sees monthly actual time and verified private invoice, never computed hourly charge',()=>{
  assert.match(portal,/data-patient-monthly-session-summary/);
  assert.match(portal,/Tempo efetivamente registrado/);
  assert.match(portal,/Sessões futuras agendadas/);
  assert.match(portal,/Previsão de cobrança particular registrada/);
  assert.match(portal,/portalMonthlySummary\.billing\?\.needsReview/);
  assert.match(portal,/portalMonthlySummary\.withoutActualMinutes/);
  assert.match(portal,/result\.monthlySummary\?\.patientId === portalPatientId/);
  assert.match(portal,/portalHasModule\('financial_management'\)/);
  assert.match(service,/includeMonthlySummary: options\.includeMonthlySummary \? '1' : undefined/);
});
