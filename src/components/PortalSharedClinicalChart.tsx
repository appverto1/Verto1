import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Legend, Line, LineChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { dataService } from '../services/dataService';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';
import { clinicalSpecialtyScopeKey } from '../utils/clinicalSpecialties';

type PortalChartPoint = {
  observedAt?: string;
  occurredAt?: string;
  value?: number | null;
};
type PortalChartSeries = {
  key?: string;
  seriesKey?: string;
  metricLabel?: string;
  itemLabel?: string;
  targetLabel?: string;
  seriesLabel?: string;
  unit?: string;
  points?: PortalChartPoint[];
};
type PortalChartView = {
  domain: string;
  series: PortalChartSeries[];
};
type PortalGroupedChart = {
  metricLabel: string;
  unit: string;
  direction: string;
  plans: Array<{ id: string; specialty: string }>;
  weeks: Array<{ week: string; values: Record<string, number | null> }>;
};
type PortalSharedChart = {
  grouped?: PortalGroupedChart;
  family: 'PLAN_PTS' | 'ABA_V3';
  domain: string;
  series: PortalChartSeries[];
  views: PortalChartView[];
};

const DOMAIN_LABELS: Record<string, string> = {
  overview: 'PTS geral',
  skills: 'Habilidades',
  behaviors: 'Comportamentos interferentes',
  mastery: 'Maestria',
  maintenance: 'Manutenção',
};
const ALLOWED_PLAN_DOMAINS = new Set(Object.keys(DOMAIN_LABELS));

/** Patient-self, read-only projection. Never reuse raw professional observations. */
export function PortalSharedClinicalChart({ patientId, embedded = false }: { patientId: string; embedded?: boolean }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [sharedChart, setSharedChart] = useState<PortalSharedChart | null>(null);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [refresh, setRefresh] = useState(0);
  const retry = useCallback(() => setRefresh((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!patientId.trim()) {
      setSharedChart(null);
      setStatus('empty');
      return;
    }
    setStatus('loading');
    setSharedChart(null);
    setSelectedDomain('');
    void dataService.getPortalSharedChart(patientId).then((response: any) => {
      if (cancelled) return;
      if (!response || response.success === false) {
        setStatus('error');
        return;
      }
      const chart = response.data;
      if (!chart || !['PLAN_PTS', 'ABA_V3'].includes(chart.family) || !Array.isArray(chart.series)) {
        setStatus('empty');
        return;
      }
      const primaryView: PortalChartView = {
        domain: String(chart.domain || ''),
        series: chart.series.slice(0, 3),
      };
      // These views come ONLY from the patient-authorized, filtered projection
      // returned by the server. Never derive tabs from professional chart data.
      const serverViews = chart.family === 'PLAN_PTS' && Array.isArray(chart.views)
        ? chart.views.filter((view: any) => ALLOWED_PLAN_DOMAINS.has(String(view?.domain || ''))
          && Array.isArray(view?.series) && view.series.length > 0)
          .slice(0, 4)
          .map((view: any) => ({
            domain: String(view.domain),
            series: view.series.slice(0, 3),
          })) as PortalChartView[]
        : [];
      const views = serverViews.length > 0
        ? [primaryView, ...serverViews.filter((view) => view.domain !== primaryView.domain)]
        : [primaryView];
      // Never fetch a different graph from a patient-side ID. The grouped
      // comparison is already calculated and scoped by the server projection.
      const grouped: PortalGroupedChart | undefined = chart.family === 'PLAN_PTS'
        && primaryView.domain === 'overview'
        && Array.isArray(chart.grouped?.plans)
        && Array.isArray(chart.grouped?.weeks)
        ? {
          metricLabel: String(chart.grouped.metricLabel || ''),
          unit: String(chart.grouped.unit || ''),
          direction: String(chart.grouped.direction || ''),
          plans: chart.grouped.plans.slice(0, 12),
          weeks: chart.grouped.weeks.slice(-104),
        }
        : undefined;
      setSharedChart({
        family: chart.family,
        domain: primaryView.domain,
        series: primaryView.series,
        views,
        grouped,
      });
      setSelectedDomain(primaryView.domain);
      setStatus('ready');
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => { cancelled = true; };
  }, [patientId, refresh]);

  const activeView = useMemo(() => sharedChart?.views.find((view) => view.domain === selectedDomain)
    || sharedChart?.views[0] || null, [selectedDomain, sharedChart]);

  const groupedRows = useMemo(() => {
    if (!sharedChart?.grouped) return [];
    return sharedChart.grouped.weeks.map((week) => ({
      week: week.week.slice(8, 10) + '/' + week.week.slice(5, 7),
      fullWeek: week.week,
      ...Object.fromEntries(sharedChart.grouped!.plans.map((plan, index) => {
        const raw = week.values?.[plan.id];
        return ['plan' + index, raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw)];
      })),
    }));
  }, [sharedChart]);

  const chartRows = useMemo(() => {
    if (!activeView) return [];
    // Join only points already projected by the server. No clinical math or
    // synthesis occurs in the patient browser.
    const rows = new Map<string, Record<string, string | number | null>>();
    activeView.series.forEach((series, index) => {
      for (const point of (Array.isArray(series.points) ? series.points : []).slice(-180)) {
        const at = String(point.observedAt || point.occurredAt || '').trim();
        if (!at) continue;
        const existing = rows.get(at) || { observedAt: at };
        existing['series' + index] = point.value === null || typeof point.value !== 'number' || !Number.isFinite(point.value) ? null : point.value;
        rows.set(at, existing);
      }
    });
    return [...rows.values()].sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt))).slice(-180);
  }, [activeView]);

  return (
    <section className={embedded ? 'min-w-0 border-t border-blue-100 pt-4' : 'mb-6 rounded-[28px] border border-violet-100 bg-white p-4 shadow-sm sm:p-6'} aria-label="Evolução compartilhada" data-portal-shared-chart>
      <h2 className="text-base font-semibold text-slate-900">Evolução compartilhada</h2>
      <p className="mt-1 text-xs text-slate-500">Gráfico compartilhado pela equipe clínica</p>
      {status === 'loading' && <p role="status" className="mt-5 text-sm text-slate-500">Carregando evolução compartilhada…</p>}
      {status === 'empty' && <p role="status" className="mt-5 text-sm text-slate-500">Nenhum gráfico foi compartilhado pela equipe clínica ainda.</p>}
      {status === 'error' && (
        <div className="mt-5 space-y-3" role="status">
          <p className="text-sm text-slate-600">Não foi possível carregar o gráfico compartilhado agora.</p>
          <button type="button" onClick={retry} className="min-h-11 rounded-xl bg-violet-100 px-4 text-sm font-semibold text-violet-700">Tentar novamente</button>
        </div>
      )}
      {status === 'ready' && sharedChart && activeView && (
        <>
          {sharedChart.views.length > 1 && (
            <nav aria-label="Abas autorizadas do gráfico" className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {sharedChart.views.map((view) => (
                <button
                  type="button"
                  key={view.domain}
                  aria-pressed={view.domain === activeView.domain}
                  onClick={() => setSelectedDomain(view.domain)}
                  className={`min-h-11 shrink-0 rounded-xl border px-3 py-2 text-xs font-medium ${view.domain === activeView.domain ? 'border-violet-600 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  {DOMAIN_LABELS[view.domain] || 'Evolução clínica'}
                </button>
              ))}
            </nav>
          )}
          {activeView.domain === 'overview' && sharedChart.grouped ? (
            groupedRows.length === 0
              ? <p role="status" className="mt-5 text-sm text-slate-500">Sem evolução multidisciplinar comparável neste período.</p>
              : (
                <div className="mt-4 h-[295px] min-w-0 overflow-x-auto" role="region" tabIndex={0} aria-label="PTS geral com barras agrupadas por especialidade">
                  <div className="h-full" style={{ minWidth: Math.max(540, groupedRows.length * Math.max(80, sharedChart.grouped.plans.length * 30)) }}>
                    <SafeResponsiveContainer width="100%" height="100%" minHeight={250}>
                      <BarChart data={groupedRows} margin={{ top: 12, right: 12, left: 0, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="week" tick={{ fontSize: 10 }} interval={0} />
                        <YAxis width={53} tick={{ fontSize: 10 }} domain={sharedChart.grouped.unit === '%' ? [0, 100] : ['auto', 'auto']} />
                        <Tooltip labelFormatter={(_value: any, payload: any) => 'Semana de ' + String(payload?.[0]?.payload?.fullWeek || '')} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {sharedChart.grouped.plans.map((plan, index) => {
                          const color = ({
                            speech_therapy: '#2563EB',
                            occupational_therapy: '#F59E0B',
                            psychotherapy: '#16A34A',
                          } as Record<string, string>)[clinicalSpecialtyScopeKey(plan.specialty) || ''] || ['#8B5CF6', '#0891B2', '#E11D48', '#65A30D'][index % 4];
                          return <Bar key={plan.id} dataKey={'plan' + index} name={plan.specialty} fill={color} maxBarSize={34} isAnimationActive={false} />;
                        })}
                      </BarChart>
                    </SafeResponsiveContainer>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{sharedChart.grouped.metricLabel} · {sharedChart.grouped.unit || 'unidade clínica'}. Cada cor representa uma especialidade, sem média geral de critérios.</p>
                </div>
              )
          ) : chartRows.every((row) => activeView.series.every((_, index) => row['series' + index] === null || row['series' + index] === undefined))
            ? <p role="status" className="mt-5 text-sm text-slate-500">Ainda não há dados disponíveis para esta visualização.</p>
            : (
              <div className="mt-4 h-72 w-full min-w-0" role="img" aria-label={`Gráfico clínico compartilhado: ${DOMAIN_LABELS[activeView.domain] || 'evolução'}`}>
                <SafeResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 8, right: 12, bottom: 8, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="observedAt" tick={{ fontSize: 10 }} tickFormatter={(date: string) => date.slice(5, 10)} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} width={40} />
                    <Tooltip labelFormatter={(label: any) => String(label)} />
                    {activeView.series.map((series, index) => (
                      <Line
                        key={String(series.key || series.seriesKey || index)}
                        type="linear"
                        dataKey={'series' + index}
                        name={String(series.itemLabel || series.targetLabel || series.metricLabel || series.seriesLabel || 'Indicador ' + (index + 1))}
                        stroke={['#7a32fc', '#059669', '#0284c7'][index]}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </SafeResponsiveContainer>
              </div>
            )}
        </>
      )}
    </section>
  );
}
