import React, { useMemo, useState } from 'react';
import { BarChart3, BrainCircuit } from 'lucide-react';
import { AbaClinicalChartsPanel } from './AbaClinicalChartsPanel';
import { AbaV3ClinicalChartPanel } from './AbaV3ClinicalChartPanel';
import { ClinicalMeasurementV3Panel } from './ClinicalMeasurementV3Panel';
import { ClinicalOutcomesDashboard } from './ClinicalOutcomesDashboard';
import { RadarDomainAssessmentChart } from './RadarDomainAssessmentChart';
import { CumulativeGrowthChart } from './CumulativeGrowthChart';

type ClinicalChartsWorkspaceProps = {
  patientId: string;
  organizationId?: string | null;
  isPanelDark?: boolean;
  showAbaDetails?: boolean;
  showAbaV3Details?: boolean;
  showClinicalMeasurementV3Details?: boolean;
  onOpenSessionReport?: (sessionId: string) => void;
  protocols?: any[];
  history?: any[];
};

export function ClinicalChartsWorkspace({ patientId, organizationId = null, isPanelDark = false, showAbaDetails = false, showAbaV3Details = false, showClinicalMeasurementV3Details = false, onOpenSessionReport, protocols = [], history = [] }: ClinicalChartsWorkspaceProps) {
  const [view, setView] = useState<'plans' | 'aba' | 'aba-v3' | 'clinical-v3'>('plans');
  const [legacyProtocolId, setLegacyProtocolId] = useState('all');

  const legacyEvaluationProtocols = useMemo(() => (
    (Array.isArray(protocols) ? protocols : [])
      .filter((protocol: any) => (protocol?.category === 'evaluation' || !protocol?.category) && Array.isArray(protocol?.data) && protocol.data.length > 0)
  ), [protocols]);

  const legacyProtocolSkillKeys = useMemo(() => {
    const keys = new Set<string>();
    legacyEvaluationProtocols.forEach((protocol: any) => {
      (Array.isArray(protocol?.data) ? protocol.data : []).forEach((domain: any) => {
        (Array.isArray(domain?.skills) ? domain.skills : []).forEach((skill: any) => {
          const key = String(skill?.name || skill?.title || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
          if (key) keys.add(key);
        });
      });
    });
    return keys;
  }, [legacyEvaluationProtocols]);

  const legacyProtocolHistory = useMemo(() => (
    (Array.isArray(history) ? history : []).filter((row: any) => {
      const rowPatientId = String(row?.patientId || row?.patient_id || '').trim();
      if (rowPatientId !== String(patientId || '').trim()) return false;

      const type = String(row?.type || row?.task_type || row?.taskType || '').trim().toLowerCase();
      const category = String(
        row?.protocolCategory ||
        row?.protocol_category ||
        row?.task_data?.protocolCategory ||
        row?.task_data?.protocol_category ||
        ''
      ).trim().toLowerCase();
      if (type === 'intervention' || type === 'reinforcement' || category === 'intervention' || category === 'reinforcement') return false;

      const protocolId = String(row?.protocol_id || row?.protocolId || row?.task_data?.protocol_id || row?.task_data?.protocolId || '').trim();
      const titleKey = String(row?.title || row?.taskTitle || row?.task_data?.title || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

      return Boolean(protocolId || (titleKey && legacyProtocolSkillKeys.has(titleKey)));
    })
  ), [history, legacyProtocolSkillKeys, patientId]);
  return (
    <div className="space-y-4" data-testid="clinical-charts-workspace">
      {(showAbaDetails || showAbaV3Details || showClinicalMeasurementV3Details) && (
        <div role="group" aria-label="Visualização clínica" className={`flex w-full flex-wrap gap-1 rounded-2xl border p-1.5 sm:w-auto ${isPanelDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50/80'}`}>
          <button type="button" aria-pressed={view === 'plans'} onClick={() => setView('plans')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:flex-none ${view === 'plans' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}><BarChart3 size={16} /> Planos e PTS</button>
          {showAbaDetails && <button type="button" aria-pressed={view === 'aba'} onClick={() => setView('aba')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:flex-none ${view === 'aba' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}><BrainCircuit size={16} /> ABA Legacy</button>}
          {showAbaV3Details && <button type="button" aria-pressed={view === 'aba-v3'} onClick={() => setView('aba-v3')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:flex-none ${view === 'aba-v3' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}><BrainCircuit size={16} /> ABA V3</button>}
          {showClinicalMeasurementV3Details && <button type="button" aria-pressed={view === 'clinical-v3'} onClick={() => setView('clinical-v3')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:flex-none ${view === 'clinical-v3' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}><BarChart3 size={16} /> Métricas V3</button>}
        </div>
      )}
      {view === 'aba' && showAbaDetails
        ? (
          <section className="space-y-4" data-testid="aba-legacy-protocol-applications">
            <div className={`rounded-2xl border p-4 ${isPanelDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className={`text-base font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-900'}`}>Aplicações de protocolos</h3>
                  <p className={`mt-1 text-xs leading-5 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Resultados de protocolos de avaliação aplicados ao paciente. Intervenções do plano individual não entram nesta leitura.
                  </p>
                </div>
                {legacyEvaluationProtocols.length > 1 && (
                  <label className={`text-xs font-medium ${isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}>
                    Protocolo
                    <select
                      value={legacyProtocolId}
                      onChange={(event) => setLegacyProtocolId(event.target.value)}
                      className={`ml-2 h-10 rounded-xl border px-3 text-sm outline-none ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-700'}`}
                    >
                      <option value="all">Todos</option>
                      {legacyEvaluationProtocols.map((protocol: any, index: number) => (
                        <option key={String(protocol?.id || protocol?.title || index)} value={String(protocol?.id || protocol?.title || index)}>
                          {String(protocol?.title || protocol?.name || `Protocolo ${index + 1}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
              <RadarDomainAssessmentChart
                patientId={patientId}
                protocols={legacyEvaluationProtocols}
                history={legacyProtocolHistory}
                protocolId={legacyProtocolId}
                compact
                dark={isPanelDark}
              />
              <CumulativeGrowthChart
                patientId={patientId}
                protocols={legacyEvaluationProtocols}
                history={legacyProtocolHistory}
                protocolId={legacyProtocolId}
                compact
                dark={isPanelDark}
              />
            </div>
          </section>
        )
        : view === 'aba-v3' && showAbaV3Details
          ? <AbaV3ClinicalChartPanel patientId={patientId} organizationId={organizationId} isPanelDark={isPanelDark} />
          : view === 'clinical-v3' && showClinicalMeasurementV3Details
            ? <ClinicalMeasurementV3Panel patientId={patientId} organizationId={organizationId} isPanelDark={isPanelDark} />
            : <ClinicalOutcomesDashboard patientId={patientId} organizationId={organizationId} isPanelDark={isPanelDark} onOpenSessionReport={onOpenSessionReport} />}
    </div>
  );
}
