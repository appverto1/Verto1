import React, { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { BarChart2, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, LineChart, Line } from 'recharts';

const CustomXAxisTick = (props: any) => {
  const { x, y, payload } = props;
  const words = payload.value.split(' ');
  
  if (words.length <= 2) {
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={16}
          textAnchor="end"
          fill="#A3AED0"
          fontSize={10}
          fontWeight="bold"
          transform="rotate(-45)"
        >
          {payload.value}
        </text>
      </g>
    );
  }

  const line1 = words.slice(0, 2).join(' ');
  const line2 = words.slice(2).join(' ');

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={16}
        textAnchor="end"
        fill="#A3AED0"
        fontSize={10}
        fontWeight="bold"
        transform="rotate(-45)"
      >
        <tspan x={0} dy="0">{line1}</tspan>
        <tspan x={0} dy="1.2em">{line2}</tspan>
      </text>
    </g>
  );
};

export const ComparisonBarChart = ({ data, title, maxScore = 1 }: any) => {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 mb-6 flex flex-col items-center justify-center py-10 opacity-50 italic text-gray-400">
        <BarChart2 size={32} className="mb-2" />
        <p className="text-xs text-center leading-relaxed">Selecione períodos para comparar o progresso.</p>
      </div>
    );
  }

  const yTicks = Array.from({ length: Math.floor(maxScore) + 1 }, (_, i) => i);
  
  // Calculate dynamic width based on number of labels to prevent crowding
  const minWidth = Math.max(600, data.length * 120);

  return (
    <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 mb-6 animate-fade-in overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-2">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight flex items-center gap-2">
          <BarChart2 size={18} className="text-[#4318FF]" /> {title || "Comparativo de Desempenho"}
        </h3>
        <div className="flex items-center gap-1 text-[10px] text-gray-400 font-bold uppercase">
          <Info size={12} /> Eixo Y: Pontuação (Máx: {maxScore}) • Eixo X: Domínios
        </div>
      </div>
      <div className="overflow-x-auto pb-4 no-scrollbar">
        <div style={{ minWidth: `${minWidth}px`, height: '500px' }} className="relative z-10">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 10, right: 30, left: 0, bottom: 150 }}
              barGap={12}
              barCategoryGap="30%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                interval={0}
                tick={<CustomXAxisTick />}
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
              cursor={{ fill: '#F8FAFC' }}
              contentStyle={{ 
                borderRadius: '16px', 
                border: 'none', 
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                fontSize: '11px',
                fontWeight: 'bold'
              }}
            />
            <Legend 
              verticalAlign="bottom" 
              align="center"
              iconType="circle"
              wrapperStyle={{ 
                paddingTop: '80px', 
                fontSize: '10px', 
                fontWeight: 'bold', 
                color: '#4A5568',
                width: '100%'
              }}
            />
            {Object.keys(data[0]).filter(key => key !== 'name').map((period, index, array) => {
              // If we have exactly 2 periods, use Red for the first (oldest) and Green for the second (newest)
              // Otherwise use the standard palette
              const colors = array.length === 2 
                ? ['#EE5D50', '#05CD99'] 
                : ['#4318FF', '#05CD99', '#FFB547', '#7551FF', '#EE5D50', '#00C2FF'];
              
              const fillColor = array.length === 2 ? colors[index] : colors[index % colors.length];
              
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
        </ResponsiveContainer>
      </div>
    </div>
  </div>
  );
};

export const EvolutionBarChart = ({ chartData, maxScore = 1 }: any) => {
  if (!chartData || !chartData.labels || chartData.labels.length === 0) {
    return (
      <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 mb-6 flex flex-col items-center justify-center py-10 opacity-50 italic text-gray-400">
        <BarChart2 size={32} className="mb-2" />
        <p className="text-xs text-center leading-relaxed">Nenhum dado avaliado para comparação histórica neste protocolo.</p>
      </div>
    );
  }

  // Transform data for Recharts
  const data = chartData.labels.map((label: string, index: number) => {
    const entry: any = { name: label };
    chartData.datasets.forEach((ds: any) => {
      entry[ds.label] = ds.data[index];
    });
    return entry;
  });

  const yTicks = Array.from({ length: Math.floor(maxScore) + 1 }, (_, i) => i);
  
  // Calculate dynamic width based on number of labels to prevent crowding
  const minWidth = Math.max(600, data.length * 120);

  return (
    <div className="bg-white/70 backdrop-blur-md p-4 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-white/50 mb-8 animate-fade-in relative overflow-hidden chart-glow">
      <div className="absolute top-0 right-0 w-32 sm:w-48 h-32 sm:h-48 bg-indigo-50/50 rounded-bl-full -z-0"></div>
      
      <div className="overflow-x-auto pb-4 no-scrollbar cursor-grab active:cursor-grabbing">
        <div style={{ minWidth: `${minWidth}px`, height: '500px' }} className="relative z-10">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 10, right: 30, left: 0, bottom: 150 }}
              barGap={12}
              barCategoryGap="35%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                interval={0}
                tick={<CustomXAxisTick />}
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
                cursor={{ fill: '#F8FAFC' }}
                contentStyle={{ 
                  borderRadius: '16px', 
                  border: 'none', 
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  fontSize: '11px',
                  fontWeight: 'bold'
                }}
              />
              <Legend 
                verticalAlign="bottom" 
                align="center"
                iconType="circle"
                wrapperStyle={{ 
                  paddingTop: '80px', 
                  fontSize: '10px', 
                  fontWeight: 'bold', 
                  color: '#4A5568',
                  width: '100%'
                }}
              />
              {chartData.datasets.map((ds: any, index: number) => {
                const colors = ['#4318FF', '#05CD99', '#FFB547', '#7551FF', '#EE5D50', '#00C2FF'];
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
          </ResponsiveContainer>
        </div>
      </div>
      
      {data.length > 5 && (
        <div className="flex justify-center items-center gap-2 mt-2 text-[10px] text-gray-400 font-bold uppercase animate-pulse">
          <span>Arraste para o lado para ver mais</span>
          <div className="w-8 h-1 bg-gray-200 rounded-full relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-1/2 bg-[#4318FF] animate-slide-infinite"></div>
          </div>
        </div>
      )}
    </div>
  );
};

export const EvolutionLineChart = ({ chartData, maxScore = 1 }: any) => {
  if (!chartData || !chartData.labels || chartData.labels.length === 0) {
    return (
      <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 mb-6 flex flex-col items-center justify-center py-10 opacity-50 italic text-gray-400">
        <BarChart2 size={32} className="mb-2" />
        <p className="text-xs text-center leading-relaxed">Nenhum dado avaliado para comparação histórica neste protocolo.</p>
      </div>
    );
  }

  // Transform data for Recharts
  const data = chartData.labels.map((label: string, index: number) => {
    const entry: any = { name: label };
    chartData.datasets.forEach((ds: any) => {
      entry[ds.label] = ds.data[index];
    });
    return entry;
  });

  const yTicks = Array.from({ length: Math.floor(maxScore) + 1 }, (_, i) => i);

  // Calculate dynamic width based on number of labels to prevent crowding
  const minWidth = Math.max(600, data.length * 120);

  return (
    <div className="bg-white/70 backdrop-blur-md p-4 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-white/50 mb-8 animate-fade-in relative overflow-hidden chart-glow">
      <div className="absolute top-0 right-0 w-32 sm:w-48 h-32 sm:h-48 bg-indigo-50/50 rounded-bl-full -z-0"></div>
      <div className="overflow-x-auto pb-4 no-scrollbar">
        <div style={{ minWidth: `${minWidth}px`, height: '500px' }} className="relative z-10">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 10, right: 30, left: 0, bottom: 150 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                interval={0}
                tick={<CustomXAxisTick />}
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
            <Legend 
              verticalAlign="bottom" 
              align="center"
              iconType="circle"
              wrapperStyle={{ 
                paddingTop: '80px', 
                fontSize: '10px', 
                fontWeight: 'bold', 
                color: '#4A5568',
                width: '100%'
              }}
            />
            {chartData.datasets.map((ds: any, index: number) => (
              <Line
                key={ds.label}
                type="monotone"
                dataKey={ds.label}
                stroke={ds.borderColor || '#4318FF'}
                strokeWidth={4}
                dot={{ r: 6, fill: ds.borderColor || '#4318FF', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 8, strokeWidth: 0 }}
                animationDuration={1500}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  </div>
  );
};
