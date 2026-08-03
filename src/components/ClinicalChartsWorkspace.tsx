import React, { useState } from 'react';
import { BarChart3, BrainCircuit } from 'lucide-react';
import { AbaClinicalChartsPanel } from './AbaClinicalChartsPanel';
import { ClinicalOutcomesDashboard } from './ClinicalOutcomesDashboard';

type ClinicalChartsWorkspaceProps = {
  patientId: string;
  isPanelDark?: boolean;
  showAbaDetails?: boolean;
};

export function ClinicalChartsWorkspace({ patientId, isPanelDark = false, showAbaDetails = false }: ClinicalChartsWorkspaceProps) {
  const [view, setView] = useState<'plans' | 'aba'>('plans');
  return (
    <div className="space-y-4" data-testid="clinical-charts-workspace">
      {showAbaDetails && (
        <div className={`inline-flex rounded-2xl border p-1 ${isPanelDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          <button type="button" onClick={() => setView('plans')} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm ${view === 'plans' ? 'bg-violet-600 text-white' : isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}><BarChart3 size={16} /> Planos e PTS</button>
          <button type="button" onClick={() => setView('aba')} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm ${view === 'aba' ? 'bg-violet-600 text-white' : isPanelDark ? 'text-slate-300' : 'text-slate-600'}`}><BrainCircuit size={16} /> ABA detalhado</button>
        </div>
      )}
      {view === 'aba' && showAbaDetails
        ? <AbaClinicalChartsPanel patientId={patientId} isPanelDark={isPanelDark} />
        : <ClinicalOutcomesDashboard patientId={patientId} isPanelDark={isPanelDark} />}
    </div>
  );
}
