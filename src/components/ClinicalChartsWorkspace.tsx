import React, { useState } from 'react';
import { BarChart3, BrainCircuit } from 'lucide-react';
import { AbaClinicalChartsPanel } from './AbaClinicalChartsPanel';
import { AbaV3ClinicalChartPanel } from './AbaV3ClinicalChartPanel';
import { ClinicalOutcomesDashboard } from './ClinicalOutcomesDashboard';

type ClinicalChartsWorkspaceProps = {
  patientId: string;
  isPanelDark?: boolean;
  showAbaDetails?: boolean;
  showAbaV3Details?: boolean;
};

export function ClinicalChartsWorkspace({ patientId, isPanelDark = false, showAbaDetails = false, showAbaV3Details = false }: ClinicalChartsWorkspaceProps) {
  const [view, setView] = useState<'plans' | 'aba' | 'aba-v3'>('plans');
  return (
    <div className="space-y-4" data-testid="clinical-charts-workspace">
      {(showAbaDetails || showAbaV3Details) && (
        <div className={`flex w-full flex-wrap rounded-2xl border p-1 sm:w-auto ${isPanelDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          <button type="button" onClick={() => setView('plans')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm sm:flex-none ${view === 'plans' ? 'bg-violet-600 text-white' : isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}><BarChart3 size={16} /> Planos e PTS</button>
          {showAbaDetails && <button type="button" onClick={() => setView('aba')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm sm:flex-none ${view === 'aba' ? 'bg-violet-600 text-white' : isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}><BrainCircuit size={16} /> ABA Legacy</button>}
          {showAbaV3Details && <button type="button" onClick={() => setView('aba-v3')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm sm:flex-none ${view === 'aba-v3' ? 'bg-violet-600 text-white' : isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}><BrainCircuit size={16} /> ABA V3</button>}
        </div>
      )}
      {view === 'aba' && showAbaDetails
        ? <AbaClinicalChartsPanel patientId={patientId} isPanelDark={isPanelDark} />
        : view === 'aba-v3' && showAbaV3Details
          ? <AbaV3ClinicalChartPanel patientId={patientId} isPanelDark={isPanelDark} />
          : <ClinicalOutcomesDashboard patientId={patientId} isPanelDark={isPanelDark} />}
    </div>
  );
}
