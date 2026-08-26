import React, { useState } from 'react';
import { BarChart3, BrainCircuit } from 'lucide-react';
import { AbaClinicalChartsPanel } from './AbaClinicalChartsPanel';
import { AbaV3ClinicalChartPanel } from './AbaV3ClinicalChartPanel';
import { ClinicalMeasurementV3Panel } from './ClinicalMeasurementV3Panel';
import { ClinicalOutcomesDashboard } from './ClinicalOutcomesDashboard';

type ClinicalChartsWorkspaceProps = {
  patientId: string;
  organizationId?: string | null;
  isPanelDark?: boolean;
  showAbaDetails?: boolean;
  showAbaV3Details?: boolean;
  showClinicalMeasurementV3Details?: boolean;
  onOpenSessionReport?: (sessionId: string) => void;
};

export function ClinicalChartsWorkspace({ patientId, organizationId = null, isPanelDark = false, showAbaDetails = false, showAbaV3Details = false, showClinicalMeasurementV3Details = false, onOpenSessionReport }: ClinicalChartsWorkspaceProps) {
  const [view, setView] = useState<'plans' | 'aba' | 'aba-v3' | 'clinical-v3'>('plans');
  return (
    <div className="space-y-4" data-testid="clinical-charts-workspace">
      {(showAbaDetails || showAbaV3Details || showClinicalMeasurementV3Details) && (
        <div className={`flex w-full flex-wrap rounded-2xl border p-1 sm:w-auto ${isPanelDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          <button type="button" onClick={() => setView('plans')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm sm:flex-none ${view === 'plans' ? 'bg-violet-600 text-white' : isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}><BarChart3 size={16} /> Planos e PTS</button>
          {showAbaDetails && <button type="button" onClick={() => setView('aba')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm sm:flex-none ${view === 'aba' ? 'bg-violet-600 text-white' : isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}><BrainCircuit size={16} /> ABA Legacy</button>}
          {showAbaV3Details && <button type="button" onClick={() => setView('aba-v3')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm sm:flex-none ${view === 'aba-v3' ? 'bg-violet-600 text-white' : isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}><BrainCircuit size={16} /> ABA V3</button>}
          {showClinicalMeasurementV3Details && <button type="button" onClick={() => setView('clinical-v3')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm sm:flex-none ${view === 'clinical-v3' ? 'bg-violet-600 text-white' : isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}><BarChart3 size={16} /> Métricas V3</button>}
        </div>
      )}
      {view === 'aba' && showAbaDetails
        ? <AbaClinicalChartsPanel patientId={patientId} isPanelDark={isPanelDark} />
        : view === 'aba-v3' && showAbaV3Details
          ? <AbaV3ClinicalChartPanel patientId={patientId} organizationId={organizationId} isPanelDark={isPanelDark} />
          : view === 'clinical-v3' && showClinicalMeasurementV3Details
            ? <ClinicalMeasurementV3Panel patientId={patientId} organizationId={organizationId} isPanelDark={isPanelDark} />
            : <ClinicalOutcomesDashboard patientId={patientId} organizationId={organizationId} isPanelDark={isPanelDark} onOpenSessionReport={onOpenSessionReport} />}
    </div>
  );
}
