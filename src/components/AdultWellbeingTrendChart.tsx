import React, { useId, useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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
};

const toDateLabel = (value: string) => {
  const iso = String(value || '').slice(0, 10);
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso || '—';
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const wellbeingPointColor = (value: number) => {
  const bounded = Math.max(0, Math.min(100, Number(value) || 0));
  const hue = Math.round((bounded / 100) * 120);
  return `hsl(${hue} 78% 42%)`;
};

export const AdultWellbeingTrendChart = ({
  records,
  metricKind,
  dark = false,
  compact = false,
}: {
  records: WellbeingPoint[];
  metricKind: 'mood' | 'energy';
  dark?: boolean;
  compact?: boolean;
}) => {
  const rawId = useId().replace(/:/g, '');
  const strokeGradientId = `wellbeing-stroke-${rawId}`;
  const fillGradientId = `wellbeing-fill-${rawId}`;
  const label = metricKind === 'mood' ? 'Humor' : 'Energia';
  const plotTop = 10;
  const plotBottom = compact ? 146 : 194;
  const data = useMemo(() => (Array.isArray(records) ? records : [])
    .filter((row) => String(row?.metric_kind || row?.metricKind || '').toLowerCase() === metricKind)
    .map((row) => ({
      id: row?.id,
      date: String(row?.local_date || row?.localDate || row?.created_at || row?.createdAt || '').slice(0, 10),
      value: Math.max(0, Math.min(100, Number(row?.metric_value ?? row?.metricValue ?? 0) || 0)),
    }))
    .filter((row) => Boolean(row.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-90), [records, metricKind]);

  return (
    <section className={`rounded-3xl border p-4 sm:p-5 ${dark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white'}`} aria-label={`Histórico de ${label.toLowerCase()}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className={`text-sm font-semibold ${dark ? 'text-slate-100' : 'text-slate-800'}`}>{label} ao longo do tempo</h3>
          <p className={`mt-1 text-xs leading-5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            A cor acompanha a faixa registrada: abaixo de 50 tende ao vermelho e, conforme melhora, tende ao verde.
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${dark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>0–100</span>
      </div>
      {data.length === 0 ? (
        <div className={`flex ${compact ? 'h-36' : 'h-48'} items-center justify-center rounded-2xl border border-dashed text-sm ${dark ? 'border-slate-700 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
          Ainda não há registros suficientes para formar a tendência.
        </div>
      ) : (
        <div className={compact ? 'h-44' : 'h-56'}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 8, left: -24, bottom: 0 }}>
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
              <XAxis dataKey="date" tickFormatter={toDateLabel} tick={{ fontSize: 10, fill: dark ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 10, fill: dark ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip
                labelFormatter={(value) => toDateLabel(String(value))}
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
                strokeWidth={3}
                dot={(props: any) => {
                  const value = Number(props?.payload?.value ?? 0);
                  return <circle cx={props.cx} cy={props.cy} r={3.5} fill={wellbeingPointColor(value)} stroke="none" />;
                }}
                activeDot={(props: any) => {
                  const value = Number(props?.payload?.value ?? 0);
                  return <circle cx={props.cx} cy={props.cy} r={5} fill={wellbeingPointColor(value)} stroke={dark ? '#0f172a' : '#ffffff'} strokeWidth={2} />;
                }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className={`mt-3 text-[11px] leading-5 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
        Leitura visual dos registros informados pelo paciente. Não representa diagnóstico nem score clínico global.
      </p>
    </section>
  );
};

export default AdultWellbeingTrendChart;
