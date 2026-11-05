import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck } from 'lucide-react';
import { TutorialOverlay } from './Tutorial';

type Portal = 'biller' | 'patient';

type PortalFirstAccessTutorialProps = {
  user: any;
  portal: Portal;
  targetId: string;
  patientId?: string;
};

// This is presentation-only. It neither writes clinical records nor changes
// memberships, roles or portal permissions. Keep help progress isolated by
// authenticated user, active clinic, portal and (for patients) patient context.
export function PortalFirstAccessTutorial({ user, portal, targetId, patientId: portalPatientId }: PortalFirstAccessTutorialProps) {
  const [isActive, setIsActive] = useState(false);
  const initializedKeyRef = useRef('');
  const userId = String(user?.id || '').trim();
  const clinicId = String(user?.activeWorkspaceId || user?.clinicId || user?.clinic_id || 'no-clinic').trim();
  const patientId = portal === 'patient'
    ? String(portalPatientId || user?.patientId || user?.patient_id || 'self').trim()
    : '';

  const progressKey = [
    'verto:guided-tutorial:portal-v1',
    userId,
    clinicId,
    portal,
    patientId,
  ].join(':');

  useEffect(() => {
    if (!userId || initializedKeyRef.current === progressKey) return;
    initializedKeyRef.current = progressKey;
    let status = '';
    try {
      const stored = window.localStorage.getItem(progressKey);
      const progress = stored ? JSON.parse(stored) : null;
      status = progress?.revision === 'portal-v1' ? String(progress?.status || '') : '';
    } catch {
      // The tutorial is usable even when browser storage is disabled.
    }
    setIsActive(status !== 'completed' && status !== 'skipped');
  }, [progressKey, userId]);

  const steps = useMemo(() => [{
    targetId,
    title: portal === 'patient' ? 'Seu portal do paciente' : 'Ajuda para faturamento',
    content: portal === 'patient'
      ? 'Use este menu para encontrar sua agenda, tarefas e documentos disponíveis. Você pode rever esta orientação pelo botão Tutorial.'
      : 'Use o botão de interrogação (?) para consultar a Central de Ajuda e os tutoriais de faturamento. Você pode rever esta orientação quando precisar.',
    placement: 'bottom' as const,
  }], [portal, targetId]);

  const persist = (status: 'active' | 'completed' | 'skipped') => {
    if (!userId) return;
    try {
      window.localStorage.setItem(progressKey, JSON.stringify({
        revision: 'portal-v1',
        status,
        step: 0,
      }));
    } catch {
      // Best-effort local tutorial progress; no server writes or polling.
    }
  };

  const restart = () => {
    persist('active');
    setIsActive(true);
  };

  const close = (reason: 'pause' | 'skip' | 'complete' = 'pause') => {
    persist(reason === 'complete' ? 'completed' : reason === 'skip' ? 'skipped' : 'active');
    setIsActive(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={restart}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
        aria-label={portal === 'patient' ? 'Rever tutorial do portal do paciente' : 'Rever tutorial do faturamento'}
        title="Rever tutorial guiado"
      >
        <BookOpenCheck size={17} aria-hidden="true" />
        <span className="hidden sm:inline">Tutorial</span>
      </button>
      {isActive && (
        <TutorialOverlay
          steps={steps}
          onClose={close}
          currentStepIndex={0}
          onStepChange={() => undefined}
        />
      )}
    </>
  );
}
