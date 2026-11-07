// Tutorial progress is browser-local presentation state, never permissions or
// evidence of a completed clinical/financial action. No network or database I/O.
export const CLINICAL_GUIDED_TUTORIAL_REVISION = 'p0-contextual-v1';

export function clinicalGuidedTutorialKeys({
  userId, clinicId, role, moduleAccessMode, moduleSignature,
}) {
  const uid = String(userId || '').trim();
  if (!uid) return { roleKey: '', contextKey: '' };
  const scope = String(clinicId || '').trim() || 'global';
  const normalizedRole = String(role || '').trim().toLowerCase() || 'unknown';
  const roleKey = [
    'verto:guided-tutorial:role',
    CLINICAL_GUIDED_TUTORIAL_REVISION,
    uid,
    scope,
    normalizedRole,
  ].join(':');
  // Legacy key contains the old entitlement signature. Read it only when a
  // stable role key is absent, and continue writing both keys for compatibility.
  const contextKey = [
    'verto:guided-tutorial',
    CLINICAL_GUIDED_TUTORIAL_REVISION,
    uid,
    scope,
    normalizedRole,
    moduleAccessMode,
    moduleSignature || 'baseline',
  ].join(':');
  return { roleKey, contextKey };
}

export function readClinicalGuidedTutorial(storage, roleKey, contextKey) {
  if (!storage || !roleKey) return null;
  try {
    const stableRaw = storage.getItem(roleKey);
    const legacyRaw = stableRaw ? null : storage.getItem(contextKey);
    const stored = stableRaw || legacyRaw
      ? JSON.parse(stableRaw || legacyRaw)
      : null;
    if (
      stored?.revision !== CLINICAL_GUIDED_TUTORIAL_REVISION ||
      !['active', 'completed', 'skipped'].includes(stored?.status)
    ) return null;
    if (legacyRaw) {
      // A blocked localStorage write must not prevent the guide from opening.
      try { storage.setItem(roleKey, legacyRaw); } catch { /* best effort */ }
    }
    const rawStep = Number(stored.step || 0);
    return {
      status: stored.status,
      step: Number.isFinite(rawStep) ? Math.max(0, rawStep) : 0,
    };
  } catch {
    return null;
  }
}

export function persistClinicalGuidedTutorial(storage, roleKey, contextKey, status, step) {
  if (!storage || !roleKey || !contextKey ||
      !['active', 'completed', 'skipped'].includes(status)) return false;
  try {
    const safeStep = Number(step);
    const progress = JSON.stringify({
      revision: CLINICAL_GUIDED_TUTORIAL_REVISION,
      status,
      step: Number.isFinite(safeStep) ? Math.max(0, safeStep) : 0,
      updatedAt: new Date().toISOString(),
    });
    storage.setItem(roleKey, progress);
    storage.setItem(contextKey, progress);
    return true;
  } catch {
    return false;
  }
}
