import React, { useMemo } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ReferenceLine, Tooltip, XAxis, YAxis,
} from 'recharts';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

// Presentation only: all figures come from the already-authorized owner financial overview.
// No speculative Stripe fees, simulator assumptions or additional network requests.
type View = 'overview' | 'evolution' | 'customers' | 'costs';
type FinancialOverview = {
  source?: string;
  summary?: Record<string, unknown>;
  monthly?: Array<Record<string, unknown>>;
  byPlan?: Array<Record<string, unknown>>;
  topCustomers?: Array<Record<string, unknown>>;
  costRules?: Array<{ id: string; cost_type: string; category: string; starts_month: string; ends_month: string | null }>;
  dataQuality?: { cashFlowIsEstimated?: boolean };
};
type Props = { financial: FinancialOverview; view: View };
const number = (v: unknown) => {
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const currency = (v: unknown) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(number(v));
const percentage = (v: unknown) => new Intl.NumberFormat('pt-BR', {
  style: 'decimal', maximumFractionDigits: 2,
}).format(number(v)) + '%';
const palette = ['#0EA5E9', '#8B5CF6', '#F59E0B', '#10B981', '#64748B', '#EC4899'];
const axes = (
  <>
    <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
    <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={65} />
  </>
);
const moneyTooltip = (value: unknown, name: unknown) => [currency(value), String(name)];
const pctTooltip = (value: unknown, name: unknown) => [percentage(value), String(name)];

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <h3 className="text-base font-black text-slate-900">{title}</h3>
    <p className="mt-1 mb-4 text-xs leading-relaxed text-slate-500">{subtitle}</p>
    {children}
  </section>;
}
function Plot({ children }: { children: React.ReactElement }) {
  return <div className="h-72 min-h-[288px] w-full">
    <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
      {children}
    </SafeResponsiveContainer>
  </div>;
}
function Empty({ label }: { label: string }) {
  return <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{label}</p>;
}
function MoneyCell({ value, strong = false }: { value: unknown; strong?: boolean }) {
  return <td className={'whitespace-nowrap px-3 py-3 text-right tabular-nums ' + (strong ? 'font-bold text-slate-900' : 'text-slate-700')}>{currency(value)}</td>;
}
function MonthlyTable({ rows }: { rows: Array<Record<string, any>> }) {
  return <div className="overflow-x-auto">
    <table className="min-w-[1050px] w-full text-sm">
      <caption className="sr-only">Demonstrativo mensal das receitas, custos, margens e resultado</caption>
      <thead className="bg-slate-50 text-xs text-slate-600">
        <tr><th scope="col" className="px-3 py-3 text-left">Mês</th>
          <th scope="col" className="px-3 py-3 text-right">Receita paga</th>
          <th scope="col" className="px-3 py-3 text-right">Variáveis</th>
          <th scope="col" className="px-3 py-3 text-right">Contribuição</th>
          <th scope="col" className="px-3 py-3 text-right">Margem</th>
          <th scope="col" className="px-3 py-3 text-right">Fixos</th>
          <th scope="col" className="px-3 py-3 text-right">EBITDA</th>
          <th scope="col" className="px-3 py-3 text-right">Margem EBITDA</th>
          <th scope="col" className="px-3 py-3 text-right">Abaixo EBITDA</th>
          <th scope="col" className="px-3 py-3 text-right">Resultado</th></tr>
      </thead>
      <tbody>{rows.map((r, index) => <tr key={r.periodMonth || index} className="border-t border-slate-100 hover:bg-slate-50">
        <th scope="row" className="whitespace-nowrap px-3 py-3 text-left font-semibold text-slate-900">{r.monthLabel}</th>
        <MoneyCell value={r.revenueGross} /><MoneyCell value={r.variableCosts} />
        <MoneyCell value={r.contributionMarginValue} />
        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{r.revenueGross ? percentage(r.contributionMarginPct) : '—'}</td>
        <MoneyCell value={r.fixedCosts} /><MoneyCell value={r.ebitda} />
        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{r.revenueGross ? percentage(r.ebitdaPct) : '—'}</td>
        <MoneyCell value={r.belowEbitdaCosts} /><MoneyCell value={r.netResult} strong />
      </tr>)}</tbody>
    </table>
  </div>;
}

export function OwnerDreIntelligence({ financial, view }: Props) {
  const monthly = useMemo(() => (financial.monthly || []).map((row) => ({
    ...row,
    periodMonth: String(row.periodMonth || ''),
    monthLabel: String(row.monthLabel || row.periodMonth || '—'),
    revenueGross: number(row.revenueGross), variableCosts: number(row.variableCosts),
    fixedCosts: number(row.fixedCosts),
    contributionMarginValue: number(row.contributionMarginValue),
    contributionMarginPct: number(row.contributionMarginPct),
    ebitda: number(row.ebitda), ebitdaPct: number(row.ebitdaPct),
    belowEbitdaCosts: number(row.belowEbitdaCosts),
    netResult: number(row.netResult), delinquencyAmount: number(row.delinquencyAmount),
  })).sort((a,b) => a.periodMonth.localeCompare(b.periodMonth)), [financial.monthly]);
  const current = financial.summary || {};
  const plans = useMemo(() => (financial.byPlan || []).map((p, index) => ({
    id: String(p.planName || index), name: String(p.planName || 'Plano não identificado'),
    revenue: number(p.revenueNet), customers: number(p.customers),
  })).sort((a,b) => b.revenue - a.revenue), [financial.byPlan]);
  const customers = useMemo(() => (financial.topCustomers || []).map((c, index) => ({
    id: String(c.customerId || index), name: String(c.name || 'Clínica'),
    revenue: number(c.revenueNet), cost: number(c.totalCost), profit: number(c.profit),
    margin: number(c.marginPct), variable: number(c.variableCost),
    fixed: number(c.fixedCostAllocated),
  })).sort((a,b) => a.profit - b.profit), [financial.topCustomers]);
  const costShares = [
    { name: 'Variáveis operacionais', value: number(current.variableCosts) },
    { name: 'Fixos operacionais', value: number(current.fixedCosts) },
    { name: 'Abaixo do EBITDA', value: number(current.belowEbitdaCosts) },
  ].filter(item => item.value > 0);
  const latest = monthly[monthly.length - 1];
  const previous = monthly[monthly.length - 2];
  const variance = (key: 'revenueGross' | 'ebitda' | 'netResult') =>
    latest && previous ? latest[key] - previous[key] : null;
  const hasPaidRevenue = monthly.some(x => x.revenueGross > 0);
  const monthlyEmpty = <Empty label="Ainda não há períodos financeiros disponíveis para gerar esta análise." />;
  const ledger = financial.source === 'platform_invoice_ledger';

  if (view === 'overview') return <div className="space-y-5">
    <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <strong>Leitura da saúde financeira:</strong> receita realizada = faturas Stripe pagas pelo valor bruto;
      margens e resultado consideram somente os custos efetivamente cadastrados no DRE.
      EBITDA não é saldo bancário e o fluxo de caixa é uma estimativa, sem conciliação de repasses.
      {!ledger && <span className="block mt-1 font-semibold">Base de faturas reais ainda indisponível: não interprete valores zerados como ausência de atividade.</span>}
      {ledger && !(financial.costRules || []).length && <span className="block mt-1 font-semibold">Nenhum custo cadastrado: as margens podem estar superestimadas.</span>}
    </div>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {([
        ['Variação da receita vs. mês anterior', 'revenueGross'],
        ['Variação do EBITDA vs. mês anterior', 'ebitda'],
        ['Variação do resultado vs. mês anterior', 'netResult'],
      ] as const).map(([label, key]) => <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <p className="mt-2 text-xl font-black tabular-nums">{variance(key) === null ? 'Sem comparação' : currency(variance(key))}</p>
        <p className="mt-1 text-xs text-slate-500">Diferença absoluta entre os dois últimos meses exibidos</p>
      </div>)}
    </div>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Receita paga x EBITDA" subtitle="Evolução do resultado operacional, com a mesma competência de recebimento usada no DRE.">
        {monthly.length ? <Plot><AreaChart data={monthly}>
          {axes}<Tooltip formatter={moneyTooltip} /><Legend />
          <Area dataKey="revenueGross" name="Receita paga" stroke="#0EA5E9" fill="#0EA5E9" fillOpacity={0.1} strokeWidth={2} />
          <Area dataKey="ebitda" name="EBITDA" stroke="#10B981" fill="#10B981" fillOpacity={0.1} strokeWidth={2} />
          <ReferenceLine y={0} stroke="#94A3B8" />
        </AreaChart></Plot> : monthlyEmpty}
      </Panel>
      <Panel title="Distribuição de custos do mês" subtitle="Somente regras cadastradas e aplicáveis ao período atual; despesas abaixo do EBITDA não reduzem o EBITDA.">
        {costShares.length ? <Plot><PieChart>
          <Pie data={costShares} dataKey="value" nameKey="name" cx="50%" cy="48%" outerRadius={91} label={({ percent }: any) => percentage(number(percent)*100)}>
            {costShares.map((_, index) => <Cell key={index} fill={palette[index % palette.length]} />)}
          </Pie>
          <Legend /><Tooltip formatter={moneyTooltip} />
        </PieChart></Plot> : <Empty label="Sem custos reconhecidos no mês. Cadastre os custos aplicáveis na aba Custos e regras." />}
      </Panel>
      <Panel title="Margens de contribuição e EBITDA" subtitle="Percentuais sobre receita bruta paga; sem receita no mês, o percentual não é interpretável.">
        {hasPaidRevenue ? <Plot><LineChart data={monthly.map(row => ({
          ...row, contributionMarginPct: row.revenueGross ? row.contributionMarginPct : null,
          ebitdaPct: row.revenueGross ? row.ebitdaPct : null,
        }))}>
          {axes}<Tooltip formatter={pctTooltip} /><Legend />
          <Line type="monotone" dataKey="contributionMarginPct" name="Margem de contribuição" stroke="#10B981" strokeWidth={2.5} connectNulls={false} />
          <Line type="monotone" dataKey="ebitdaPct" name="Margem EBITDA" stroke="#8B5CF6" strokeWidth={2.5} connectNulls={false} />
          <ReferenceLine y={0} stroke="#94A3B8" />
        </LineChart></Plot> : <Empty label="Sem receita paga no período para calcular margens." />}
      </Panel>
      <Panel title="Resultado após custos" subtitle="EBITDA menos despesas classificadas abaixo do EBITDA. Não representa dinheiro disponível na conta.">
        {monthly.length ? <Plot><LineChart data={monthly}>
          {axes}<Tooltip formatter={moneyTooltip} /><Legend />
          <Line type="monotone" dataKey="ebitda" name="EBITDA" stroke="#0EA5E9" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="netResult" name="Resultado após custos" stroke="#10B981" strokeWidth={3} />
          <ReferenceLine y={0} stroke="#94A3B8" />
        </LineChart></Plot> : monthlyEmpty}
      </Panel>
    </div>
  </div>;

  if (view === 'evolution') return <div className="space-y-5">
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Despesas por categoria" subtitle="Comparativo mensal dos custos variáveis, fixos e abaixo do EBITDA.">
        {monthly.length ? <Plot><BarChart data={monthly}>
          {axes}<Tooltip formatter={moneyTooltip} /><Legend />
          <Bar dataKey="variableCosts" name="Variáveis" fill="#F59E0B" stackId="costs" />
          <Bar dataKey="fixedCosts" name="Fixos" fill="#8B5CF6" stackId="costs" />
          <Bar dataKey="belowEbitdaCosts" name="Abaixo do EBITDA" fill="#64748B" stackId="costs" />
        </BarChart></Plot> : monthlyEmpty}
      </Panel>
      <Panel title="Contribuição e resultado líquido estimado" subtitle="Mostra o efeito dos custos operacionais e das despesas abaixo do EBITDA em cada mês.">
        {monthly.length ? <Plot><LineChart data={monthly}>
          {axes}<Tooltip formatter={moneyTooltip} /><Legend />
          <Line type="monotone" dataKey="contributionMarginValue" name="Contribuição" stroke="#0EA5E9" strokeWidth={2} />
          <Line type="monotone" dataKey="netResult" name="Resultado após custos" stroke="#10B981" strokeWidth={2.5} />
          <ReferenceLine y={0} stroke="#94A3B8" />
        </LineChart></Plot> : monthlyEmpty}
      </Panel>
    </div>
    <Panel title="Demonstrativo de resultados por mês" subtitle="Tabela auditável dos mesmos valores usados nos gráficos, sem consultas adicionais. Meses sem receita exibem margens indisponíveis.">
      {monthly.length ? <MonthlyTable rows={monthly} /> : monthlyEmpty}
    </Panel>
  </div>;

  if (view === 'customers') return <div className="space-y-5">
    <p className="text-xs text-slate-600">Rentabilidade por clínica considerando receitas pagas e rateio dos custos fixos pela contribuição positiva antes dos fixos. O rateio é gerencial, não um custo direto efetivamente medido por clínica.</p>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Resultado por clínica" subtitle="Menores resultados em primeiro lugar, inclusive resultados positivos quando não há prejuízo.">
        {customers.length ? <Plot><BarChart data={customers.slice(0, 12).map((x,i) => ({...x, label: String(i+1) + '. ' + x.name.slice(0, 12)}))} layout="vertical" margin={{ left: 8 }}>
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="label" width={115} tick={{ fontSize: 10 }} />
          <Tooltip formatter={moneyTooltip} />
          <ReferenceLine x={0} stroke="#94A3B8" />
          <Bar dataKey="profit" name="Resultado após custos">
            {customers.slice(0, 12).map((x,i) => <Cell key={i} fill={x.profit < 0 ? '#EF4444' : '#10B981'} />)}
          </Bar>
        </BarChart></Plot> : <Empty label="Sem clínicas com faturamento pago no período." />}
      </Panel>
      <Panel title="Receita por plano" subtitle="Distribuição financeira por plano conforme classificação existente no cadastro de faturamento.">
        {plans.length ? <Plot><BarChart data={plans.slice(0, 10).map((p,i) => ({...p,label:String(i+1)+'. '+p.name.slice(0,12)}))} layout="vertical" margin={{ left: 8 }}>
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="label" width={115} tick={{ fontSize: 10 }} />
          <Tooltip formatter={moneyTooltip} />
          <Bar dataKey="revenue" name="Receita por plano" fill="#0EA5E9" />
        </BarChart></Plot> : <Empty label="Sem faturamento por plano disponível na fonte atual." />}
      </Panel>
    </div>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Rentabilidade detalhada por clínica" subtitle="Receitas e custos da janela financeira carregada; despesas fixas são rateadas e nunca cobradas da clínica por este relatório.">
        {customers.length ? <div className="max-h-[470px] overflow-auto"><table className="min-w-[650px] w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
            <tr><th className="px-3 py-3 text-left">Clínica</th><th className="px-3 py-3 text-right">Receita</th><th className="px-3 py-3 text-right">Custo atribuído</th><th className="px-3 py-3 text-right">Resultado</th><th className="px-3 py-3 text-right">Margem</th></tr>
          </thead><tbody>{customers.map(c=><tr key={c.id} className="border-t border-slate-100">
            <th scope="row" className="px-3 py-3 text-left font-semibold">{c.name}</th>
            <MoneyCell value={c.revenue} /><MoneyCell value={c.cost} /><MoneyCell value={c.profit} strong />
            <td className="px-3 py-3 text-right">{c.revenue ? percentage(c.margin) : '—'}</td>
          </tr>)}</tbody>
        </table></div> : <Empty label="Sem dados de rentabilidade por clínica." />}
      </Panel>
      <Panel title="Faturamento detalhado por plano" subtitle="Valores realizados, sem somar simulações ou receitas previstas de clientes em teste.">
        {plans.length ? <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr><th className="px-3 py-3 text-left">Plano</th><th className="px-3 py-3 text-right">Receita</th></tr>
          </thead><tbody>{plans.map(p=><tr key={p.id} className="border-t border-slate-100">
            <th scope="row" className="px-3 py-3 text-left font-semibold">{p.name}</th>
            <MoneyCell value={p.revenue} />
          </tr>)}</tbody>
        </table></div> : <Empty label="Nenhum plano com faturamento pago foi retornado." />}
      </Panel>
    </div>
  </div>;

  return <div className="space-y-5">
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Custos operacionais ao longo do tempo" subtitle="Os custos só entram após serem registrados pelo botão Salvar custo.">
        {monthly.length ? <Plot><AreaChart data={monthly}>
          {axes}<Tooltip formatter={moneyTooltip} /><Legend />
          <Area dataKey="variableCosts" name="Variáveis" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.12} />
          <Area dataKey="fixedCosts" name="Fixos" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.12} />
        </AreaChart></Plot> : monthlyEmpty}
      </Panel>
      <Panel title="Regras de classificação" subtitle="Quantidade de regras cadastradas (inclui vigências futuras e encerradas); não é valor de despesa.">
        <div className="grid grid-cols-2 gap-3">
          {(['fixed', 'variable'] as const).flatMap(kind =>
            (['operating', 'below_ebitda'] as const).map(category => {
              const count = (financial.costRules || []).filter(r => r.cost_type === kind && r.category === category).length;
              const label = (kind === 'fixed' ? 'Fixos' : 'Variáveis') + (category === 'operating' ? ' operacionais' : ' abaixo EBITDA');
              return <div key={kind+category} className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs text-slate-600">{label}</p>
                <p className="mt-2 text-2xl font-black tabular-nums">{count}</p>
              </div>;
            })
          )}
        </div>
        <p className="mt-4 text-xs text-slate-500">Confirme quais regras correspondem a despesas realmente aplicáveis: uma regra genérica não é comprovação de taxa Stripe liquidada.</p>
      </Panel>
    </div>
  </div>;
}
