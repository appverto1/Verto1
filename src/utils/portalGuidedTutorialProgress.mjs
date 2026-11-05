// Guided-tour presentation progress only; never an authorization mechanism.
// Role, user and clinic are separate keys so no portal inherits another
// portal's completion. No network requests, database writes or polling.
export const PORTAL_GUIDED_TUTORIAL_REVISION = 'portal-v1';

export function portalGuidedTutorialKey({ userId, clinicId, portal, patientId = '' }) {
  const uid = String(userId || '').trim();
  if (!uid || !['patient', 'biller'].includes(String(portal || ''))) return '';
  return [
    'verto:guided-tutorial:portal-v1',
    uid,
    String(clinicId || 'no-clinic').trim(),
    portal,
    portal === 'patient' ? String(patientId || 'self').trim() : '',
  ].join(':');
}

export function readPortalGuidedTutorial(storage, key) {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (
      parsed?.revision !== PORTAL_GUIDED_TUTORIAL_REVISION ||
      !['active', 'completed', 'skipped'].includes(parsed?.status)
    ) return null;
    return parsed.status;
  } catch {
    return null;
  }
}

export function persistPortalGuidedTutorial(storage, key, status) {
  if (!storage || !key || !['active', 'completed', 'skipped'].includes(status)) return false;
  try {
    storage.setItem(key, JSON.stringify({
      revision: PORTAL_GUIDED_TUTORIAL_REVISION,
      status,
      step: 0,
    }));
    return true;
  } catch {
    return false;
  }
}
