import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, BrainCircuit, ChevronDown, Share2 } from 'lucide-react';
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
  const [sharingMenuOpen, setSharingMenuOpen] = useState(false);
  const sharingMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPlanDescriptor(null);
    setAbaDescriptor(null);
    setView('plans');
    setSharingMenuOpen(false);
  }, [patientId]);
  useEffect(() => { setSharingMenuOpen(false); }, [view]);
  useEffect(() => {
    if (!sharingMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!sharingMenuRef.current?.contains(event.target as Node)) setSharingMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSharingMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [sharingMenuOpen]);
  const onPlanDescriptorChange = useCallback((next: ClinicalPlanShareDescriptor | null) => {
    setPlanDescriptor((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const onAbaDescriptorChange = useCallback((next: AbaV3ShareDescriptor | null) => {
    setAbaDescriptor((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const descriptor: ProfessionalChartDescriptor | null = view === 'plans' ? planDescriptor : view === 'aba-v3' ? abaDescriptor : null;
  return (
    <div className="space-y-4" data-testid="clinical-charts-workspace">
      <div className="flex w-full items-start gap-2">
      {(showAbaDetails || showAbaV3Details || showClinicalMeasurementV3Details) && (
        <div role="group" aria-label="Visualização clínica" className={`flex min-w-0 flex-1 flex-wrap gap-1 rounded-2xl border p-1.5 sm:w-auto ${isPanelDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50/80'}`}>
          <button type="button" aria-pressed={view === 'plans'} onClick={() => setView('plans')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:flex-none ${view === 'plans' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}><BarChart3 size={16} /> Planos e PTS</button>
          {showAbaDetails && <button type="button" aria-pressed={view === 'aba'} onClick={() => setView('aba')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:flex-none ${view === 'aba' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}><BrainCircuit size={16} /> ABA Legacy</button>}
          {showAbaV3Details && <button type="button" aria-pressed={view === 'aba-v3'} onClick={() => setView('aba-v3')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:flex-none ${view === 'aba-v3' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}><BrainCircuit size={16} /> ABA V3</button>}
          {showClinicalMeasurementV3Details && <button type="button" aria-pressed={view === 'clinical-v3'} onClick={() => setView('clinical-v3')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:flex-none ${view === 'clinical-v3' ? 'bg-violet-600 text-white shadow-sm' : isPanelDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'}`}><BarChart3 size={16} /> Métricas V3</button>}
        </div>
      )}
      {(view === 'plans' || (view === 'aba-v3' && showAbaV3Details)) && (
        <div ref={sharingMenuRef} className="relative ml-auto shrink-0" data-testid="chart-sharing-dropdown">
          <button
            type="button"
            title="Configurar compartilhamento do gráfico"
            aria-label="Compartilhar gráfico com o paciente"
            aria-expanded={sharingMenuOpen}
            aria-controls="chart-sharing-dropdown-panel"
            onClick={() => setSharingMenuOpen((open) => !open)}
            className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${isPanelDark
              ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
          >
            <Share2 size={15} aria-hidden="true" />
            <span className="hidden sm:inline">Compartilhar</span>
            <ChevronDown size={13} aria-hidden="true" className={`transition-transform ${sharingMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          <div
            id="chart-sharing-dropdown-panel"
            role="region"
            aria-label="Configurações de compartilhamento do gráfico"
            className={`${sharingMenuOpen ? 'absolute' : 'hidden'} right-0 top-full z-[60] mt-2 max-h-[72vh] w-[min(420px,calc(100vw-24px))] overflow-y-auto rounded-2xl border p-2 shadow-xl ${isPanelDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}
          >
            <ProfessionalSharedChartControl key={patientId} patientId={patientId} descriptor={descriptor} isDark={isPanelDark} />
          </div>
        </div>
      )}
      </div>
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
