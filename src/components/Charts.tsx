import React, { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { BarChart2, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, LineChart, Line } from 'recharts';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

const parseDateFromLabel = (label: string): number => {
  if (!label) return Number.NaN;
  const direct = Date.parse(label);
  if (Number.isFinite(direct)) return direct;
  const match = label.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return Number.NaN;
  const [, dd, mm, yyyy] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd)).getTime();
};

const wrapAxisLabel = (value: any, maxCharsPerLine = 18) => {
  const words = String(value ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine || !current) {
      current = next;
      return;
    }
    lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  return lines.length ? lines : [''];
};

const WrappedXAxisTick = ({ x, y, payload, dark = false }: any) => {
  const lines = wrapAxisLabel(payload?.value, 20);

  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill={dark ? '#94A3B8' : '#64748B'} fontSize={10} fontWeight={600}>
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={0} dy={index === 0 ? 14 : 13}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
};

export const ComparisonBarChart = ({ data, title, maxScore = 1, emptyMessage = '' }: any) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  const safeData = Array.isArray(data) ? data.filter((row) => row && typeof row === 'object') : [];

  if (safeData.length === 0) {
    return (
      <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 mb-6 flex flex-col items-center justify-center py-10 opacity-50 italic text-gray-400">
        <BarChart2 size={32} className="mb-2" />
        <p className="text-xs text-center leading-relaxed">{emptyMessage || 'Selecione dois períodos com medições para comparar o progresso.'}</p>
      </div>
    );
  }

  const firstRow = safeData[0] || {};
  const rawPeriodKeys = Object.keys(firstRow).filter((key) => key !== 'name');
  const periodKeys = [...rawPeriodKeys].sort((a, b) => {
    const aTime = parseDateFromLabel(a);
    const bTime = parseDateFromLabel(b);
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
      return aTime - bTime;
    }
    return rawPeriodKeys.indexOf(a) - rawPeriodKeys.indexOf(b);
  });
  const safeMaxScore = Math.max(1, Number(maxScore) || 1);
  const yTicks =
    safeMaxScore === 100
      ? [0, 20, 40, 60, 80, 100]
      : safeMaxScore <= 10
        ? Array.from({ length: Math.floor(safeMaxScore) + 1 }, (_, i) => i)
        : Array.from({ length: 6 }, (_, i) => Math.round((safeMaxScore * i) / 5));
  
  // Calculate dynamic width based on number of labels to prevent crowding
  const minWidth = Math.max(980, safeData.length * Math.max(180, periodKeys.length * 90));
  const periodColors = periodKeys.length === 2
    ? ['#7a32fc', '#05CD99']
    : ['#7a32fc', '#05CD99', '#FFB547', '#7551FF', '#EE5D50', '#00C2FF'];

  return (
    <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 mb-6 animate-fade-in overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-2">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight flex items-center gap-2">
          <BarChart2 size={18} className="text-[#7a32fc]" /> {title || "Comparativo de Desempenho"}
        </h3>
        <div className="flex items-center gap-1 text-[10px] text-gray-400 font-bold uppercase">
          <Info size={12} /> {Number(maxScore) === 100 ? 'Eixo Y: Proficiência (%) • Eixo X: Domínios' : `Eixo Y: Pontuação (Máx: ${maxScore}) • Eixo X: Domínios`}
        </div>
      </div>
      <div className="overflow-x-auto pb-2 no-scrollbar">
        <div style={{ minWidth: `${minWidth}px`, height: '400px', minHeight: '400px' }} className="relative z-10 min-w-0 min-h-0">
          {isMounted ? (
          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={360}>
            <BarChart
              data={safeData}
              margin={{ top: 16, right: 24, left: 6, bottom: 92 }}
              barGap={12}
              barCategoryGap="30%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                interval={0}
                height={92}
                tickMargin={12}
                tick={<WrappedXAxisTick />}
                padding={{ left: 30, right: 30 }}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#7f93b8', fontSize: 12, fontWeight: 'bold' }}
                dx={-5}
                domain={[0, maxScore]}
                ticks={yTicks}
                width={52}
              />
            <Tooltip 
              cursor={{ fill: '#F8FAFC' }}
              contentStyle={{ 
                borderRadius: '16px', 
                border: 'none', 
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                fontSize: '11px',
                fontWeight: 'bold'
              }}
            />
            {periodKeys.map((period, index, array) => {
              // Chronological comparison order:
              // left/first = oldest (purple), right/second = newest (green).
              const fillColor = array.length === 2
                ? periodColors[index]
                : periodColors[index % periodColors.length];
              
              return (
                <Bar 
                  key={period} 
                  dataKey={period} 
                  fill={fillColor} 
                  radius={[6, 6, 0, 0]} 
                  maxBarSize={40}
                  minPointSize={5}
                />
              );
            })}
          </BarChart>
          </SafeResponsiveContainer>
          ) : (
            <div className="h-full w-full rounded-2xl bg-slate-50 animate-pulse" />
          )}
      </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 px-2">
        {periodKeys.map((period, index) => (
          <div key={`legend-${period}`} className="flex items-center gap-2 text-[11px] font-semibold text-gray-600">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: periodColors[index % periodColors.length] }} />
            <span>{period}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const EvolutionBarChart = ({
  chartData,
  maxScore = 1,
  title,
  description,
  headerAction,
  variant = 'default',
  dark = false
}: any) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  const labels = Array.isArray(chartData?.labels) ? chartData.labels : [];
  const datasets = Array.isArray(chartData?.datasets) ? chartData.datasets : [];
  const isPatientHistory = variant === 'patient-history';

  if (labels.length === 0 || datasets.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-2xl border p-6 py-10 text-center ${dark ? 'border-slate-700 bg-slate-900/60 text-slate-400' : 'border-slate-200 bg-white text-slate-500'}`}>
        <BarChart2 size={32} className="mb-2" />
        <p className="text-sm leading-6">Nenhum dado avaliado para comparação histórica neste protocolo.</p>
      </div>
    );
  }

  // Transform data for Recharts
  const data = labels.map((label: string, index: number) => {
    const entry: any = { name: label };
    datasets.forEach((ds: any) => {
      const dsLabel = String(ds?.label || '').trim();
      if (!dsLabel) return;
      const dsValues = Array.isArray(ds?.data) ? ds.data : [];
      entry[dsLabel] = dsValues[index] ?? null;
    });
    return entry;
  });

  const safeMaxScore = Math.max(1, Number(maxScore) || 1);
  const yTicks =
    safeMaxScore === 100
      ? [0, 20, 40, 60, 80, 100]
      : safeMaxScore <= 10
        ? Array.from({ length: Math.floor(safeMaxScore) + 1 }, (_, i) => i)
        : Array.from({ length: 6 }, (_, i) => Math.round((safeMaxScore * i) / 5));
  
  // Calculate dynamic width based on number of labels to prevent crowding
  const minWidth = isPatientHistory
    ? data.length <= 3
      ? '100%'
      : `${Math.max(620, data.length * 122)}px`
    : `${Math.max(980, data.length * 210)}px`;

  return (
    <div className={
      isPatientHistory
        ? `min-w-0 rounded-2xl border p-4 ${dark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`
        : 'relative mb-8 overflow-hidden rounded-[32px] border border-white/50 bg-white/70 p-4 shadow-sm backdrop-blur-md animate-fade-in sm:rounded-[40px] sm:p-8 chart-glow'
    }>
      {!isPatientHistory && <div className="absolute right-0 top-0 -z-0 h-32 w-32 rounded-bl-full bg-indigo-50/50 sm:h-48 sm:w-48"></div>}
      {(title || description || headerAction) && (
        <div className={`relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between ${isPatientHistory ? 'mb-4' : 'mb-6'}`}>
          <div>
            {title && (
              <h3 className={`flex items-center gap-2 font-semibold tracking-tight ${isPatientHistory ? 'text-base' : 'text-lg'} ${dark ? 'text-slate-100' : 'text-slate-900'}`}>
                <BarChart2 size={20} className="text-[#7a32fc]" />
                {title}
              </h3>
            )}
            {description && (
              <p className={`mt-1 max-w-2xl text-xs leading-5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                {description}
              </p>
            )}
          </div>
          {headerAction && <div className="w-full lg:w-auto">{headerAction}</div>}
        </div>
      )}
      
      <div className="relative z-10">
        <div className={`overflow-x-auto pb-2 scrollbar-hide no-scrollbar ${isPatientHistory ? '' : 'cursor-grab active:cursor-grabbing'}`}>
          <div
            style={{
              minWidth,
              height: isPatientHistory ? '240px' : '430px',
              minHeight: isPatientHistory ? '220px' : '390px'
            }}
            className="relative min-h-0 min-w-0"
          >
            {isMounted ? (
            <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={isPatientHistory ? 210 : 330}>
              <BarChart
                data={data}
                margin={{ top: 12, right: 20, left: 0, bottom: isPatientHistory ? 50 : 96 }}
                barGap={12}
                barCategoryGap="35%"
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={dark ? '#1E293B' : '#F1F5F9'} />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  interval={0}
                  height={isPatientHistory ? 50 : 96}
                  tickMargin={12}
                  tick={<WrappedXAxisTick dark={dark} />}
                  padding={{ left: 40, right: 40 }}
                />
                <YAxis 
                  width={48}
                  domain={[0, safeMaxScore]}
                  ticks={yTicks}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: dark ? '#64748B' : '#8ba0c5', fontSize: 11, fontWeight: 600 }}
                  tickFormatter={(value) => safeMaxScore === 100 ? `${value}%` : `${value}`}
                />
                <Tooltip 
                  cursor={{ fill: '#F8FAFC' }}
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: 'none', 
                    background: dark ? '#0F172A' : '#FFFFFF',
                    color: dark ? '#E2E8F0' : '#334155',
                    boxShadow: '0 8px 20px -8px rgba(15, 23, 42, 0.24)',
                    fontSize: '11px',
                    fontWeight: 'bold'
                  }}
                />
                {datasets.map((ds: any, index: number) => {
                  const colors = ['#7a32fc', '#05CD99', '#FFB547', '#7551FF', '#EE5D50', '#00C2FF'];
                  return (
                    <Bar 
                      key={ds.label} 
                      dataKey={ds.label} 
                      fill={ds.borderColor || colors[index % colors.length]} 
                      radius={[6, 6, 0, 0]} 
                      maxBarSize={40}
                      minPointSize={5}
                      animationDuration={1500}
                    />
                  );
                })}
              </BarChart>
            </SafeResponsiveContainer>
            ) : (
              <div className="h-full w-full rounded-2xl bg-slate-50 animate-pulse" />
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 px-2">
        {datasets.map((ds: any, index: number) => {
          const colors = ['#7a32fc', '#05CD99', '#FFB547', '#7551FF', '#EE5D50', '#00C2FF'];
          const legendColor = ds.borderColor || colors[index % colors.length];
          return (
            <div key={`legend-bar-${ds.label}-${index}`} className={`flex items-center gap-2 text-[11px] font-medium ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: legendColor }} />
              <span>{ds.label}</span>
            </div>
          );
        })}
      </div>
      
      {isPatientHistory && data.length > 3 && (
        <div className={`mt-2 flex items-center justify-center gap-2 text-xs sm:hidden ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          <span>Deslize para ver todos os domínios</span>
          <span aria-hidden="true">→</span>
        </div>
      )}
      {!isPatientHistory && data.length > 5 && (
        <div className="mt-2 flex animate-pulse items-center justify-center gap-2 text-[10px] font-bold uppercase text-gray-400">
          <span>Arraste para o lado para ver mais</span>
          <div className="relative h-1 w-8 overflow-hidden rounded-full bg-gray-200">
            <div className="absolute inset-y-0 left-0 w-1/2 bg-[#7a32fc] animate-slide-infinite"></div>
          </div>
        </div>
      )}
    </div>
  );
};

export const EvolutionLineChart = ({ chartData, maxScore = 1 }: any) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  const labels = Array.isArray(chartData?.labels) ? chartData.labels : [];
  const datasets = Array.isArray(chartData?.datasets) ? chartData.datasets : [];

  if (labels.length === 0 || datasets.length === 0) {
    return (
      <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 mb-6 flex flex-col items-center justify-center py-10 opacity-50 italic text-gray-400">
        <BarChart2 size={32} className="mb-2" />
        <p className="text-xs text-center leading-relaxed">Nenhum dado avaliado para comparaÃ§Ã£o histÃ³rica neste protocolo.</p>
      </div>
    );
  }

  // Transform data for Recharts
  const data = labels.map((label: string, index: number) => {
    const entry: any = { name: label };
    datasets.forEach((ds: any) => {
      const dsLabel = String(ds?.label || '').trim();
      if (!dsLabel) return;
      const dsValues = Array.isArray(ds?.data) ? ds.data : [];
      entry[dsLabel] = dsValues[index] ?? 0;
    });
    return entry;
  });

  const yTicks = Array.from({ length: Math.floor(maxScore) + 1 }, (_, i) => i);

  // Calculate dynamic width based on number of labels to prevent crowding
  const minWidth = Math.max(980, data.length * 180);

  return (
    <div className="bg-white/70 backdrop-blur-md p-4 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-white/50 mb-8 animate-fade-in relative overflow-hidden chart-glow">
      <div className="absolute top-0 right-0 w-32 sm:w-48 h-32 sm:h-48 bg-indigo-50/50 rounded-bl-full -z-0"></div>
      <div className="overflow-x-auto pb-3 no-scrollbar">
        <div style={{ minWidth: `${minWidth}px`, height: '390px', minHeight: '360px' }} className="relative z-10 min-w-0 min-h-0">
          {isMounted ? (
          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
            <LineChart
              data={data}
              margin={{ top: 16, right: 28, left: 4, bottom: 56 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                interval={0}
                angle={-30}
                textAnchor="end"
                height={56}
                tickMargin={10}
                tick={{ fill: '#A3AED0', fontSize: 10, fontWeight: 'bold' }}
                padding={{ left: 30, right: 30 }}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#A3AED0', fontSize: 10, fontWeight: 'bold' }}
                dx={-5}
                domain={[0, maxScore]}
                ticks={yTicks}
              />
            <Tooltip 
              contentStyle={{ 
                borderRadius: '16px', 
                border: 'none', 
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                fontSize: '11px',
                fontWeight: 'bold'
              }}
            />
            {datasets.map((ds: any, index: number) => (
              <Line
                key={ds.label}
                type="monotone"
                dataKey={ds.label}
                stroke={ds.borderColor || '#7a32fc'}
                strokeWidth={4}
                dot={{ r: 6, fill: ds.borderColor || '#7a32fc', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 8, strokeWidth: 0 }}
                animationDuration={1500}
              />
            ))}
          </LineChart>
          </SafeResponsiveContainer>
          ) : (
            <div className="h-full w-full rounded-2xl bg-slate-50 animate-pulse" />
          )}
      </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 px-2">
        {datasets.map((ds: any, index: number) => {
          const legendColor = ds.borderColor || '#7a32fc';
          return (
            <div key={`legend-line-${ds.label}-${index}`} className="flex items-center gap-2 text-[11px] font-semibold text-gray-600">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: legendColor }} />
              <span>{ds.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};





