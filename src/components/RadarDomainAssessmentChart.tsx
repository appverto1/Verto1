import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  protocolId?: string | number | null;
  storageKey?: string;
  compact?: boolean;
  dark?: boolean;
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
  const taskData = row?.task_data && typeof row.task_data === 'object'
    ? row.task_data
    : row?.taskData && typeof row.taskData === 'object'
      ? row.taskData
      : {};
  const raw = row?.professionalScore ?? row?.pro_score ?? row?.score ?? taskData?.proScore ?? taskData?.pro_score;
  const score = Number(raw);
  return Number.isFinite(score) ? score : null;
};

const CustomTooltip = ({ active, payload, dark = false }: any) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as RadarDomainRow;
  if (!row) return null;

  return (
    <div className={`rounded-xl border p-3 shadow-sm ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-100 bg-white'}`}>
      <p className={`text-xs font-semibold ${dark ? 'text-slate-100' : 'text-slate-900'}`}>{row.subject}</p>
      <p className="mt-2 text-sm font-medium text-[#8B5CF6]">{row.score.toFixed(1)}%</p>
      <p className={`mt-1 text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        {row.obtained.toFixed(1)} de {row.total.toFixed(1)} pts
      </p>
    </div>
  );
};

export const RadarDomainAssessmentChart = ({
  patientId,
  protocols = [],
  history = [],
  initialProtocolId = null,
  protocolId,
  storageKey,
  compact = false,
  dark = false
}: RadarDomainAssessmentChartProps) => {
  const [isMounted, setIsMounted] = useState(false);
  const persistedStorageKey = storageKey || `verto.radar-domain-filter:${String(patientId || 'unknown')}`;
  const readPersistedProtocolId = () => {
    if (typeof window === 'undefined') return '';
    try {
      return String(window.localStorage.getItem(persistedStorageKey) || '').trim();
    } catch {
      return '';
    }
  };
  const [internalProtocolId, setInternalProtocolId] = useState(() =>
    readPersistedProtocolId() || String(initialProtocolId || '').trim() || 'all'
  );
  const isProtocolControlled = protocolId !== undefined;
  const selectedProtocolId = isProtocolControlled
    ? String(protocolId || '').trim() || 'all'
    : internalProtocolId;
  const lastHydratedStorageKeyRef = useRef(persistedStorageKey);
  const hasUserSelectedProtocolRef = useRef(false);
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
    if (lastHydratedStorageKeyRef.current === persistedStorageKey) return;
    lastHydratedStorageKeyRef.current = persistedStorageKey;
    hasUserSelectedProtocolRef.current = false;

    const nextProtocolId = readPersistedProtocolId() || String(initialProtocolId || '').trim() || 'all';
    if (!isProtocolControlled) {
      setInternalProtocolId((prev) => (prev === nextProtocolId ? prev : nextProtocolId));
    }
  }, [initialProtocolId, isProtocolControlled, persistedStorageKey]);

  useEffect(() => {
    const normalizedInitialProtocolId = String(initialProtocolId || '').trim();
    const initialIsValid = normalizedInitialProtocolId
      ? protocolOptions.some((option) => option.id === normalizedInitialProtocolId)
      : false;

    if (isProtocolControlled) return;
    setInternalProtocolId((prev) => {
      const previousIsValid = prev === 'all' || protocolOptions.some((option) => option.id === prev);
      if (previousIsValid) {
        if (prev === 'all' && !hasUserSelectedProtocolRef.current && initialIsValid) {
          return normalizedInitialProtocolId;
        }
        return prev;
      }
      return initialIsValid ? normalizedInitialProtocolId : 'all';
    });
  }, [initialProtocolId, isProtocolControlled, protocolOptions]);

  useEffect(() => {
    if (typeof window === 'undefined' || isProtocolControlled) return;
    try {
      window.localStorage.setItem(persistedStorageKey, selectedProtocolId);
    } catch {
      // localStorage can be unavailable in restricted contexts.
    }
  }, [isProtocolControlled, persistedStorageKey, selectedProtocolId]);

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
      <div className={`rounded-2xl border p-5 text-center ${dark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
        <Activity size={30} className="mx-auto mb-3 text-slate-300" />
        <p className={`text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          Ainda não há avaliações suficientes para mostrar o desempenho por domínio.
        </p>
      </div>
    );
  }

  const useDomainList = compact && chartData.length > 8;

  return (
    <div className={`min-w-0 rounded-2xl border p-4 ${dark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h3 className={`flex items-center gap-2 text-base font-semibold leading-snug ${dark ? 'text-slate-100' : 'text-slate-900'}`}>
            <Activity size={20} className="text-[#8B5CF6]" />
            {useDomainList ? 'Desempenho por domínio' : 'Radar individual por domínio'}
          </h3>
          <p className={`mt-1 text-xs leading-5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            {useDomainList
              ? 'Lista completa para preservar a leitura de protocolos com muitos domínios.'
              : 'Distribuição atual dos resultados no protocolo selecionado.'}
          </p>
        </div>
        {!isProtocolControlled && protocolOptions.length > 1 && (
          <div className="w-full min-w-0 lg:w-64">
            <label className={`mb-1 block text-xs font-medium ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              Filtrar protocolo
            </label>
            <select
              className={`h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/15 ${dark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-700'}`}
              value={selectedProtocolId}
              onChange={(event) => {
                hasUserSelectedProtocolRef.current = true;
                setInternalProtocolId(event.target.value);
              }}
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

      {useDomainList ? (
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2" role="list" aria-label="Resultados por domínio">
          {chartData.map((domain) => (
            <div key={domain.subject} role="listitem" className="min-w-0">
              <div className={`mb-1.5 flex items-start justify-between gap-3 text-xs ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
                <span className="min-w-0 break-words leading-5">{domain.subject}</span>
                <strong className={dark ? 'text-violet-300' : 'text-violet-700'}>{domain.score.toFixed(0)}%</strong>
              </div>
              <div className={`h-1.5 overflow-hidden rounded-full ${dark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                <div className="h-full rounded-full bg-violet-500" style={{ width: `${domain.score}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div className={compact ? 'h-[280px]' : 'h-[300px] sm:h-[420px]'}>
        {isMounted ? (
          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={280}>
            <RadarChart data={chartData} outerRadius={compact ? '64%' : '70%'}>
              <PolarGrid stroke={dark ? '#334155' : '#CBD5E1'} />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: dark ? '#CBD5E1' : '#475569', fontSize: compact ? 9 : 10, fontWeight: 500 }}
                tickFormatter={(value) => String(value).length > 22 ? `${String(value).slice(0, 20)}…` : String(value)}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tickCount={6}
                tick={{ fill: dark ? '#64748B' : '#94A3B8', fontSize: 9, fontWeight: 500 }}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip content={<CustomTooltip dark={dark} />} />
              <Radar
                name="Maestria"
                dataKey="score"
                stroke={RADAR_COLOR}
                fill={RADAR_COLOR}
                fillOpacity={0.25}
                strokeWidth={2}
              />
            </RadarChart>
          </SafeResponsiveContainer>
        ) : (
          <div className="h-full w-full animate-pulse rounded-3xl bg-slate-50" />
        )}
      </div>
      )}
    </div>
  );
};
