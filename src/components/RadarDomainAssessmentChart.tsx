import React, { useEffect, useMemo, useState } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Tooltip
} from 'recharts';
import { Activity } from 'lucide-react';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

type RadarDomainAssessmentChartProps = {
  patientId: string | number;
  protocols?: any[];
  history?: any[];
  initialProtocolId?: string | number | null;
};

type RadarDomainRow = {
  subject: string;
  score: number;
  obtained: number;
  total: number;
};

const RADAR_COLOR = '#8B5CF6';

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

const resolveScore = (row: any) => {
  const raw = row?.professionalScore ?? row?.pro_score ?? row?.score;
  const score = Number(raw);
  return Number.isFinite(score) ? score : null;
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as RadarDomainRow;
  if (!row) return null;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-xl">
      <p className="text-xs font-black uppercase tracking-widest text-slate-900">{row.subject}</p>
      <p className="mt-2 text-sm font-black text-[#8B5CF6]">{row.score.toFixed(1)}%</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {row.obtained.toFixed(1)} de {row.total.toFixed(1)} pts
      </p>
    </div>
  );
};

export const RadarDomainAssessmentChart = ({
  patientId,
  protocols = [],
  history = [],
  initialProtocolId = null
}: RadarDomainAssessmentChartProps) => {
  const [isMounted, setIsMounted] = useState(false);
  const [selectedProtocolId, setSelectedProtocolId] = useState(() =>
    String(initialProtocolId || '').trim() || 'all'
  );
  useEffect(() => setIsMounted(true), []);

  const protocolOptions = useMemo(() => {
    return (Array.isArray(protocols) ? protocols : [])
      .filter((protocol) => (protocol?.category === 'evaluation' || !protocol?.category) && Array.isArray(protocol?.data) && protocol.data.length > 0)
      .map((protocol, index) => ({
        id: String(protocol?.id ?? protocol?.title ?? index),
        title: String(protocol?.title || `Protocolo ${index + 1}`),
        protocol
      }));
  }, [protocols]);

  useEffect(() => {
    const normalizedInitialProtocolId = String(initialProtocolId || '').trim();
    const initialIsValid = normalizedInitialProtocolId
      ? protocolOptions.some((option) => option.id === normalizedInitialProtocolId)
      : false;

    if (initialIsValid) {
      setSelectedProtocolId((prev) => {
        const previousIsValid = protocolOptions.some((option) => option.id === prev);
        if (prev === 'all' || !previousIsValid) return normalizedInitialProtocolId;
        return prev;
      });
      return;
    }

    if (selectedProtocolId === 'all') return;
    if (!protocolOptions.some((option) => option.id === selectedProtocolId)) {
      setSelectedProtocolId('all');
    }
  }, [initialProtocolId, protocolOptions, selectedProtocolId]);

  const visibleProtocols = useMemo(() => {
    if (selectedProtocolId === 'all') return protocolOptions.map((option) => option.protocol);
    return protocolOptions
      .filter((option) => option.id === selectedProtocolId)
      .map((option) => option.protocol);
  }, [protocolOptions, selectedProtocolId]);

  const chartData = useMemo<RadarDomainRow[]>(() => {
    const targetPatientId = String(patientId || '').trim();
    if (!targetPatientId) return [];

    const latestBySkill = new Map<string, { score: number; ts: number }>();
    (Array.isArray(history) ? history : []).forEach((row) => {
      const rowPatientId = String(row?.patientId || row?.patient_id || '').trim();
      if (rowPatientId !== targetPatientId) return;

      const skillKey = normalizeText(row?.title || row?.taskTitle);
      if (!skillKey) return;

      const score = resolveScore(row);
      if (score === null) return;

      const ts = resolveTimestamp(row);
      const previous = latestBySkill.get(skillKey);
      if (!previous || ts >= previous.ts) {
        latestBySkill.set(skillKey, { score, ts });
      }
    });

    const domains = new Map<string, { subject: string; obtained: number; total: number; order: number }>();
    let domainOrder = 0;
    visibleProtocols
      .filter((protocol) => protocol?.category === 'evaluation' || !protocol?.category)
      .forEach((protocol) => {
        (Array.isArray(protocol?.data) ? protocol.data : []).forEach((domain: any) => {
          const subject = String(domain?.name || 'Dominio').trim();
          const domainKey = normalizeText(`${protocol?.id || protocol?.title || ''}:${subject}`);
          if (!domainKey) return;

          const current = domains.get(domainKey) || { subject, obtained: 0, total: 0, order: domainOrder++ };
          (Array.isArray(domain?.skills) ? domain.skills : []).forEach((skill: any) => {
            const skillKey = normalizeText(skill?.name || skill?.title);
            if (!skillKey) return;

            const maxScore = Math.max(1, Number(skill?.maxScore ?? skill?.max_score ?? 1) || 1);
            current.total += maxScore;

            const latest = latestBySkill.get(skillKey);
            if (!latest) return;
            current.obtained += Math.max(0, Math.min(maxScore, latest.score));
          });

          domains.set(domainKey, current);
        });
      });

    return Array.from(domains.values())
      .filter((domain) => domain.total > 0)
      .sort((a, b) => a.order - b.order)
      .map((domain) => ({
        subject: domain.subject,
        obtained: domain.obtained,
        total: domain.total,
        score: Number(Math.max(0, Math.min(100, (domain.obtained / domain.total) * 100)).toFixed(2))
      }));
  }, [history, patientId, visibleProtocols]);

  if (!chartData.length) {
    return (
      <div className="rounded-[32px] border border-slate-100 bg-white p-6 text-center shadow-sm">
        <Activity size={30} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm font-bold text-slate-400">
          Ainda nao ha avaliacoes suficientes para gerar o radar individual deste paciente.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[36px] border border-slate-100 bg-white p-5 shadow-sm sm:p-7">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900">
            <Activity size={20} className="text-[#8B5CF6]" />
            Radar individual por dominio
          </h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Visao 360 do equilibrio de desenvolvimento do paciente
          </p>
        </div>
        {protocolOptions.length > 1 && (
          <div className="min-w-[240px]">
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Filtrar protocolo
            </label>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-700 outline-none transition-all focus:border-[#8B5CF6] focus:ring-4 focus:ring-[#8B5CF6]/10"
              value={selectedProtocolId}
              onChange={(event) => setSelectedProtocolId(event.target.value)}
            >
              <option value="all">Todos os protocolos</option>
              {protocolOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="h-[420px]">
        {isMounted ? (
          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={360}>
            <RadarChart data={chartData} outerRadius="78%">
              <PolarGrid stroke="#CBD5E1" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#475569', fontSize: 11, fontWeight: 800 }} />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tickCount={6}
                tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 800 }}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Radar
                name="Maestria"
                dataKey="score"
                stroke={RADAR_COLOR}
                fill={RADAR_COLOR}
                fillOpacity={0.5}
                strokeWidth={3}
              />
            </RadarChart>
          </SafeResponsiveContainer>
        ) : (
          <div className="h-full w-full animate-pulse rounded-3xl bg-slate-50" />
        )}
      </div>
    </div>
  );
};
