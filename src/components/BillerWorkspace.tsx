import React, { useMemo, useState } from 'react';
import {
  Building2,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  LogOut,
  ReceiptText,
  RefreshCw,
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

  const conferenceMode = section === 'conference' || section === 'preguides' || section === 'xml';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 sm:px-6">
          <LogoVerto size={30} showText={true} />
          <div className="hidden h-8 w-px bg-slate-200 sm:block" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">Faturamento e TISS</p>
            <p className="truncate text-xs text-slate-500">{clinicName}</p>
          </div>
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

      <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2">
            {(Object.keys(sectionMeta) as BillerSection[]).map((key) => {
              const item = sectionMeta[key];
              const Icon = item.icon;
              const active = section === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSection(key);
                    setNavigationRevision((current) => current + 1);
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
                    active
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={16} /> {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {conferenceMode ? (
          <MonthlyConferenceCenter
            key={`${section}:${navigationRevision}`}
            canExport={true}
            initialTab={section === 'conference' ? 'sessions' : 'preGuides'}
            tissInitialPanel={section === 'xml' ? 'xmlDrafts' : 'preGuides'}
            initialPayerId={payerId}
            navigationIntentKey={navigationRevision}
            onNavigatePayers={() => navigateToPayers(payerId)}
          />
        ) : (
          <PayerRequirementsPanel
            key={`payers:${navigationRevision}`}
            initialPayerId={payerId}
            navigationIntentKey={navigationRevision}
            onNavigateToPreGuides={(context) => navigateToPreguides(context.payerId)}
          />
        )}

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <RefreshCw size={13} /> Escopo restrito ao faturamento da unidade ativa.
        </div>
      </main>
    </div>
  );
}
