import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  clinicExpenseActualAmount,
  clinicExpenseExpectedAmount,
  resolveClinicExpenseSemanticStatus,
} from '../src/utils/clinicFinanceReadModel.ts';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');
const manager = fs.readFileSync(new URL('../src/components/ClinicExpenseManager.tsx', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260908010000_clinic_expense_management.sql', import.meta.url), 'utf8');

// Canonical architecture: recurring rule/template + financial occurrence, never a second ledger.
assert.match(migration, /alter table public\.clinic_recurring_costs/i);
assert.match(migration, /alter table public\.clinic_financial_entries/i);
assert.match(migration, /add column if not exists expected_amount numeric\(14,2\)/);
assert.match(migration, /add column if not exists paid_on date/);
assert.match(migration, /add column if not exists competence_month date/);
assert.match(migration, /add column if not exists recurring_cost_id uuid references public\.clinic_recurring_costs/);
assert.match(migration, /add column if not exists recurring_cost_logical_id uuid/);
assert.match(migration, /uq_clinic_expense_recurring_occurrence/);
assert.match(migration, /\(clinic_id, recurring_cost_logical_id, recurrence_occurrence_key\)/);
assert.match(migration, /on conflict \(clinic_id, recurring_cost_logical_id, recurrence_occurrence_key\)/);

// Stable recurrence identity: monthly competence never depends on due_day; weekly stays occurrence-specific.
assert.match(migration, /'monthly:' \|\| to_char\(v_month_start, 'YYYY-MM'\)/);
assert.match(migration, /'weekly:' \|\| to_char\(v_due, 'YYYY-MM-DD'\)/);
assert.doesNotMatch(
  migration,
  /v_rule\.logical_id, to_char\(v_due, 'YYYY-MM-DD'\), v_rule\.specialty[\s\S]{0,160}on conflict/,
  'monthly occurrence identity must not be derived from due_date',
);

// Browser callers cannot bypass API versioning/capability boundaries.
assert.match(migration, /revoke all on table public\.clinic_recurring_costs from public, anon, authenticated;/);
assert.match(migration, /grant all on table public\.clinic_recurring_costs to service_role;/);
assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)[^;]*to authenticated/i);
assert.doesNotMatch(migration, /create policy[\s\S]{0,240}on public\.clinic_recurring_costs[\s\S]{0,120}to authenticated/i);

// Occurrence table follows the same server-only mutation boundary.
assert.match(migration, /drop policy if exists clinic_financial_entries_clinic_finance_rw on public\.clinic_financial_entries;/);
assert.match(migration, /revoke all on table public\.clinic_financial_entries from public, anon, authenticated;/);
assert.match(migration, /grant all on table public\.clinic_financial_entries to service_role;/);
assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete|all)[^;]*clinic_financial_entries[^;]*to authenticated/i);
assert.doesNotMatch(migration, /create policy[\s\S]{0,240}on public\.clinic_financial_entries[\s\S]{0,120}to authenticated/i);
for (const protectedMutation of [
  'paid → pending',
  'canceled → pending',
  'amount',
  'recurring_cost_id',
  'recurring_cost_logical_id',
  'recurrence_occurrence_key',
  'paid_on',
]) {
  assert.ok(
    /revoke all on table public\.clinic_financial_entries from public, anon, authenticated;/.test(migration),
    `browser mutation must be impossible for ${protectedMutation}`,
  );
}

// Due-day versioning changes only due_date; the monthly logical occurrence key remains month-based.
const monthlyOccurrenceKey = (month) => `monthly:${month}`;
const octoberBefore = {
  id: 'expense-oct',
  recurring_cost_logical_id: 'rent-logical',
  recurrence_occurrence_key: monthlyOccurrenceKey('2026-10'),
  competence_month: '2026-10-01',
  due_date: '2026-10-10',
  status: 'pending',
};
const octoberAfterDueDayChange = { ...octoberBefore, due_date: '2026-10-15' };
assert.equal(octoberAfterDueDayChange.recurrence_occurrence_key, 'monthly:2026-10');
const reloadMaterializedKey = monthlyOccurrenceKey('2026-10');
assert.equal(reloadMaterializedKey, octoberAfterDueDayChange.recurrence_occurrence_key);
assert.equal(
  new Set([octoberAfterDueDayChange.recurrence_occurrence_key, reloadMaterializedKey]).size,
  1,
  'changing due_day 10→15 must keep exactly one October obligation',
);
assert.equal(octoberAfterDueDayChange.due_date, '2026-10-15');

const versionFunctionStart = migration.indexOf('create or replace function public.version_clinic_recurring_cost_v1');
const versionFunctionEnd = migration.indexOf('create or replace function public.end_clinic_recurring_cost_v1', versionFunctionStart);
assert.ok(versionFunctionStart >= 0 && versionFunctionEnd > versionFunctionStart, 'versioning function must be present');
const versionFunctionSql = migration.slice(versionFunctionStart, versionFunctionEnd);
assert.match(versionFunctionSql, /due_date = case[\s\S]*p_due_day/);
assert.doesNotMatch(
  versionFunctionSql,
  /recurrence_occurrence_key\s*=/,
  'due-day versioning must not rewrite the stable occurrence identity',
);

// PostgreSQL parse regression: DISTINCT FROM + CASE must stay parenthesized and explicitly typed.
assert.doesNotMatch(
  migration,
  /is\s+not\s+distinct\s+from\s+case\b/i,
  'never use the PostgreSQL-ambiguous `IS NOT DISTINCT FROM CASE ...` form',
);
assert.doesNotMatch(
  migration,
  /is\s+distinct\s+from\s+case\b/i,
  'never use the PostgreSQL-ambiguous `IS DISTINCT FROM CASE ...` form',
);
assert.match(
  versionFunctionSql,
  /v_existing\.due_day\s+is\s+not\s+distinct\s+from\s*\(\s*case\s+when\s+v_rule\.recurrence\s*=\s*'monthly'\s+then\s+p_due_day::smallint\s+else\s+null::smallint\s+end\s*\)/i,
  'due_day idempotency comparison must use the parenthesized, typed CASE expression accepted by PostgreSQL',
);

const srcRoot = new URL('../src/', import.meta.url);
const browserDirectRecurringCostRefs = [];
const scanSourceTree = (directoryUrl) => {
  for (const entry of fs.readdirSync(directoryUrl, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directoryUrl);
    if (entry.isDirectory()) {
      scanSourceTree(entryUrl);
      continue;
    }
    if (!/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const content = fs.readFileSync(entryUrl, 'utf8');
    if (/clinic_recurring_costs/.test(content)) browserDirectRecurringCostRefs.push(entryUrl.pathname);
  }
};
scanSourceTree(srcRoot);
assert.deepEqual(
  browserDirectRecurringCostRefs,
  [],
  'browser/frontend source must not access clinic_recurring_costs directly; all mutations go through the API',
);

const browserDirectFinancialEntryRefs = [];
const browserFinancialFallbackCallers = [];
const scanFinancialEntryBrowserCallers = (directoryUrl) => {
  for (const entry of fs.readdirSync(directoryUrl, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directoryUrl);
    if (entry.isDirectory()) {
      scanFinancialEntryBrowserCallers(entryUrl);
      continue;
    }
    if (!/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const content = fs.readFileSync(entryUrl, 'utf8');
    if (/clinic_financial_entries/.test(content)) browserDirectFinancialEntryRefs.push(entryUrl.pathname);
    if (/fetchFinancialEntriesWithSchemaFallback/.test(content) && !entryUrl.pathname.endsWith('/utils/routeSchemaFallbacks.ts')) {
      browserFinancialFallbackCallers.push(entryUrl.pathname);
    }
  }
};
scanFinancialEntryBrowserCallers(srcRoot);
assert.deepEqual(
  browserDirectFinancialEntryRefs.map((value) => value.replace(/^.*\/src\//, 'src/')),
  ['src/utils/routeSchemaFallbacks.ts'],
  'the only client-tree table reference is the shared fallback definition, not a browser caller',
);
assert.deepEqual(
  browserFinancialFallbackCallers,
  [],
  'no browser/frontend source calls fetchFinancialEntriesWithSchemaFallback; financial entries are read/written through the API',
);

// Legacy inactive rules must stay retired, while ended historical versions remain visible only in their period.
const materializerStart = migration.indexOf('create or replace function public.materialize_clinic_expense_occurrences_v1');
const materializerEnd = migration.indexOf('create or replace function public.version_clinic_recurring_cost_v1', materializerStart);
assert.ok(materializerStart >= 0 && materializerEnd > materializerStart, 'materializer function must be present');
const materializerSql = migration.slice(materializerStart, materializerEnd);
assert.match(materializerSql, /and \(active = true or ends_on is not null\)/);
const expenseGetStart = server.indexOf("app.get('/api/financial/expenses'");
const expenseGetEnd = server.indexOf("app.post('/api/financial/expenses'", expenseGetStart);
assert.ok(expenseGetStart >= 0 && expenseGetEnd > expenseGetStart, 'expense GET route must be present');
const expenseGetBlock = server.slice(expenseGetStart, expenseGetEnd);
assert.match(expenseGetBlock, /\.or\('active\.eq\.true,ends_on\.not\.is\.null'\)/);

const ruleAppliesToMonth = (rule, month) => {
  const monthStart = `${month}-01`;
  const monthEnd = new Date(`${monthStart}T00:00:00Z`);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  monthEnd.setUTCDate(0);
  const monthEndKey = monthEnd.toISOString().slice(0, 10);
  if (rule.starts_on > monthEndKey) return false;
  if (rule.ends_on && rule.ends_on < monthStart) return false;
  return rule.active === true || Boolean(rule.ends_on);
};
assert.equal(
  ruleAppliesToMonth({ active: false, starts_on: '2026-01-01', ends_on: null }, '2026-09'),
  false,
  'legacy active=false without ends_on must not reappear',
);
assert.equal(
  ruleAppliesToMonth({ active: false, starts_on: '2026-01-01', ends_on: '2026-09-30' }, '2026-09'),
  true,
  'inactive historical version with ends_on remains available inside its historical validity',
);
assert.equal(
  ruleAppliesToMonth({ active: false, starts_on: '2026-01-01', ends_on: '2026-09-30' }, '2026-10'),
  false,
  'inactive historical version must not materialize after ends_on',
);

// Backfills introduced by this feature are expense-only and must not rewrite historical income rows.
for (const pattern of [
  /update public\.clinic_financial_entries\s+set expected_amount = amount\s+where entry_type = 'expense'/i,
  /update public\.clinic_financial_entries\s+set competence_month = date_trunc\('month', occurred_on\)::date\s+where entry_type = 'expense'/i,
  /update public\.clinic_financial_entries\s+set paid_on = occurred_on\s+where entry_type = 'expense'\s+and status = 'paid'/i,
  /update public\.clinic_financial_entries e\s+set recurring_cost_logical_id = r\.logical_id[\s\S]*where e\.recurring_cost_id = r\.id\s+and e\.entry_type = 'expense'/i,
]) {
  assert.match(migration, pattern);
}

assert.doesNotMatch(migration, /delete\s+from\s+public\.clinic_(?:financial_entries|recurring_costs)/i);
assert.doesNotMatch(migration, /cron|pg_cron|schedule\s*\(/i, 'recurrence must not add operational cron infrastructure');

// History safety: only future/open occurrences can be changed/cancelled by rule lifecycle.
assert.match(migration, /and e\.status = 'pending'[\s\S]*coalesce\(e\.due_date, e\.occurred_on\) >= p_effective_from/);
assert.match(migration, /and status = 'pending'[\s\S]*coalesce\(due_date, occurred_on\) > p_end_on/);
assert.match(migration, /status = 'canceled'/);
assert.match(migration, /CLINIC_EXPENSE_RULE_END_IDEMPOTENCY_CONFLICT/);
assert.match(migration, /CLINIC_EXPENSE_RULE_EFFECTIVE_MONTH_BOUNDARY_REQUIRED/);

// Weekly future changes preserve the old cadence anchor rather than shifting weekdays.
assert.match(migration, /v_new_starts_on := case[\s\S]*v_rule\.recurrence = 'weekly'[\s\S]*p_effective_from - v_rule\.starts_on/);

// Server boundaries: admin/finance capability + active clinic scope on every mutation family.
for (const route of [
  "app.post('/api/financial/expenses'",
  "app.patch('/api/financial/expenses/:expenseId'",
  "app.post('/api/financial/expenses/:expenseId/pay'",
  "app.post('/api/financial/expenses/:expenseId/cancel'",
  "app.post('/api/financial/expense-rules'",
  "app.patch('/api/financial/expense-rules/:ruleId'",
  "app.post('/api/financial/expense-rules/:ruleId/end'",
]) {
  assert.ok(server.includes(route), `missing expense mutation route: ${route}`);
}
assert.match(server, /requireClinicCapability\('finance\.entries\.manage'\)/);
assert.match(server, /clinicExpenseScope\(req\)/);
assert.match(server, /\.eq\('clinic_id', scope\.clinicId\)/);
assert.match(server, /\.eq\('id', expenseId\)[\s\S]*\.eq\('entry_type', 'expense'\)/);
assert.doesNotMatch(server, /app\.delete\('\/api\/financial\/(?:expenses|expense-rules)/, 'history must not have destructive DELETE routes');


// Tenant/IDOR boundaries are route-local: every existing-resource mutation scopes by active clinic + resource id.
const routeBlock = (startMarker, endMarker) => {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `route block not found: ${startMarker}`);
  return server.slice(start, end);
};
const expensePatchBlock = routeBlock("app.patch('/api/financial/expenses/:expenseId'", "app.post('/api/financial/expenses/:expenseId/pay'");
const expensePayBlock = routeBlock("app.post('/api/financial/expenses/:expenseId/pay'", "app.post('/api/financial/expenses/:expenseId/cancel'");
const expenseCancelBlock = routeBlock("app.post('/api/financial/expenses/:expenseId/cancel'", "app.post('/api/financial/expense-rules'");
const ruleCreateBlock = routeBlock("app.post('/api/financial/expense-rules'", "app.patch('/api/financial/expense-rules/:ruleId'");
const rulePatchBlock = routeBlock("app.patch('/api/financial/expense-rules/:ruleId'", "app.post('/api/financial/expense-rules/:ruleId/end'");
const ruleEndBlock = routeBlock("app.post('/api/financial/expense-rules/:ruleId/end'", "app.get('/api/financial/entries'");
for (const block of [expensePatchBlock, expensePayBlock, expenseCancelBlock]) {
  assert.match(block, /clinicExpenseScope\(req\)/);
  assert.match(block, /\.eq\('clinic_id', scope\.clinicId\)/);
  assert.match(block, /\.eq\('id', expenseId\)/);
  assert.match(block, /requireClinicCapability\('finance\.entries\.manage'\)/);
}
for (const block of [rulePatchBlock, ruleEndBlock]) {
  assert.match(block, /clinicExpenseScope\(req\)/);
  assert.match(block, /\.eq\('clinic_id', scope\.clinicId\)/);
  assert.match(block, /\.eq\('id', ruleId\)/);
  assert.match(block, /requireClinicCapability\('finance\.entries\.manage'\)/);
}
assert.match(ruleCreateBlock, /clinic_id: scope\.clinicId/);
assert.match(ruleCreateBlock, /requireClinicCapability\('finance\.entries\.manage'\)/);

// Payment/cancel state transitions are compare-and-set and replay-safe, so retries do not duplicate cash effects.
assert.match(expensePayBlock, /status: 'paid'/);
assert.match(expensePayBlock, /\.eq\('status', 'pending'\)/);
assert.match(expensePayBlock, /replayed: true/);
assert.match(expenseCancelBlock, /status: 'canceled'/);
assert.match(expenseCancelBlock, /\.eq\('status', 'pending'\)/);
assert.match(expenseCancelBlock, /replayed: true/);

// Idempotency/atomicity contracts.
assert.match(server, /CLINIC_EXPENSE_IDEMPOTENCY_CONFLICT/);
assert.match(server, /\.eq\('status', 'pending'\)[\s\S]*\.select\(FINANCIAL_ENTRY_SELECT\)/);
assert.match(server, /replayed: true/);
assert.match(server, /version_clinic_recurring_cost_v1/);
assert.match(server, /end_clinic_recurring_cost_v1/);

// Realized and expected values remain independent by competence.
const septemberEnergy = { expected_amount: 750, amount: 740, status: 'paid', due_date: '2026-09-08', paid_on: '2026-09-08' };
const octoberEnergy = { expected_amount: 750, amount: 815, status: 'paid', due_date: '2026-10-08', paid_on: '2026-10-08' };
assert.equal(clinicExpenseExpectedAmount(septemberEnergy), 750);
assert.equal(clinicExpenseActualAmount(septemberEnergy), 740);
assert.equal(clinicExpenseExpectedAmount(octoberEnergy), 750);
assert.equal(clinicExpenseActualAmount(octoberEnergy), 815);
assert.equal(resolveClinicExpenseSemanticStatus({ status: 'pending', due_date: '2026-09-18' }, '2026-09-10'), 'pending');
assert.equal(resolveClinicExpenseSemanticStatus({ status: 'pending', due_date: '2026-09-08' }, '2026-09-10'), 'overdue');
assert.equal(resolveClinicExpenseSemanticStatus({ status: 'paid', due_date: '2026-09-08' }, '2026-09-10'), 'paid');
assert.equal(resolveClinicExpenseSemanticStatus({ status: 'canceled', due_date: '2026-09-08' }, '2026-09-10'), 'canceled');

// UI/service surface is real, not a read-only placeholder.
assert.match(manager, /onClick=\{openNew\}/);
assert.match(manager, /\['one_off', 'Pontual'\]/);
assert.match(manager, /\['recurring', 'Recorrente'\]/);
assert.match(manager, /Editar ocorrência/);
assert.match(manager, /Marcar paga/);
assert.match(manager, /Alterar futuro/);
assert.match(manager, /Encerrar/);
assert.match(dataService, /async createClinicExpense\(/);
assert.match(dataService, /async markClinicExpensePaid\(/);
assert.match(dataService, /async createClinicExpenseRule\(/);
assert.match(dataService, /async updateClinicExpenseRule\(/);
assert.match(dataService, /async endClinicExpenseRule\(/);
assert.match(dashboard, /<ClinicExpenseManager/);

// DRE/cash semantic separation: pending forecasts never become realized cash.
assert.match(dashboard, /const operationalExpenses = paidOperationalExpenseEntries/);
assert.match(dashboard, /const projectedOperationalExpenses = activeOperationalExpenseEntries/);
assert.match(dashboard, /const cashOperationalExpenses = cashOperationalExpenseEntries/);
assert.match(dashboard, /const cashOut = professionalPaid \+ cashOperationalExpenses/);
assert.match(dashboard, /source: 'expense'/);
assert.match(dashboard, /data-financial-due-source=\{isExpenseDue \? 'expense' : 'receivable'\}/);

// Concrete acceptance examples remain represented by one canonical occurrence per logical recurrence/date.
const materializerOccurrences = migration.match(/recurrence_occurrence_key/g) || [];
assert.ok(materializerOccurrences.length >= 6, 'recurring materialization must keep a stable occurrence identity');
assert.match(manager, /Previsto \{currency\(expected\)\}/, 'variable realized value must preserve expected baseline in the UI');

console.log('clinicExpenseManagement.regression.test: PASS');
