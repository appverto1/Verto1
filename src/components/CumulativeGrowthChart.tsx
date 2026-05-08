import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

type CumulativeGrowthChartProps = {
  patientId: string | number;
  history?: any[];
};

type CumulativePoint = {
  label: string;
  date: string;
  total: number;
};

const CHART_COLOR = '#3B82F6';

const normalizeSkill = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const resolveScore = (row: any) => {
  const raw = row?.professionalScore ?? row?.pro_score ?? row?.score;
  const score = Number(raw);
  return Number.isFinite(score) ? score : null;
};

const resolveTimestamp = (row: any) => {
  const direct = new Date(row?.created_at || row?.createdAt || row?.date || row?.sessionReferenceDate || 0).getTime();
  if (Number.isFinite(direct) && direct > 0) return direct;
  const numericId = Number(row?.id);
  return Number.isFinite(numericId) ? numericId : 0;
};

const formatDateLabel = (timestamp: number, fallbackIndex: number) => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return `Sessao ${fallbackIndex + 1}`;
  return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const formatFullDate = (timestamp: number, fallbackIndex: number) => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return `Sessao ${fallbackIndex + 1}`;
  return new Date(timestamp).toLocaleDateString('pt-BR');
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as CumulativePoint;
  if (!row) return null;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-xl">
      <p className="text-xs font-black uppercase tracking-widest text-slate-900">{row.date}</p>
      <p className="mt-2 text-sm font-black text-[#3B82F6]">
        {row.total} habilidade{row.total === 1 ? '' : 's'} dominada{row.total === 1 ? '' : 's'}
      </p>
    </div>
  );
};

export const CumulativeGrowthChart = ({ patientId, history = [] }: CumulativeGrowthChartProps) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const chartData = useMemo<CumulativePoint[]>(() => {
    const targetPatientId = String(patientId || '').trim();
    if (!targetPatientId) return [];

    const rows = (Array.isArray(history) ? history : [])
      .filter((row) => String(row?.patientId || row?.patient_id || '').trim() === targetPatientId)
      .filter((row) => normalizeSkill(row?.title || row?.taskTitle))
      .filter((row) => resolveScore(row) !== null)
      .map((row) => ({
        ...row,
        _skillKey: normalizeSkill(row?.title || row?.taskTitle),
        _score: resolveScore(row) || 0,
        _ts: resolveTimestamp(row)
      }))
      .sort((a, b) => a._ts - b._ts);

    if (!rows.length) return [];

    const masteredSkills = new Set<string>();
    const pointsByDate = new Map<string, CumulativePoint>();

    rows.forEach((row, index) => {
      if (row._score >= 1) masteredSkills.add(row._skillKey);

      const date = formatFullDate(row._ts, index);
      const label = formatDateLabel(row._ts, index);
      pointsByDate.set(date, {
        label,
        date,
        total: masteredSkills.size
      });
    });

    return Array.from(pointsByDate.values());
  }, [history, patientId]);

  if (!chartData.length) {
    return (
      <div className="rounded-[32px] border border-slate-100 bg-white p-6 text-center shadow-sm">
        <TrendingUp size={30} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm font-bold text-slate-400">
          Ainda nao ha registros suficientes para gerar crescimento cumulativo.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[36px] border border-slate-100 bg-white p-5 shadow-sm sm:p-7">
      <div className="mb-5">
        <h3 className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900">
          <TrendingUp size={20} className="text-[#3B82F6]" />
          Crescimento cumulativo
        </h3>
        <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Registro cumulativo de habilidades dominadas ao longo das sessoes
        </p>
      </div>

      <div className="h-[320px]">
        {isMounted ? (
          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={280}>
            <AreaChart data={chartData} margin={{ top: 12, right: 24, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id="cumulativeGrowthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#EEF2F7" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748B', fontSize: 11, fontWeight: 800 }}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 800 }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="total"
                stroke={CHART_COLOR}
                strokeWidth={4}
                fill="url(#cumulativeGrowthFill)"
                dot={{ r: 5, fill: CHART_COLOR, stroke: '#fff', strokeWidth: 2 }}
                activeDot={{ r: 7, stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          </SafeResponsiveContainer>
        ) : (
          <div className="h-full w-full animate-pulse rounded-3xl bg-slate-50" />
        )}
      </div>
    </div>
  );
};
