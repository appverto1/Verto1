import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart2, Info } from 'lucide-react';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

type StackedDomainStatusChartProps = {
  protocols?: any[];
  history?: any[];
  patients?: any[];
};

type DomainRow = {
  name: string;
  acquired: number;
  in_acquisition: number;
  not_started: number;
  acquiredAbs: number;
  inAcquisitionAbs: number;
  notStartedAbs: number;
  total: number;
};

const COLORS = {
  acquired: '#10B981',
  in_acquisition: '#F59E0B',
  not_started: '#E2E8F0'
};

const normalizeText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const resolveTimestamp = (row: any) => {
  const direct = new Date(row?.created_at || row?.createdAt || row?.date || 0).getTime();
  if (Number.isFinite(direct) && direct > 0) return direct;
  const numericId = Number(row?.id);
  return Number.isFinite(numericId) ? numericId : 0;
};

const resolveScoreRatio = (rawScore: unknown, maxScore: number) => {
  const numericScore = Number(rawScore);
  if (!Number.isFinite(numericScore)) return null;
  const safeMaxScore = Math.max(1, Number(maxScore) || 1);
  const ratio = numericScore > 1 ? numericScore / safeMaxScore : numericScore;
  return Math.max(0, Math.min(1, ratio));
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as DomainRow;
  if (!row) return null;

  const items = [
    { key: 'acquired', label: 'Adquiridas', abs: row.acquiredAbs, percent: row.acquired, color: COLORS.acquired },
    { key: 'in_acquisition', label: 'Em aquisição', abs: row.inAcquisitionAbs, percent: row.in_acquisition, color: COLORS.in_acquisition },
    { key: 'not_started', label: 'Não iniciadas', abs: row.notStartedAbs, percent: row.not_started, color: COLORS.not_started }
  ];

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-xl">
      <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-900">{label}</p>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className="flex min-w-[210px] items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 font-bold text-slate-600">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </div>
            <span className="font-black text-slate-900">
              {item.abs.toFixed(1)} pts · {item.percent.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-slate-100 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        Total do domínio: {row.total.toFixed(1)} pts
      </div>
    </div>
  );
};

export const StackedDomainStatusChart = ({ protocols = [], history = [], patients = [] }: StackedDomainStatusChartProps) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const chartData = useMemo<DomainRow[]>(() => {
    const patientIds = Array.from(
      new Set(
        [
          ...(Array.isArray(patients) ? patients.map((patient) => patient?.id) : []),
          ...(Array.isArray(history) ? history.map((row) => row?.patientId || row?.patient_id) : [])
        ]
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );

    if (!patientIds.length) return [];

    const latestByPatientAndSkill = new Map<string, { score: number; consecutive: number | null; ts: number }>();
    (Array.isArray(history) ? history : []).forEach((row) => {
      const patientId = String(row?.patientId || row?.patient_id || '').trim();
      const skillKey = normalizeText(row?.title || row?.taskTitle);
      const rawScore = row?.professionalScore ?? row?.pro_score ?? row?.score;
      if (!patientId || !skillKey || rawScore === null || rawScore === undefined) return;

      const score = Number(rawScore);
      if (!Number.isFinite(score)) return;
      const consecutive = Number(row?.consecutive_successes ?? row?.consecutiveSuccesses);

      const mapKey = `${patientId}:${skillKey}`;
      const ts = resolveTimestamp(row);
      const previous = latestByPatientAndSkill.get(mapKey);
      if (!previous || ts >= previous.ts) {
        latestByPatientAndSkill.set(mapKey, {
          score,
          consecutive: Number.isFinite(consecutive) ? consecutive : null,
          ts
        });
      }
    });

    const domains = new Map<string, { name: string; acquired: number; inAcquisition: number; notStarted: number; total: number }>();
    (Array.isArray(protocols) ? protocols : [])
      .filter((protocol) => protocol?.category === 'evaluation' || !protocol?.category)
      .forEach((protocol) => {
        (Array.isArray(protocol?.data) ? protocol.data : []).forEach((domain: any) => {
          const domainName = String(domain?.name || 'Domínio').trim();
          const domainKey = normalizeText(domainName);
          if (!domainKey) return;

          const current = domains.get(domainKey) || {
            name: domainName,
            acquired: 0,
            inAcquisition: 0,
            notStarted: 0,
            total: 0
          };

          (Array.isArray(domain?.skills) ? domain.skills : []).forEach((skill: any) => {
            const skillKey = normalizeText(skill?.name || skill?.title);
            if (!skillKey) return;
            const maxScore = Math.max(1, Number(skill?.maxScore ?? skill?.max_score ?? 1) || 1);
            const masteryTarget = Math.max(1, Number(skill?.meta_sucessos ?? skill?.metaSucessos ?? 1) || 1);

            patientIds.forEach((patientId) => {
              const latest = latestByPatientAndSkill.get(`${patientId}:${skillKey}`);
              current.total += maxScore;
              const scoreRatio = latest ? resolveScoreRatio(latest.score, maxScore) : null;
              const reachedMastery = latest?.consecutive !== null && latest?.consecutive !== undefined && latest.consecutive >= masteryTarget;

              if (!latest || scoreRatio === null || scoreRatio <= 0) {
                current.notStarted += maxScore;
              } else if (scoreRatio >= 1 || reachedMastery) {
                current.acquired += maxScore;
              } else {
                current.inAcquisition += maxScore;
              }
            });
          });

          domains.set(domainKey, current);
        });
      });

    return Array.from(domains.values())
      .filter((domain) => domain.total > 0)
      .map((domain) => ({
        name: domain.name,
        acquiredAbs: domain.acquired,
        inAcquisitionAbs: domain.inAcquisition,
        notStartedAbs: domain.notStarted,
        total: domain.total,
        acquired: Number(((domain.acquired / domain.total) * 100).toFixed(2)),
        in_acquisition: Number(((domain.inAcquisition / domain.total) * 100).toFixed(2)),
        not_started: Number(((domain.notStarted / domain.total) * 100).toFixed(2))
      }))
      .sort((a, b) => b.total - a.total);
  }, [history, patients, protocols]);

  if (!chartData.length) {
    return (
      <div className="rounded-[32px] border border-slate-100 bg-white p-8 text-center shadow-sm">
        <BarChart2 size={32} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm font-bold text-slate-400">Ainda não há dados suficientes para consolidar status por domínio.</p>
      </div>
    );
  }

  const minWidth = Math.max(980, chartData.length * 150);

  return (
    <div className="rounded-[36px] border border-slate-100 bg-white p-5 shadow-sm sm:p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-black tracking-tight text-slate-900">
            <BarChart2 size={22} className="text-[#7a32fc]" />
            Status das habilidades por domínio
          </h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Visão consolidada exclusiva da coordenação clínica
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
          <Info size={14} />
          Eixo Y em %
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="h-[420px]" style={{ minWidth }}>
          {isMounted ? (
            <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={360}>
              <BarChart data={chartData} margin={{ top: 12, right: 24, left: 0, bottom: 70 }} barCategoryGap="30%">
                <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={70}
                  tick={{ fill: '#64748B', fontSize: 11, fontWeight: 800 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 100]}
                  ticks={[0, 20, 40, 60, 80, 100]}
                  tickFormatter={(value) => `${value}%`}
                  tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 800 }}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F8FAFC' }} />
                <Bar dataKey="acquired" name="Adquiridas" stackId="a" fill={COLORS.acquired} radius={[10, 10, 0, 0]} maxBarSize={72} />
                <Bar dataKey="in_acquisition" name="Em aquisição" stackId="a" fill={COLORS.in_acquisition} maxBarSize={72} />
                <Bar dataKey="not_started" name="Não iniciadas" stackId="a" fill={COLORS.not_started} radius={[0, 0, 10, 10]} maxBarSize={72} />
              </BarChart>
            </SafeResponsiveContainer>
          ) : (
            <div className="h-full w-full animate-pulse rounded-3xl bg-slate-50" />
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-4">
        {[
          ['Adquiridas', COLORS.acquired],
          ['Em aquisição', COLORS.in_acquisition],
          ['Não iniciadas', COLORS.not_started]
        ].map(([label, color]) => (
          <div key={label} className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
};
