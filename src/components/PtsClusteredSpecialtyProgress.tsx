import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import type { ClinicalOutcomeSeriesSummary } from '../utils/clinicalOutcomeAnalytics';
import type { ClinicalOutcomePlanScopeIndex } from '../utils/clinicalOutcomePlanScope';
import { clinicalSpecialtyScopeKey } from '../utils/clinicalSpecialties';
import { buildPtsClusteredSpecialtyMetrics, type PtsChartSpecialtyPlan } from '../utils/ptsClusteredSpecialtyProgress';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

const COLORS: Record<string, string> = {
  speech_therapy: '#2563EB',
  occupational_therapy: '#F59E0B',
  psychotherapy: '#16A34A',
};
const EXTRA_COLORS = ['#8B5CF6', '#0891B2', '#E11D48', '#65A30D', '#C026D3', '#475569'];
const labelForWeek = (week: string) => week.slice(8, 10) + '/' + week.slice(5, 7);

export function PtsClusteredSpecialtyProgress({
  plans, series, planScopeIndex, isDark = false, selectedMetricId = '', onSelectedMetricIdChange,
}: {
  plans: PtsChartSpecialtyPlan[];
  series: ClinicalOutcomeSeriesSummary[];
  planScopeIndex: ClinicalOutcomePlanScopeIndex;
  isDark?: boolean;
  selectedMetricId?: string;
  onSelectedMetricIdChange?: (metricId: string) => void;
}) {
  const metrics = useMemo(
    () => buildPtsClusteredSpecialtyMetrics(plans, series, planScopeIndex),
    [plans, series, planScopeIndex],
  );
  const selected = metrics.find((metric) => metric.id === selectedMetricId) || metrics[0];
  const tones = isDark ? 'text-slate-300' : 'text-slate-600';
  if (!selected) {
    return <p role="status" className={`rounded-xl border border-dashed p-4 text-xs ${tones}`}>Ainda não há medidas numéricas comparáveis por especialidade no período selecionado. Ausência de evidência não equivale a progresso zero.</p>;
  }
  const hasPercent = selected.unit === '%';
  const values = selected.weeks.flatMap((week) => Object.values(week.values));
  const bounds: [number, number | 'auto'] = hasPercent ? [0, 100] : [Math.min(0, ...values), 'auto'];
  const axisTone = isDark ? '#94A3B8' : '#64748B';
  const chartRows = selected.weeks.map((week) => ({
    week: labelForWeek(week.week),
    fullWeek: week.week,
    ...Object.fromEntries(plans.map((plan, index) => ['plan' + index, week.values[plan.id] ?? null])),
    counts: week.sampleCounts,
  }));
  const usedColors = new Set<string>();
  const planColors = plans.map((plan, index) => {
    const color = COLORS[clinicalSpecialtyScopeKey(plan.specialty) || ''] || EXTRA_COLORS[index % EXTRA_COLORS.length];
    if (usedColors.has(color)) return EXTRA_COLORS[(index + 1) % EXTRA_COLORS.length];
    usedColors.add(color);
    return color;
  });

  return (
    <div data-testid="pts-clustered-specialty-chart" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className={`min-w-0 flex-1 text-xs ${tones}`}>
          Métrica comparável por especialidade
          <select
            aria-label="Métrica para comparar especialidades"
            value={selected.id}
            onChange={(event) => onSelectedMetricIdChange?.(event.target.value)}
            className={`mt-1 block min-h-10 w-full max-w-lg rounded-xl border px-3 text-sm ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}
          >
            {metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.label} · {metric.unit || 'unidade informada'} · {metric.specialtyCount} plano(s)</option>)}
          </select>
        </label>
        <span className={`text-xs ${tones}`}>{selected.specialtyCount} de {plans.length} plano(s) com registro</span>
      </div>
      <div className="h-[290px] w-full overflow-x-auto" role="region" tabIndex={0} aria-label="Barras agrupadas por especialidade e semana">
        <div className="h-full" style={{ minWidth: Math.max(560, chartRows.length * Math.max(75, plans.length * 30)) }}>
          <SafeResponsiveContainer width="100%" height="100%" minHeight={260}>
            <BarChart data={chartRows} margin={{ top: 12, right: 16, left: 4, bottom: 32 }} barGap={2} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#E2E8F0'} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: axisTone }} interval={0} height={34} />
              <YAxis width={54} tick={{ fontSize: 10, fill: axisTone }} domain={bounds} tickFormatter={(value: number) => hasPercent ? value + '%' : String(value)} />
              <Tooltip
                labelFormatter={(_value: unknown, payload: any) => 'Semana de ' + String(payload?.[0]?.payload?.fullWeek || '')}
                formatter={(value: unknown, name: unknown, props: any) => {
                  const index = Number(String(props?.dataKey || '').replace('plan', ''));
                  const count = props?.payload?.counts?.[plans[index]?.id] || 0;
                  return [String(value) + (hasPercent ? '%' : selected.unit ? ' ' + selected.unit : '') + ' · ' + count + ' registro(s)', String(name)];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {plans.map((plan, index) => <Bar key={plan.id} dataKey={'plan' + index} name={plan.specialty} fill={planColors[index]} maxBarSize={34} isAnimationActive={false} />)}
            </BarChart>
          </SafeResponsiveContainer>
        </div>
      </div>
      <p className={`text-[11px] leading-5 ${tones}`}>
        Cada grupo mostra a mesma métrica nas especialidades com evidência naquela semana. Valores são descrições das observações; não são pontuação de domínio nem substituem o critério clínico. Barras ausentes significam falta de dados comparáveis.
      </p>
    </div>
  );
}
