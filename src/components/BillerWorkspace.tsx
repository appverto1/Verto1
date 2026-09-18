import React, { useMemo, useState } from 'react';
import {
  Building2,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  LogOut,
  Menu,
  ReceiptText,
  RefreshCw,
  X,
} from 'lucide-react';
import { LogoVerto } from './Common';
import { MonthlyConferenceCenter } from './MonthlyConferenceCenter';
import { PayerRequirementsPanel } from './PayerRequirementsPanel';

type BillerWorkspaceProps = {
  user: any;
  onLogout: () => void;
};

type BillerSection = 'preguides' | 'conference' | 'xml' | 'payers';

const sectionMeta: Record<BillerSection, { label: string; icon: React.ComponentType<any> }> = {
  preguides: { label: 'Pré-guias TISS', icon: FileCheck2 },
  conference: { label: 'Conferência', icon: FileSpreadsheet },
  xml: { label: 'Lotes XML', icon: FileText },
  payers: { label: 'Convênios e De/Para', icon: ReceiptText },
};

export function BillerWorkspace({ user, onLogout }: BillerWorkspaceProps) {
  const [section, setSection] = useState<BillerSection>('preguides');
  const [payerId, setPayerId] = useState('');
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const workspaceScopeKey = String(user?.activeWorkspaceId || user?.clinicId || user?.activeAccessContext?.clinicId || '').trim();

  const clinicName = String(
    user?.activeAccessContext?.clinicName ||
      user?.clinicName ||
      user?.clinic?.name ||
      'Clínica atual',
  ).trim();
  const accessContextCount = useMemo(() => {
    if (Array.isArray(user?.accessContexts)) return user.accessContexts.filter((item: any) => item?.kind === 'clinic_workspace').length;
    if (Array.isArray(user?.workspaces)) return user.workspaces.length;
    return 0;
  }, [user?.accessContexts, user?.workspaces]);

  const navigateToPayers = (nextPayerId = '') => {
    if (nextPayerId) setPayerId(nextPayerId);
    setSection('payers');
    setNavigationRevision((current) => current + 1);
  };

  const navigateToPreguides = (nextPayerId = '') => {
    if (nextPayerId) setPayerId(nextPayerId);
    setSection('preguides');
    setNavigationRevision((current) => current + 1);
  };

  const selectSection = (nextSection: BillerSection) => {
    setSection(nextSection);
    setNavigationRevision((current) => current + 1);
  };

  const conferenceMode = section === 'conference' || section === 'preguides' || section === 'xml';

  const renderNavigation = (desktop = false) => (
    <nav aria-label="Navegação do faturamento" className="space-y-1.5">
      {(Object.keys(sectionMeta) as BillerSection[]).map((key) => {
        const item = sectionMeta[key];
        const Icon = item.icon;
        const active = section === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              selectSection(key);
              if (!desktop) setMobileNavOpen(false);
            }}
            aria-current={active ? 'page' : undefined}
            className={`flex w-full items-center justify-start gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
              active
                ? 'bg-violet-600 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Icon size={16} aria-hidden="true" /> {item.label}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="h-[100dvh] overflow-y-auto bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 sm:px-6">
          <LogoVerto size={30} showText={true} />
          <div className="hidden h-8 w-px bg-slate-200 sm:block" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">Faturamento e TISS</p>
            <p className="truncate text-xs text-slate-500">{clinicName}</p>
          </div>
          <button
            type="button"
            aria-expanded={mobileNavOpen}
            aria-controls="biller-mobile-navigation"
            onClick={() => setMobileNavOpen((current) => !current)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 lg:hidden"
          >
            {mobileNavOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            <span className="sr-only">{mobileNavOpen ? 'Fechar menu do faturamento' : 'Abrir menu do faturamento'}</span>
          </button>
          {accessContextCount > 1 && (
            <button
              type="button"
              onClick={() => window.location.assign('/workspaces')}
              className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 sm:flex"
            >
              <Building2 size={15} /> Trocar unidade
            </button>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <LogOut size={15} /> <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>

      {mobileNavOpen && (
        <div id="biller-mobile-navigation" className="sticky top-[69px] z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur lg:hidden">
          <div className="mx-auto max-w-[1600px] px-3 py-3 sm:px-6">
            {renderNavigation()}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6 sm:py-6">
        <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:items-start lg:gap-6">
          <aside className="sticky top-[84px] hidden max-h-[calc(100dvh-100px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:block">
            {renderNavigation(true)}
          </aside>

          <div className="min-w-0">
            {conferenceMode ? (
              <React.Fragment key={`conference:${workspaceScopeKey}`}>
                <MonthlyConferenceCenter
                  workspaceScopeKey={workspaceScopeKey}
                  canExport={true}
                  initialTab={section === 'conference' ? 'sessions' : 'preGuides'}
                  tissInitialPanel={section === 'xml' ? 'xmlDrafts' : 'preGuides'}
                  initialPayerId={payerId}
                  navigationIntentKey={navigationRevision}
                  onNavigatePayers={() => navigateToPayers(payerId)}
                />
              </React.Fragment>
            ) : (
              <React.Fragment key={`payers:${workspaceScopeKey}`}>
                <PayerRequirementsPanel
                  workspaceScopeKey={workspaceScopeKey}
                  initialPayerId={payerId}
                  navigationIntentKey={navigationRevision}
                  onNavigateToPreGuides={(context) => navigateToPreguides(context.payerId)}
                />
              </React.Fragment>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <RefreshCw size={13} /> Escopo restrito ao faturamento da unidade ativa.
        </div>
      </main>
    </div>
  );
}
