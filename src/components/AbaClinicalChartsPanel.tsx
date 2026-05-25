import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { BarChart3, Filter, Plus, Save, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';
import { dataService } from '../services/dataService';

type AbaClinicalChartsPanelProps = {
  patientId: string;
  isPanelDark?: boolean;
};

const chartTabs = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'targets', label: 'Habilidades' },
  { id: 'behaviors', label: 'Comportamentos' },
  { id: 'mastery', label: 'Maestria' },
  { id: 'maintenance', label: 'Manutenção' },
  { id: 'session-changes', label: 'Mudanças por sessão' }
] as const;

const metricLabels: Record<string, string> = {
  TARGET_ACCURACY: 'Acurácia',
  TARGET_INDEPENDENCE: 'Independência',
  TARGET_TRIAL_COUNT: 'Tentativas',
  BEHAVIOR_FREQUENCY: 'Frequência',
  BEHAVIOR_DURATION_TOTAL: 'Duração total',
  BEHAVIOR_DURATION_AVG: 'Duração média',
  BEHAVIOR_INTERVAL_OCCURRENCE: 'Ocorrência por intervalo',
  MASTERY_STATUS: 'Status de maestria',
  MAINTENANCE_STATUS: 'Status de manutenção'
};

const statusTone = (status: string) => {
  if (status === 'REGRESSION_SIGNAL') return 'bg-red-50 text-red-700 border-red-100';
  if (status === 'CLINICALLY_SIGNIFICANT_CHANGE') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'CHANGED') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (status === 'FIRST_MEASUREMENT') return 'bg-slate-50 text-slate-600 border-slate-100';
  return 'bg-gray-50 text-gray-600 border-gray-100';
};

const formatDate = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const formatDateTime = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const formatValue = (value: any, metricType?: string) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (String(metricType || '').includes('DURATION')) return `${Math.round(numeric)}s`;
  if (String(metricType || '').includes('STATUS')) return String(Math.round(numeric));
  return `${Math.round(numeric * 10) / 10}${String(metricType || '').includes('COUNT') || String(metricType || '').includes('FREQUENCY') ? '' : '%'}`;
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="max-w-[280px] rounded-2xl border border-slate-100 bg-white p-4 text-xs shadow-xl">
      <p className="font-black uppercase tracking-widest text-slate-900">{formatDateTime(row.changedAt)}</p>
      <p className="mt-2 font-bold text-slate-700">{row.metricLabel}</p>
      <div className="mt-3 space-y-1 text-slate-500">
        <p>Métrica: {metricLabels[row.metricType] || row.metricType}</p>
        <p>Valor: {formatValue(row.value, row.metricType)}</p>
        <p>Anterior: {formatValue(row.previousValue, row.metricType)}</p>
        <p>Delta: {row.deltaPercent === null || row.deltaPercent === undefined ? '-' : `${Number(row.deltaPercent).toFixed(1)}%`}</p>
        <p>Sessão: {row.sessionId || '-'}</p>
      </div>
      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 font-bold text-slate-700">{row.statusLabel || 'Estável'}</p>
    </div>
  );
};

const EmptyState = ({ text }: { text: string }) => (
  <div className="flex min-h-[260px] items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center">
    <p className="max-w-sm text-sm font-semibold text-slate-400">{text}</p>
  </div>
);

export function AbaClinicalChartsPanel({ patientId, isPanelDark = false }: AbaClinicalChartsPanelProps) {
  const [activeTab, setActiveTab] = useState<(typeof chartTabs)[number]['id']>('overview');
  const [periodDays, setPeriodDays] = useState(30);
  const [targetId, setTargetId] = useState('');
  const [behaviorId, setBehaviorId] = useState('');
  const [metricType, setMetricType] = useState('');
  const [significantOnly, setSignificantOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [dataByTab, setDataByTab] = useState<Record<string, any>>({});
  const [loadingTab, setLoadingTab] = useState('');
  const [error, setError] = useState('');
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState({
    annotationType: 'NOTE',
    label: '',
    value: '',
    date: new Date().toISOString().slice(0, 10)
  });

  const loadChart = async (tab: string) => {
    if (!patientId) return;
    setLoadingTab(tab);
    setError('');
    try {
      const result = await dataService.getAbaClinicalChart(patientId, tab as any, {
        days: periodDays,
        targetId,
        behaviorId,
        metricType,
        significantOnly,
        limit: 120
      });
      setDataByTab((current) => ({
        ...current,
        [tab]: result?.data || { points: [], insights: [], annotations: [] }
      }));
    } catch (chartError) {
      console.error('Erro ao carregar gráficos ABA:', chartError);
      setError('Não foi possível carregar os gráficos ABA agora.');
    } finally {
      setLoadingTab('');
    }
  };

  useEffect(() => {
    void loadChart('overview');
  }, [patientId, periodDays, targetId, behaviorId, metricType, significantOnly]);

  useEffect(() => {
    if (activeTab !== 'overview') void loadChart(activeTab);
  }, [activeTab, patientId, periodDays, targetId, behaviorId, metricType, significantOnly]);

  const overview = dataByTab.overview || {};
  const activeData = dataByTab[activeTab] || {};
  const activePoints = Array.isArray(activeData.points) ? activeData.points : [];
  const allKnownPoints = [
    ...(Array.isArray(overview.points) ? overview.points : []),
    ...activePoints
  ];

  const targetOptions = useMemo(() => {
    const map = new Map<string, string>();
    allKnownPoints.forEach((point: any) => {
      if (point?.targetId) map.set(String(point.targetId), String(point.metricLabel || point.targetId));
    });
    return Array.from(map.entries());
  }, [allKnownPoints]);

  const behaviorOptions = useMemo(() => {
    const map = new Map<string, string>();
    allKnownPoints.forEach((point: any) => {
      if (point?.behaviorId) map.set(String(point.behaviorId), String(point.metricLabel || point.behaviorId));
    });
    return Array.from(map.entries());
  }, [allKnownPoints]);

  const chartRows = useMemo(() => {
    return activePoints
      .map((point: any, index: number) => ({
        ...point,
        x: `${formatDate(point.changedAt)} #${index + 1}`,
        value: Number(point.value ?? point.metricValue ?? 0)
      }))
      .sort((a: any, b: any) => new Date(a.changedAt || 0).getTime() - new Date(b.changedAt || 0).getTime());
  }, [activePoints]);

  const insights = Array.isArray(overview.insights) ? overview.insights : [];
  const annotations = Array.isArray(activeData.annotations) ? activeData.annotations : [];
  const isLoading = loadingTab === activeTab || (activeTab === 'overview' && loadingTab === 'overview');
  const showBar = activeTab === 'behaviors' || activeTab === 'maintenance' || activeTab === 'mastery';

  const emptyText = activeTab === 'overview'
    ? 'Ainda não há sessões suficientes para detectar mudança.'
    : activePoints.length === 1
      ? 'Primeira medição registrada. A comparação aparecerá após a próxima sessão.'
      : 'Sem dados no período selecionado.';

  const resetFilters = () => {
    setTargetId('');
    setBehaviorId('');
    setMetricType('');
    setSignificantOnly(false);
  };

  const saveAnnotation = async () => {
    if (!annotationDraft.label.trim()) return;
    const result = await dataService.saveAbaGraphAnnotation(patientId, {
      chartType: activeTab,
      annotationType: annotationDraft.annotationType,
      label: annotationDraft.label,
      value: annotationDraft.value,
      date: `${annotationDraft.date}T12:00:00.000Z`,
      targetId: targetId || undefined,
      behaviorId: behaviorId || undefined
    });
    if (result?.success) {
      setAnnotationDraft({ annotationType: 'NOTE', label: '', value: '', date: new Date().toISOString().slice(0, 10) });
      setAnnotationOpen(false);
      void loadChart(activeTab);
    }
  };

  const Filters = (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Período</label>
        <div className="grid grid-cols-3 rounded-2xl bg-slate-100 p-1">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setPeriodDays(days)}
              className={`rounded-xl px-3 py-2 text-xs font-bold ${periodDays === days ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Target</label>
        <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none">
          <option value="">Todos</option>
          {targetOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Comportamento</label>
        <select value={behaviorId} onChange={(event) => setBehaviorId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none">
          <option value="">Todos</option>
          {behaviorOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Métrica</label>
        <select value={metricType} onChange={(event) => setMetricType(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none">
          <option value="">Todas</option>
          {Object.entries(metricLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <label className="flex min-h-[44px] flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={significantOnly} onChange={(event) => setSignificantOnly(event.target.checked)} />
          Significativas
        </label>
        <button type="button" onClick={resetFilters} className="rounded-2xl bg-slate-100 p-3 text-slate-500" title="Limpar filtros">
          <X size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <div className={`space-y-5 rounded-[32px] border p-4 shadow-sm sm:p-6 ${isPanelDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-100 bg-white'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#7a32fc]/10 text-[#7a32fc]">
            <BarChart3 size={22} />
          </div>
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-[0.22em] ${isPanelDark ? 'text-violet-200' : 'text-[#7a32fc]'}`}>Gráficos ABA</p>
            <h3 className={`text-xl font-semibold tracking-tight ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>Mudanças clínicas por sessão</h3>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setFilterOpen(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-xs font-bold text-slate-600 md:hidden">
            <Filter size={16} /> Filtros
          </button>
          <button type="button" onClick={() => setAnnotationOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-3 text-xs font-bold text-white">
            <Plus size={16} /> Anotação
          </button>
        </div>
      </div>

      <div className="hidden md:block">{Filters}</div>

      {filterOpen && (
        <div className="fixed inset-0 z-[140] flex items-end bg-black/30 p-3 md:hidden">
          <div className="w-full rounded-[28px] bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">Filtros</p>
              <button type="button" onClick={() => setFilterOpen(false)} className="rounded-xl bg-slate-100 p-2 text-slate-500"><X size={16} /></button>
            </div>
            {Filters}
          </div>
        </div>
      )}

      {annotationOpen && (
        <div className="grid grid-cols-1 gap-3 rounded-3xl border border-slate-100 bg-slate-50 p-4 md:grid-cols-[180px_1fr_140px_160px_auto]">
          <select value={annotationDraft.annotationType} onChange={(event) => setAnnotationDraft((draft) => ({ ...draft, annotationType: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none">
            <option value="NOTE">Nota</option>
            <option value="GOAL_LINE">Linha de meta</option>
            <option value="CONDITION_LINE">Linha de condição</option>
          </select>
          <input value={annotationDraft.label} onChange={(event) => setAnnotationDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="Mudança de protocolo" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none" />
          <input value={annotationDraft.value} onChange={(event) => setAnnotationDraft((draft) => ({ ...draft, value: event.target.value }))} placeholder="Valor" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none" />
          <input type="date" value={annotationDraft.date} onChange={(event) => setAnnotationDraft((draft) => ({ ...draft, date: event.target.value }))} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none" />
          <button type="button" onClick={() => void saveAnnotation()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-bold text-white">
            <Save size={15} /> Salvar
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {(insights.length ? insights : ['Ainda não há sessões suficientes para detectar mudança.']).map((insight: string, index: number) => (
          <div key={`${insight}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <Sparkles size={16} className="mb-3 text-[#7a32fc]" />
            <p className="text-xs font-semibold leading-relaxed text-slate-700">{insight}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-2xl bg-slate-100 p-1">
        {chartTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 rounded-xl px-4 py-2 text-xs font-bold transition-all ${activeTab === tab.id ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-700">{error}</div>}

      {isLoading ? (
        <div className="h-[360px] animate-pulse rounded-3xl bg-slate-50" />
      ) : chartRows.length > 0 ? (
        <div className="rounded-3xl border border-slate-100 bg-white p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">{chartTabs.find((tab) => tab.id === activeTab)?.label}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{chartRows.length} ponto(s)</p>
            </div>
            <SlidersHorizontal size={18} className="text-slate-300" />
          </div>
          <div className="h-[360px] min-w-0">
            <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320}>
              {showBar ? (
                <BarChart data={chartRows} margin={{ top: 20, right: 24, left: 0, bottom: 44 }}>
                  <CartesianGrid stroke="#EEF2F7" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="x" tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} angle={-18} textAnchor="end" height={58} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 700 }} />
                  <Tooltip content={<CustomTooltip />} />
                  {annotations.filter((annotation: any) => annotation.annotation_type === 'GOAL_LINE' && annotation.value !== null).map((annotation: any) => (
                    <ReferenceLine key={annotation.id} y={Number(annotation.value)} stroke="#10B981" strokeDasharray="4 4" label={annotation.label} />
                  ))}
                  <Bar dataKey="value" fill="#7a32fc" radius={[8, 8, 0, 0]} maxBarSize={52} />
                </BarChart>
              ) : (
                <LineChart data={chartRows} margin={{ top: 20, right: 24, left: 0, bottom: 44 }}>
                  <CartesianGrid stroke="#EEF2F7" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="x" tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} angle={-18} textAnchor="end" height={58} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 700 }} />
                  <Tooltip content={<CustomTooltip />} />
                  {annotations.filter((annotation: any) => annotation.annotation_type === 'GOAL_LINE' && annotation.value !== null).map((annotation: any) => (
                    <ReferenceLine key={annotation.id} y={Number(annotation.value)} stroke="#10B981" strokeDasharray="4 4" label={annotation.label} />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#7a32fc"
                    strokeWidth={3}
                    dot={(props: any) => {
                      const row = props?.payload || {};
                      const important = row.changeStatus === 'REGRESSION_SIGNAL' || row.changeStatus === 'CLINICALLY_SIGNIFICANT_CHANGE' || row.trendDirection === 'IMPROVED' || row.trendDirection === 'WORSENED';
                      return <circle cx={props.cx} cy={props.cy} r={important ? 6 : 4} fill={important ? '#F97316' : '#7a32fc'} stroke="#fff" strokeWidth={2} />;
                    }}
                    activeDot={{ r: 7 }}
                  />
                </LineChart>
              )}
            </SafeResponsiveContainer>
          </div>
        </div>
      ) : (
        <EmptyState text={emptyText} />
      )}

      {chartRows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {chartRows.slice(-6).reverse().map((point: any) => (
            <div key={`${point.id}-${point.metricType}`} className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${statusTone(point.changeStatus)}`}>
                  {point.statusLabel}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{formatDateTime(point.changedAt)}</span>
              </div>
              <p className="text-sm font-bold text-slate-900">{point.metricLabel}</p>
              <p className="mt-1 text-xs text-slate-500">
                {metricLabels[point.metricType] || point.metricType}: {formatValue(point.value, point.metricType)} · anterior {formatValue(point.previousValue, point.metricType)} · delta {point.deltaPercent === null || point.deltaPercent === undefined ? '-' : `${Number(point.deltaPercent).toFixed(1)}%`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
