import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, Layers3 } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { dataService } from '../services/dataService';

type Props = {
  patientId: string;
  isPanelDark?: boolean;
};

type ChartSegment = {
  measurement_model_version?: string;
  phase_assignment_id?: string;
  phase_type?: string;
  phase_label?: string;
  metric_key?: string;
  metric_label?: string;
  unit?: string;
  series_key?: string;
  series_label?: string;
  source_family?: string;
  points?: Array<{
    source_id?: string;
    session_id?: string;
    occurred_at?: string;
    value?: number | string | null;
    numerator?: number | string | null;
    denominator?: number | string | null;
    requires_review?: boolean;
  }>;
};

const lineColors = ['#7C3AED', '#0EA5E9', '#10B981', '#F97316', '#EC4899', '#6366F1', '#14B8A6'];

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const unitLabel = (unit?: string) => {
  if (unit === 'percent') return '%';
  if (unit === 'seconds') return 's';
  if (unit === 'rate_per_hour') return '/h';
  return '';
};

export function AbaV3ClinicalChartPanel({ patientId, isPanelDark = false }: Props) {
  const [targets, setTargets] = useState<any[]>([]);
  const [targetId, setTargetId] = useState('');
  const [days, setDays] = useState(90);
  const [payload, setPayload] = useState<any>({ segments: [], available_metrics: [] });
  const [metricKey, setMetricKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    void dataService.getAbaV3ChartCatalog(patientId).then((result: any) => {
      if (cancelled) return;
      if (result?.success === false) {
        setTargets([]);
        setError(result?.error || 'Não foi possível carregar os alvos ABA V3.');
        return;
      }
      const nextTargets = Array.isArray(result?.data?.targets) ? result.data.targets : [];
      setTargets(nextTargets);
      setTargetId((current) => current || String(nextTargets[0]?.target_id || ''));
    });
    return () => { cancelled = true; };
  }, [patientId]);

  useEffect(() => {
    if (!patientId || !targetId) {
      setPayload({ segments: [], available_metrics: [] });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void dataService.getAbaV3TargetChartSeries(patientId, targetId, { days, limit: 120 }).then((result: any) => {
      if (cancelled) return;
      if (result?.success === false) {
        setPayload({ segments: [], available_metrics: [] });
        setError(result?.error || 'Não foi possível carregar os gráficos ABA V3.');
        setLoading(false);
        return;
      }
      const nextPayload = result?.data || { segments: [], available_metrics: [] };
      setPayload(nextPayload);
      const metrics = Array.isArray(nextPayload?.available_metrics) ? nextPayload.available_metrics : [];
      setMetricKey((current) => metrics.some((item: any) => item?.key === current) ? current : String(metrics[0]?.key || ''));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [patientId, targetId, days]);

  const visibleSegments = useMemo(() => {
    const segments: ChartSegment[] = Array.isArray(payload?.segments) ? payload.segments : [];
    return segments.filter((segment) => !metricKey || segment.metric_key === metricKey);
  }, [payload, metricKey]);

  const chartRows = useMemo(() => {
    const rows = new Map<string, any>();
    visibleSegments.forEach((segment, segmentIndex) => {
      (segment.points || []).forEach((point) => {
        const occurredAt = String(point?.occurred_at || '');
        if (!occurredAt) return;
        const current = rows.get(occurredAt) || { occurredAt, label: formatDate(occurredAt) };
        const numericValue = point?.value === null || point?.value === undefined ? null : Number(point.value);
        current[`segment_${segmentIndex}`] = Number.isFinite(numericValue) ? numericValue : null;
        current[`meta_${segmentIndex}`] = point;
        rows.set(occurredAt, current);
      });
    });
    return Array.from(rows.values()).sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }, [visibleSegments]);

  const selectedMetric = (Array.isArray(payload?.available_metrics) ? payload.available_metrics : []).find((item: any) => item?.key === metricKey);
  const panel = isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900';
  const muted = isPanelDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <section className={`rounded-3xl border p-4 sm:p-6 ${panel}`} data-testid="aba-v3-segmented-chart-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">Evolução ABA V3</h3>
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs text-violet-700">Fases separadas</span>
          </div>
          <p className={`mt-1 max-w-2xl text-sm ${muted}`}>
            Cada fase clínica é desenhada como uma série independente. O histórico Legacy V2 permanece separado para não unir métricas com semânticas diferentes.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-emerald-600">
          <Layers3 size={15} /> V3 canônico
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          <span className={`mb-1 block ${muted}`}>Alvo</span>
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className={`w-full rounded-xl border px-3 py-2.5 ${isPanelDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
            {targets.length === 0 && <option value="">Nenhum alvo V3 disponível</option>}
            {targets.map((target) => <option key={String(target.target_id)} value={String(target.target_id)}>{String(target.target_name || target.target_id)}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className={`mb-1 block ${muted}`}>Métrica</span>
          <select value={metricKey} onChange={(event) => setMetricKey(event.target.value)} className={`w-full rounded-xl border px-3 py-2.5 ${isPanelDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
            {(Array.isArray(payload?.available_metrics) ? payload.available_metrics : []).map((metric: any) => <option key={String(metric.key)} value={String(metric.key)}>{String(metric.label || metric.key)}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className={`mb-1 block ${muted}`}>Período</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className={`w-full rounded-xl border px-3 py-2.5 ${isPanelDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
            <option value={180}>180 dias</option>
            <option value={365}>365 dias</option>
          </select>
        </label>
      </div>

      {error ? (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><AlertCircle className="mt-0.5 shrink-0" size={18} /><span>{error}</span></div>
      ) : loading ? (
        <div className={`mt-5 h-[360px] animate-pulse rounded-2xl ${isPanelDark ? 'bg-slate-800' : 'bg-slate-100'}`} />
      ) : chartRows.length > 0 && visibleSegments.length > 0 ? (
        <div className="mt-5">
          <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 text-xs ${muted}`}>
            <span>{selectedMetric?.label || 'Métrica clínica'} {unitLabel(selectedMetric?.unit) ? `· ${unitLabel(selectedMetric?.unit)}` : ''}</span>
            <span>{visibleSegments.length} segmento(s) clínico(s)</span>
          </div>
          <div className="h-[380px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 12, right: 18, left: 0, bottom: 18 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis unit={unitLabel(selectedMetric?.unit)} />
                <Tooltip />
                <Legend />
                {visibleSegments.map((segment, index) => (
                  <Line
                    key={`${segment.phase_assignment_id || 'phase'}:${segment.series_key || index}:${segment.metric_key || ''}`}
                    type="monotone"
                    dataKey={`segment_${index}`}
                    name={`${segment.phase_label || segment.phase_type || 'Fase'} · ${segment.series_label || segment.metric_label || 'Série'}`}
                    stroke={lineColors[index % lineColors.length]}
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className={`mt-5 flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center ${isPanelDark ? 'border-slate-700' : 'border-slate-200'}`}>
          <Activity size={28} className={muted} />
          <p className="mt-3 text-sm">Ainda não há pontos V3 comparáveis para este alvo e período.</p>
          <p className={`mt-1 text-xs ${muted}`}>A Verto não liga fases diferentes nem reaproveita percentuais Legacy para preencher lacunas.</p>
        </div>
      )}
    </section>
  );
}
