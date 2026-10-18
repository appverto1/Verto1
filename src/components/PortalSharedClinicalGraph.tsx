import React, { useEffect, useState } from 'react';
import { Line, LineChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { EvolutionBarChart } from './Charts';
import { CumulativeGrowthChart } from './CumulativeGrowthChart';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

type SharedGraph = {
  graphType: 'protocol_comparison' | 'mastery_growth' | 'clinical_metric';
  graphKey: string;
  title?: string;
  points?: { at:string; value:number }[];
};

// A null or failed authorized read means *no graph*. Never show legacy charts
// by default, even while the initial async request is pending or after F5.
export function PortalSharedClinicalGraph({
  patientId, protocols, protocolId, protocolChartData,
}: {
  patientId: string;
  protocols: any[];
  protocolId?: string;
  protocolChartData: any[];
}) {
  const [graph, setGraph] = useState<SharedGraph | null>(null);
  useEffect(() => {
    let live = true;
    setGraph(null);
    if (!patientId) return () => { live = false; };
    const controller = new AbortController();
    fetch(`/api/portal/patients/${encodeURIComponent(patientId)}/shared-graph`, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return null;
      const result = await response.json();
      return result?.success === true ? result?.data || null : null;
    }).then((shared) => {
      if (live) setGraph(shared);
    }).catch(() => {
      if (live) setGraph(null);
    });
    return () => { live = false; controller.abort(); };
  }, [patientId]);

  if (!graph) return null;
  if (graph.graphType === 'protocol_comparison') {
    return (
      <section aria-label="Gráfico clínico compartilhado" className="mb-6 rounded-[28px] border border-blue-100 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-3 text-sm font-semibold text-violet-700">Evolução compartilhada pela equipe</h2>
        <div className="min-h-[300px]"><EvolutionBarChart chartData={protocolChartData} maxScore={100} /></div>
      </section>
    );
  }
  if (graph.graphType === 'mastery_growth') {
    return (
      <section aria-label="Gráfico clínico compartilhado" className="mb-6">
        <CumulativeGrowthChart patientId={patientId} protocols={protocols} protocolId={protocolId} useCanonicalMastery portalMode />
      </section>
    );
  }
  if (graph.graphType !== 'clinical_metric') return null;
  const rows = (Array.isArray(graph.points) ? graph.points : [])
    .filter((point) => Number.isFinite(Number(point.value)) && !Number.isNaN(Date.parse(point.at)))
    .map((point) => ({
      date: new Date(point.at).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}),
      value: Number(point.value),
    }));
  return (
    <section aria-label="Gráfico clínico compartilhado" className="mb-6 rounded-[28px] border border-blue-100 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-sm font-semibold text-violet-700">{graph.title || 'Evolução compartilhada pela equipe'}</h2>
      {rows.length ? (
        <div className="h-[300px] min-w-0" role="img" aria-label={graph.title || 'Evolução clínica'}>
          <SafeResponsiveContainer width="100%" height="100%" minHeight={300}>
            <LineChart data={rows} margin={{top:12,right:22,left:0,bottom:12}}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{fontSize:11}} />
              <YAxis tick={{fontSize:11}} width={48} />
              <Tooltip />
              <Line type="monotone" dataKey="value" name="Resultado" stroke="#7a32fc" dot={{r:3}} strokeWidth={2} isAnimationActive={false}/>
            </LineChart>
          </SafeResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">Este gráfico ainda não possui medições disponíveis.</p>
      )}
    </section>
  );
}
