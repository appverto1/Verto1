import React, { useEffect, useId, useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type WellbeingPeriod = 'day' | 'week' | 'month' | 'year';

type WellbeingPoint = {
  id?: string;
  metric_kind?: string;
  metricKind?: string;
  metric_value?: number;
  metricValue?: number;
  local_date?: string;
  localDate?: string;
  created_at?: string;
  createdAt?: string;
  note?: string | null;
  icon?: string | null;
  tag_label?: string | null;
  tagLabel?: string | null;
};

type ChartPoint = {
  id: string;
  timestamp: number;
  plotTimestamp: number;
  value: number;
  emoji: string;
  note: string;
  tagLabel: string;
};

const PERIOD_LABELS: Record<WellbeingPeriod, string> = {
  day: 'Dia',
  week: 'Semana',
  month: 'Mês',
  year: 'Ano',
};

const PERIOD_DURATION_MS: Record<WellbeingPeriod, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 31 * 24 * 60 * 60 * 1000,
  year: 366 * 24 * 60 * 60 * 1000,
};

const wellbeingPointColor = (value: number) => {
  const bounded = Math.max(0, Math.min(100, Number(value) || 0));
  const hue = Math.round((bounded / 100) * 120);
  return `hsl(${hue} 78% 42%)`;
};

const fallbackEmoji = (metricKind: 'mood' | 'energy', value: number) => {
  if (metricKind === 'energy') {
    if (value < 20) return '🪫';
    if (value < 40) return '😴';
    if (value < 60) return '😌';
    if (value < 80) return '⚡';
    return '🔥';
  }
  if (value < 20) return '😞';
  if (value < 40) return '😕';
  if (value < 60) return '😐';
  if (value < 80) return '🙂';
  return '😄';
};

const recordTimestamp = (row: WellbeingPoint) => {
  const raw = String(row?.created_at || row?.createdAt || '').trim();
  if (raw) {
    const parsed = new Date(raw).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  const localDate = String(row?.local_date || row?.localDate || '').slice(0, 10);
  const fallback = localDate ? new Date(`${localDate}T12:00:00`).getTime() : NaN;
  return Number.isFinite(fallback) ? fallback : NaN;
};

const formatAxisLabel = (timestamp: number, period: WellbeingPeriod) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  if (period === 'day') {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (period === 'year') {
    return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const formatDetailDate = (timestamp: number) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Data não disponível';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const AdultWellbeingTrendChart = ({
  records,
  metricKind,
  dark = false,
  compact = false,
  period,
  onPeriodChange,
}: {
  records: WellbeingPoint[];
  metricKind: 'mood' | 'energy';
  dark?: boolean;
  compact?: boolean;
  period?: WellbeingPeriod;
  onPeriodChange?: (period: WellbeingPeriod) => void;
}) => {
  const rawId = useId().replace(/:/g, '');
  const strokeGradientId = `wellbeing-stroke-${rawId}`;
  const fillGradientId = `wellbeing-fill-${rawId}`;
  const [internalPeriod, setInternalPeriod] = useState<WellbeingPeriod>('month');
  const [selectedPoint, setSelectedPoint] = useState<ChartPoint | null>(null);
  const activePeriod = period || internalPeriod;
  const label = metricKind === 'mood' ? 'Humor' : 'Energia';
  const plotTop = 10;
  const plotBottom = compact ? 146 : 194;

  const data = useMemo(() => {
    const cutoff = Date.now() - PERIOD_DURATION_MS[activePeriod];
    const sorted = (Array.isArray(records) ? records : [])
      .filter((row) => String(row?.metric_kind || row?.metricKind || '').toLowerCase() === metricKind)
      .map((row, index) => {
        const timestamp = recordTimestamp(row);
        const value = Math.max(0, Math.min(100, Number(row?.metric_value ?? row?.metricValue ?? 0) || 0));
        return {
          id: String(row?.id || `${metricKind}-${timestamp}-${index}`),
          timestamp,
          plotTimestamp: timestamp,
          value,
          emoji: String(row?.icon || '').trim() || fallbackEmoji(metricKind, value),
          note: String(row?.note || '').trim(),
          tagLabel: String(row?.tag_label || row?.tagLabel || '').trim(),
        };
      })
      .filter((row) => Number.isFinite(row.timestamp) && row.timestamp >= cutoff)
      .sort((a, b) => a.timestamp - b.timestamp);

    let lastPlotTimestamp = -Infinity;
    return sorted.map((row) => {
      const plotTimestamp = row.timestamp <= lastPlotTimestamp ? lastPlotTimestamp + 1 : row.timestamp;
      lastPlotTimestamp = plotTimestamp;
      return { ...row, plotTimestamp };
    });
  }, [activePeriod, metricKind, records]);

  useEffect(() => {
    if (selectedPoint && !data.some((row) => row.id === selectedPoint.id)) setSelectedPoint(null);
  }, [data, selectedPoint]);

  const handlePeriodChange = (nextPeriod: WellbeingPeriod) => {
    setInternalPeriod(nextPeriod);
    setSelectedPoint(null);
    onPeriodChange?.(nextPeriod);
  };

  const dotFontSize = data.length > 120 ? 10 : data.length > 60 ? 12 : data.length > 30 ? 14 : 18;
  const singlePointPadding = activePeriod === 'day' ? 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const xDomain: [number | 'dataMin', number | 'dataMax'] = data.length === 1
    ? [data[0].plotTimestamp - singlePointPadding, data[0].plotTimestamp + singlePointPadding]
    : ['dataMin', 'dataMax'];

  const renderEmojiDot = (props: any) => {
    const point = props?.payload as ChartPoint | undefined;
    if (!point || !Number.isFinite(props?.cx) || !Number.isFinite(props?.cy)) return <g />;
    const openDetails = () => setSelectedPoint(point);
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={`${label} ${point.value}% em ${formatDetailDate(point.timestamp)}. Abrir detalhes.`}
        onClick={openDetails}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDetails();
          }
        }}
        style={{ cursor: 'pointer', outline: 'none' }}
      >
        <circle cx={props.cx} cy={props.cy} r={Math.max(10, dotFontSize / 1.4)} fill={wellbeingPointColor(point.value)} opacity={0.12} />
        <text
          x={props.cx}
          y={props.cy + 1}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={dotFontSize}
          style={{ userSelect: 'none' }}
        >
          {point.emoji}
        </text>
      </g>
    );
  };

  return (
    <section className={`rounded-3xl border p-4 sm:p-5 ${dark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white'}`} aria-label={`Tendência de ${label.toLowerCase()}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className={`text-sm font-semibold ${dark ? 'text-slate-100' : 'text-slate-800'}`}>{label} ao longo do tempo</h3>
          <p className={`mt-1 text-xs leading-5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            Cada emoji é um registro independente. Clique nele para ver o valor e a anotação daquele momento.
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${dark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>0–100</span>
      </div>

      <div className={`mb-4 grid grid-cols-4 gap-1 rounded-2xl p-1 ${dark ? 'bg-slate-900/70' : 'bg-slate-100'}`} aria-label="Período do gráfico">
        {(Object.keys(PERIOD_LABELS) as WellbeingPeriod[]).map((option) => {
          const active = activePeriod === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => handlePeriodChange(option)}
              className={`min-h-9 rounded-xl px-2 text-[11px] font-semibold transition ${active
                ? (dark ? 'bg-violet-500/20 text-violet-200 shadow-sm' : 'bg-white text-[#7a32fc] shadow-sm')
                : (dark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800')}`}
            >
              {PERIOD_LABELS[option]}
            </button>
          );
        })}
      </div>

      {data.length === 0 ? (
        <div className={`flex ${compact ? 'h-36' : 'h-48'} items-center justify-center rounded-2xl border border-dashed px-4 text-center text-sm ${dark ? 'border-slate-700 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
          Ainda não há registros neste período.
        </div>
      ) : (
        <div className={compact ? 'h-44' : 'h-56'}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 12, right: 10, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id={strokeGradientId} gradientUnits="userSpaceOnUse" x1="0" y1={plotBottom} x2="0" y2={plotTop}>
                  <stop offset="0%" stopColor="#dc2626" />
                  <stop offset="48%" stopColor="#ef4444" />
                  <stop offset="52%" stopColor="#84cc16" />
                  <stop offset="100%" stopColor="#16a34a" />
                </linearGradient>
                <linearGradient id={fillGradientId} gradientUnits="userSpaceOnUse" x1="0" y1={plotBottom} x2="0" y2={plotTop}>
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="50%" stopColor="#f59e0b" stopOpacity={0.16} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={dark ? '#334155' : '#e2e8f0'} />
              <XAxis
                dataKey="plotTimestamp"
                type="number"
                scale="time"
                domain={xDomain}
                tickFormatter={(value) => formatAxisLabel(Number(value), activePeriod)}
                tick={{ fontSize: 10, fill: dark ? '#94a3b8' : '#64748b' }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 10, fill: dark ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip
                labelFormatter={(value) => formatDetailDate(Number(value))}
                formatter={(value: any) => [`${Number(value)}%`, label]}
                contentStyle={{ borderRadius: 14, border: dark ? '1px solid #334155' : '1px solid #e2e8f0', background: dark ? '#0f172a' : '#fff' }}
                labelStyle={{ color: dark ? '#e2e8f0' : '#334155' }}
              />
              <ReferenceLine y={50} stroke={dark ? '#64748b' : '#94a3b8'} strokeDasharray="4 4" />
              <Area type="monotone" dataKey="value" stroke="none" fill={`url(#${fillGradientId})`} fillOpacity={1} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={`url(#${strokeGradientId})`}
                strokeWidth={2.5}
                dot={renderEmojiDot}
                activeDot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {selectedPoint && (
        <div className={`mt-4 rounded-2xl border p-4 ${dark ? 'border-slate-700 bg-slate-900/70' : 'border-slate-200 bg-slate-50'}`} role="status" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="text-3xl" aria-hidden="true">{selectedPoint.emoji}</span>
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${dark ? 'text-slate-100' : 'text-slate-800'}`}>{label}: {selectedPoint.value}%</p>
                <p className={`mt-0.5 text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{formatDetailDate(selectedPoint.timestamp)}</p>
                {selectedPoint.tagLabel && <p className={`mt-2 text-xs font-medium ${dark ? 'text-violet-300' : 'text-[#7a32fc]'}`}>{selectedPoint.tagLabel}</p>}
              </div>
            </div>
            <button type="button" onClick={() => setSelectedPoint(null)} className={`rounded-lg px-2 py-1 text-lg leading-none ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-400 hover:bg-white'}`} aria-label="Fechar detalhes">×</button>
          </div>
          <div className={`mt-3 rounded-xl p-3 ${dark ? 'bg-[#101b2e] text-slate-300' : 'bg-white text-slate-600'}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Anotação do paciente</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-5">{selectedPoint.note || 'Sem anotação neste registro.'}</p>
          </div>
        </div>
      )}

      <p className={`mt-3 text-[11px] leading-5 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
        Leitura visual dos registros informados pelo paciente. Não representa diagnóstico nem score clínico global.
      </p>
    </section>
  );
};

export default AdultWellbeingTrendChart;
