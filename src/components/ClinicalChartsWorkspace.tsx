import React, { useCallback, useState } from 'react';
import { BarChart3, BrainCircuit } from 'lucide-react';
import { LegacyAssessmentChartsPanel } from './LegacyAssessmentChartsPanel';
import { AbaV3ClinicalChartPanel } from './AbaV3ClinicalChartPanel';
import { ClinicalMeasurementV3Panel } from './ClinicalMeasurementV3Panel';
import { ClinicalOutcomesDashboard } from './ClinicalOutcomesDashboard';
import { ProfessionalSharedChartControl, type ProfessionalChartDescriptor } from './ProfessionalSharedChartControl';
import type { ClinicalPlanShareDescriptor } from './ClinicalPlanAnalyticsShell';
import type { AbaV3ShareDescriptor } from './AbaV3ClinicalChartPanel';

type ClinicalChartsWorkspaceProps = {
  patientId: string;
  organizationId?: string | null;
  isPanelDark?: boolean;
  showAbaDetails?: boolean;
  showAbaV3Details?: boolean;
  showClinicalMeasurementV3Details?: boolean;
  legacyAssessmentProtocols?: any[];
  protocols?: any[];
  history?: any[];
  onOpenSessionReport?: (sessionId: string) => void;
};

export function ClinicalChartsWorkspace({ patientId, organizationId = null, isPanelDark = false, showAbaDetails = false, showAbaV3Details = false, showClinicalMeasurementV3Details = false, legacyAssessmentProtocols = [], onOpenSessionReport }: ClinicalChartsWorkspaceProps) {
  const [view, setView] = useState<'plans' | 'aba' | 'aba-v3' | 'clinical-v3'>('plans');
  const [planDescriptor, setPlanDescriptor] = useState<ClinicalPlanShareDescriptor | null>(null);
  const [abaDescriptor, setAbaDescriptor] = useState<AbaV3ShareDescriptor | null>(null);
  const onPlanDescriptorChange = useCallback((next: ClinicalPlanShareDescriptor | null) => {
    setPlanDescriptor((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const onAbaDescriptorChange = useCallback((next: AbaV3ShareDescriptor | null) => {
    setAbaDescriptor((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const descriptor: ProfessionalChartDescriptor | null = view === 'plans' ? planDescriptor : view === 'aba-v3' ? abaDescriptor : null;
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
      {(view === 'plans' || (view === 'aba-v3' && showAbaV3Details)) && (
        <ProfessionalSharedChartControl key={patientId} patientId={patientId} descriptor={descriptor} isDark={isPanelDark} />
      )}
      {view === 'aba' && showAbaDetails
        ? <LegacyAssessmentChartsPanel patientId={patientId} protocols={legacyAssessmentProtocols} isPanelDark={isPanelDark} />
        : view === 'aba-v3' && showAbaV3Details
          ? <AbaV3ClinicalChartPanel patientId={patientId} organizationId={organizationId} isPanelDark={isPanelDark} onShareDescriptorChange={onAbaDescriptorChange} />
          : view === 'clinical-v3' && showClinicalMeasurementV3Details
            ? <ClinicalMeasurementV3Panel patientId={patientId} organizationId={organizationId} isPanelDark={isPanelDark} />
            : <ClinicalOutcomesDashboard patientId={patientId} organizationId={organizationId} isPanelDark={isPanelDark} onOpenSessionReport={onOpenSessionReport} onShareDescriptorChange={onPlanDescriptorChange} />}
    </div>
  );
}
