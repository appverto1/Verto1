import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';
import { buildPtsSpecialtyCriterionBuckets, type PtsSpecialtyPlan } from '../utils/ptsSpecialtyCriteriaChart';
import type { ClinicalOutcomeSeriesSummary } from '../utils/clinicalOutcomeAnalytics';
import type { ClinicalOutcomePlanScopeIndex } from '../utils/clinicalOutcomePlanScope';

const OTHER_COLORS = ['#8B5CF6', '#EC4899', '#0D9488', '#64748B', '#C026D3', '#EA580C'];
const specialtyColor = (name: string, fallbackIndex: number) => {
  const key = name.toLocaleLowerCase('pt-BR');
  if (/fono/.test(key)) return '#2563EB';
  if (/ocupacional|^to$/.test(key)) return '#EA580C';
  if (/psic|psico/.test(key)) return '#16A34A';
  return OTHER_COLORS[fallbackIndex % OTHER_COLORS.length];
};

export function PtsSpecialtyClusteredChart({
  plans, series, programs, planScopeIndex, isDark = false,
}: {
  plans: PtsSpecialtyPlan[];
  series: ClinicalOutcomeSeriesSummary[];
  programs: any[];
  planScopeIndex: ClinicalOutcomePlanScopeIndex;
  isDark?: boolean;
}) {
  const buckets = useMemo(() => buildPtsSpecialtyCriterionBuckets({
    plans, series, programs, planScopeIndex,
  }), [plans, series, programs, planScopeIndex]);

  const visiblePlans = useMemo(() =>
    plans.filter((plan) => buckets.some((bucket) => bucket.values[plan.id] !== null && bucket.values[plan.id] !== undefined)),
  [plans, buckets]);
  if (visiblePlans.length === 0) return (
    <div className={`rounded-2xl border p-4 text-sm ${isDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`} data-testid="pts-specialty-empty">
      <p className="font-semibold">Progresso multidisciplinar por especialidade</p>
      <p className="mt-1 text-xs leading-5">Ainda não há critérios clínicos sustentados ou avaliáveis suficientes nos planos deste período. Nenhuma especialidade foi registrada como zero por falta de dados.</p>
    </div>
  );

  const rows = buckets.map((bucket) => ({
    month: bucket.label,
    details: bucket.evidence,
    ...bucket.values,
  }));
  return (
    <section className={`rounded-2xl border p-4 sm:p-5 ${isDark ? 'border-slate-700 bg-slate-900/70 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`} data-testid="pts-specialty-clustered-chart">
      <h3 className="text-sm font-semibold">PTS · evolução multidisciplinar por especialidade</h3>
      <p className={`mt-1 text-xs leading-5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Percentual de alvos avaliáveis com critério individual sustentado. Cada cor representa um plano; barras lado a lado, sem misturar métricas clínicas ou transformar registros em progresso.
      </p>
      <div className="mt-4 w-full overflow-x-auto" role="region" aria-label="Barras agrupadas por especialidade, com rolagem horizontal" tabIndex={0}>
        <div style={{ width: '100%', minWidth: Math.max(460, buckets.length * Math.max(100, visiblePlans.length * 43)) }} className="h-72">
          <SafeResponsiveContainer width="100%" height="100%" minHeight={240}>
            <BarChart data={rows} barGap={2} margin={{ top: 12, right: 8, left: -12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#E2E8F0'} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: isDark ? '#CBD5E1' : '#475569' }} />
              <YAxis domain={[0, 100]} unit="%" width={48} tick={{ fontSize: 10, fill: isDark ? '#CBD5E1' : '#475569' }} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const details = payload[0]?.payload?.details || {};
                return (
                  <div className={`rounded-xl border p-3 text-xs shadow-lg ${isDark ? 'border-slate-600 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
                    <p className="font-semibold">Período {String(label || '')}</p>
                    {visiblePlans.map((plan, index) => {
                      const value = payload[0]?.payload?.[plan.id];
                      const count = details[plan.id];
                      return <p key={plan.id} className="mt-1">
                        <span style={{ color: specialtyColor(plan.specialty, index) }}>●</span> {plan.specialty}: {typeof value === 'number' ? `${value}% (${count?.sustained || 0} de ${count?.evaluable || 0} alvos)` : 'Sem evidência comparável'}
                      </p>;
                    })}
                  </div>
                );
              }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {visiblePlans.map((plan, index) => (
                <Bar key={plan.id} dataKey={plan.id} name={plan.specialty} fill={specialtyColor(plan.specialty, index)} maxBarSize={30} isAnimationActive={false} />
              ))}
            </BarChart>
          </SafeResponsiveContainer>
        </div>
      </div>
      <p className={`mt-3 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Critérios ainda não avaliáveis ficam sem barra, não em 0%. A ausência de metas sustentadas não significa ausência de evolução clínica.
      </p>
    </section>
  );
}
