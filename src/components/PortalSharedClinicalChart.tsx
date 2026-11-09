import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Line, LineChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { dataService } from '../services/dataService';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

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
type PortalChartView = { domain: string; series: PortalChartSeries[] };
type PortalSharedChart = {
  family: 'PLAN_PTS' | 'ABA_V3';
  domain: string;
  series: PortalChartSeries[];
  /** Only the explicit, backend-authorized navigation views are supplied. */
  views?: PortalChartView[];
};

/** Patient-self, read-only projection. Never reuse raw professional observations. */
export function PortalSharedClinicalChart({ patientId }: { patientId: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [sharedChart, setSharedChart] = useState<PortalSharedChart | null>(null);
  const [activeDomain, setActiveDomain] = useState('');
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
    setActiveDomain('');
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
      const authorizedViews: PortalChartView[] = (Array.isArray(chart.views) ? chart.views : [])
        .filter((view: any) => view && typeof view.domain === 'string' && Array.isArray(view.series))
        .slice(0, 4)
        .map((view: any) => ({
          domain: view.domain,
          series: view.series.slice(0, 3),
        }));
      setSharedChart({
        family: chart.family,
        domain: String(chart.domain || ''),
        series: chart.series.slice(0, 3),
        ...(authorizedViews.length > 0 ? { views: authorizedViews } : {}),
      });
      setStatus('ready');
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => { cancelled = true; };
  }, [patientId, refresh]);

  const activeView = sharedChart?.views?.find((view) => view.domain === activeDomain)
    || sharedChart?.views?.[0]
    || (sharedChart ? { domain: sharedChart.domain, series: sharedChart.series } : null);
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
    <section className="mb-6 rounded-[28px] border border-violet-100 bg-white p-4 shadow-sm sm:p-6" aria-label="Evolução compartilhada" data-portal-shared-chart>
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
      {status === 'ready' && sharedChart && sharedChart.views && sharedChart.views.length > 1 && (
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Categorias autorizadas pela equipe clínica">
          {sharedChart.views.map((view) => (
            <button key={view.domain} type="button" aria-pressed={activeView?.domain === view.domain}
              onClick={() => setActiveDomain(view.domain)}
              className={`min-h-10 rounded-xl border px-3 text-xs font-medium ${activeView?.domain === view.domain ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-600'}`}>
              {({ skills: 'Habilidades', behaviors: 'Comportamentos interferentes', mastery: 'Maestria', maintenance: 'Manutenção' } as Record<string, string>)[view.domain] || 'Indicadores'}
            </button>
          ))}
        </nav>
      )}
      {status === 'ready' && activeView && (
        chartRows.every((row) => activeView.series.every((_, index) => row['series' + index] === null || row['series' + index] === undefined))
          ? <p role="status" className="mt-5 text-sm text-slate-500">Ainda não há dados disponíveis para esta visualização.</p>
          : (
            <div className="mt-4 h-72 w-full min-w-0" role="img" aria-label="Gráfico clínico compartilhado">
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
          )
      )}
    </section>
  );
}
