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
  protocols?: any[];
  protocolId?: string | number | null;
  compact?: boolean;
  dark?: boolean;
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
  const taskData = row?.task_data && typeof row.task_data === 'object'
    ? row.task_data
    : row?.taskData && typeof row.taskData === 'object'
      ? row.taskData
      : {};
  const raw = row?.professionalScore ?? row?.pro_score ?? row?.score ?? taskData?.proScore ?? taskData?.pro_score;
  const score = Number(raw);
  return Number.isFinite(score) ? score : null;
};

const resolveMaxScore = (row: any, protocolMaxScore?: number) => {
  const taskData = row?.task_data && typeof row.task_data === 'object'
    ? row.task_data
    : row?.taskData && typeof row.taskData === 'object'
      ? row.taskData
      : {};
  const raw = row?.maxScore ?? row?.max_score ?? taskData?.maxScore ?? taskData?.max_score ?? protocolMaxScore ?? 1;
  const maxScore = Number(raw);
  return Number.isFinite(maxScore) ? Math.max(1, maxScore) : 1;
};

const resolveTitle = (row: any) => {
  const taskData = row?.task_data && typeof row.task_data === 'object'
    ? row.task_data
    : row?.taskData && typeof row.taskData === 'object'
      ? row.taskData
      : {};
  return String(row?.title || row?.taskTitle || taskData?.title || taskData?.skillName || taskData?.skill_name || '').trim();
};

const resolveProtocolRef = (row: any) => {
  const taskData = row?.task_data && typeof row.task_data === 'object'
    ? row.task_data
    : row?.taskData && typeof row.taskData === 'object'
      ? row.taskData
      : {};
  return {
    id: String(row?.protocol_id || row?.protocolId || taskData?.protocol_id || taskData?.protocolId || '').trim(),
    title: normalizeSkill(row?.protocol_title || row?.protocolTitle || taskData?.protocolTitle || taskData?.protocol_name || '')
  };
};

const resolveTimestamp = (row: any) => {
  const taskData = row?.task_data && typeof row.task_data === 'object'
    ? row.task_data
    : row?.taskData && typeof row.taskData === 'object'
      ? row.taskData
      : {};
  const direct = new Date(row?.reviewed_at || taskData?.reviewed_at || taskData?.reviewedAt || row?.created_at || row?.createdAt || row?.date || row?.sessionReferenceDate || 0).getTime();
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

const CustomTooltip = ({ active, payload, dark = false }: any) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as CumulativePoint;
  if (!row) return null;

  return (
    <div className={`rounded-xl border p-3 shadow-sm ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-white'}`}>
      <p className={`text-xs font-semibold ${dark ? 'text-slate-100' : 'text-slate-900'}`}>{row.date}</p>
      <p className="mt-2 text-sm font-medium text-[#3B82F6]">
        {row.total} habilidade{row.total === 1 ? '' : 's'} dominada{row.total === 1 ? '' : 's'}
      </p>
    </div>
  );
};

export const CumulativeGrowthChart = ({
  patientId,
  history = [],
  protocols = [],
  protocolId = null,
  compact = false,
  dark = false
}: CumulativeGrowthChartProps) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const protocolSkillMap = useMemo(() => {
    const selectedId = String(protocolId || '').trim();
    const selectedProtocols = (Array.isArray(protocols) ? protocols : []).filter((protocol) => {
      if (!selectedId || selectedId === 'all') return true;
      return String(protocol?.id || '').trim() === selectedId;
    });
    const map = new Map<string, { maxScore: number; protocolId: string; protocolTitle: string }>();
    selectedProtocols.forEach((protocol) => {
      const protocolTitle = String(protocol?.title || protocol?.name || '').trim();
      const resolvedProtocolId = String(protocol?.id || protocolTitle || '').trim();
      (Array.isArray(protocol?.data) ? protocol.data : []).forEach((domain: any) => {
        (Array.isArray(domain?.skills) ? domain.skills : []).forEach((skill: any) => {
          const key = normalizeSkill(skill?.name || skill?.title);
          if (!key) return;
          map.set(key, {
            maxScore: Math.max(1, Number(skill?.maxScore ?? skill?.max_score ?? 1) || 1),
            protocolId: resolvedProtocolId,
            protocolTitle: normalizeSkill(protocolTitle)
          });
        });
      });
    });
    return map;
  }, [protocolId, protocols]);

  const chartData = useMemo<CumulativePoint[]>(() => {
    const targetPatientId = String(patientId || '').trim();
    if (!targetPatientId) return [];

    const rows = (Array.isArray(history) ? history : [])
      .filter((row) => String(row?.patientId || row?.patient_id || '').trim() === targetPatientId)
      .filter((row) => normalizeSkill(resolveTitle(row)))
      .filter((row) => resolveScore(row) !== null)
      .map((row) => {
        const title = resolveTitle(row);
        const skillKey = normalizeSkill(title);
        const protocolSkill = protocolSkillMap.get(skillKey);
        const protocolRef = resolveProtocolRef(row);
        const selectedProtocolId = String(protocolId || '').trim();
        const rowMatchesSelectedProtocol =
          !selectedProtocolId ||
          selectedProtocolId === 'all' ||
          protocolSkill ||
          protocolRef.id === selectedProtocolId ||
          (protocolRef.title && Array.from(protocolSkillMap.values()).some((item: any) => item.protocolTitle === protocolRef.title));
        if (!rowMatchesSelectedProtocol) return null;
        return {
          ...row,
          _skillKey: skillKey,
          _score: resolveScore(row) || 0,
          _maxScore: resolveMaxScore(row, protocolSkill?.maxScore),
          _ts: resolveTimestamp(row)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a._ts - b._ts);

    if (!rows.length) return [];

    const masteredSkills = new Set<string>();
    const pointsByDate = new Map<string, CumulativePoint>();

    rows.forEach((row, index) => {
      if (row._score >= row._maxScore) masteredSkills.add(row._skillKey);

      const date = formatFullDate(row._ts, index);
      const label = formatDateLabel(row._ts, index);
      pointsByDate.set(date, {
        label,
        date,
        total: masteredSkills.size
      });
    });

    return Array.from(pointsByDate.values());
  }, [history, patientId, protocolId, protocolSkillMap]);

  if (!chartData.length) {
    return (
      <div className={`rounded-2xl border p-5 text-center ${dark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
        <TrendingUp size={30} className="mx-auto mb-3 text-slate-300" />
        <p className={`text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          Ainda não há registros suficientes para mostrar o crescimento cumulativo.
        </p>
      </div>
    );
  }

  const latestTotal = chartData[chartData.length - 1]?.total || 0;
  const growth = latestTotal - (chartData[0]?.total || 0);

  return (
    <div className={`min-w-0 rounded-2xl border p-4 ${dark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className={`flex items-center gap-2 text-base font-semibold leading-snug ${dark ? 'text-slate-100' : 'text-slate-900'}`}>
            <TrendingUp size={20} className="text-[#3B82F6]" />
            Crescimento cumulativo
          </h3>
          <p className={`mt-1 text-xs leading-5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            Habilidades dominadas ao longo das sessões registradas.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-xl font-semibold ${dark ? 'text-slate-100' : 'text-slate-900'}`}>{latestTotal}</p>
          <p className={`text-[11px] ${growth > 0 ? 'text-emerald-600' : dark ? 'text-slate-400' : 'text-slate-500'}`}>
            {growth > 0 ? `+${growth} no período` : 'total atual'}
          </p>
        </div>
      </div>

      {chartData.length < 2 ? (
        <div className={`flex min-h-40 items-center justify-center rounded-xl border border-dashed px-5 text-center ${dark ? 'border-slate-700 bg-slate-900/50 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
          <p className="max-w-sm text-sm leading-6">
            Há um primeiro registro disponível. A curva aparecerá quando uma nova sessão produzir outro ponto de evolução.
          </p>
        </div>
      ) : (
      <div className={compact ? 'h-[240px]' : 'h-[260px] sm:h-[320px]'}>
        {isMounted ? (
          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
            <AreaChart data={chartData} margin={{ top: 12, right: 24, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id="cumulativeGrowthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={dark ? '#1E293B' : '#EEF2F7'} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: dark ? '#94A3B8' : '#64748B', fontSize: 10, fontWeight: 500 }}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: dark ? '#64748B' : '#94A3B8', fontSize: 10, fontWeight: 500 }}
              />
              <Tooltip content={<CustomTooltip dark={dark} />} />
              <Area
                type="monotone"
                dataKey="total"
                stroke={CHART_COLOR}
                strokeWidth={3}
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
      )}
    </div>
  );
};
