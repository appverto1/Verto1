import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clinicalGuidedTutorialKeys,
  persistClinicalGuidedTutorial,
  readClinicalGuidedTutorial,
} from '../utils/clinicalGuidedTutorialProgress.mjs';
import { portalGuidedTutorialIsVisible } from '../utils/portalGuidedTutorialProgress.mjs';

type TutorialStatus = 'active' | 'skipped' | 'completed';
type TutorialCloseReason = 'pause' | 'skip' | 'complete';

type ClinicalGuidedTutorialOptions = {
  userId: string;
  clinicId: string;
  role: string;
  moduleAccessMode: string;
  moduleSignature: string;
  authorizationHydrated: boolean;
  stepCount: number;
};

type TutorialState = { key: string; active: boolean; step: number };
const EMPTY_TUTORIAL_STATE: TutorialState = { key: '', active: false, step: 0 };

// Presentation-only hook. The clinic/role context comes from the existing
// authenticated UI state; this is never a substitute for backend authorization.
export function useClinicalGuidedTutorial({
  userId, clinicId, role, moduleAccessMode, moduleSignature,
  authorizationHydrated, stepCount,
}: ClinicalGuidedTutorialOptions) {
  const [tutorialState, setTutorialState] = useState<TutorialState>(EMPTY_TUTORIAL_STATE);
  const initializedRoleKeyRef = useRef('');
  const identity = String(userId || '').trim();
  const { roleKey, contextKey } = clinicalGuidedTutorialKeys({
    userId: identity, clinicId, role, moduleAccessMode, moduleSignature,
  });
  const canRun = Boolean(authorizationHydrated && identity && roleKey && stepCount > 0);
  // Bound to the CURRENT user, clinic and role during render. An old overlay
  // cannot flash for a different workspace before useEffect reloads progress.
  const runGuidedTutorial = canRun && portalGuidedTutorialIsVisible(tutorialState, roleKey);
  const guidedTutorialStep = runGuidedTutorial
    ? Math.min(stepCount - 1, tutorialState.step)
    : 0;

  const persistGuidedTutorial = useCallback((status: TutorialStatus, step: number) => {
    if (!canRun) return;
    try {
      persistClinicalGuidedTutorial(window.localStorage, roleKey, contextKey, status, step);
    } catch {
      // Browser storage can be unavailable; visual state must still work.
    }
  }, [canRun, roleKey, contextKey]);

  const startGuidedTutorial = useCallback(() => {
    if (!canRun) return;
    setTutorialState({ key: roleKey, active: true, step: 0 });
    persistGuidedTutorial('active', 0);
  }, [canRun, roleKey, persistGuidedTutorial]);

  const handleGuidedTutorialStepChange = useCallback((nextStep: number) => {
    if (!runGuidedTutorial) return;
    const safeStep = Number.isFinite(nextStep)
      ? Math.max(0, Math.min(stepCount - 1, nextStep)) : 0;
    setTutorialState({ key: roleKey, active: true, step: safeStep });
    persistGuidedTutorial('active', safeStep);
  }, [runGuidedTutorial, stepCount, roleKey, persistGuidedTutorial]);

  const closeGuidedTutorial = useCallback((reason: TutorialCloseReason = 'pause') => {
    if (!runGuidedTutorial) return;
    const status: TutorialStatus = reason === 'skip'
      ? 'skipped' : reason === 'complete' ? 'completed' : 'active';
    persistGuidedTutorial(status, guidedTutorialStep);
    setTutorialState({ key: roleKey, active: false, step: guidedTutorialStep });
  }, [runGuidedTutorial, guidedTutorialStep, roleKey, persistGuidedTutorial]);

  useEffect(() => {
    if (!canRun) {
      initializedRoleKeyRef.current = '';
      setTutorialState(EMPTY_TUTORIAL_STATE);
      return;
    }
    if (initializedRoleKeyRef.current === roleKey) return;
    initializedRoleKeyRef.current = roleKey;

    let stored: { status: TutorialStatus; step: number } | null = null;
    try {
      stored = readClinicalGuidedTutorial(window.localStorage, roleKey, contextKey);
    } catch {
      // localStorage property access may throw in private/locked browsers.
    }
    if (stored) {
      const step = Math.max(0, Math.min(stepCount - 1, stored.step));
      setTutorialState({ key: roleKey, active: stored.status === 'active', step });
      return;
    }

    persistGuidedTutorial('active', 0);
    setTutorialState({ key: roleKey, active: true, step: 0 });
  }, [canRun, roleKey, contextKey, stepCount, persistGuidedTutorial]);

  return {
    runGuidedTutorial,
    guidedTutorialStep,
    startGuidedTutorial,
    handleGuidedTutorialStepChange,
    closeGuidedTutorial,
  };
}
