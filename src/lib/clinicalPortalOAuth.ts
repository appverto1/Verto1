// Browser-only UX coordination for an explicit clinical Google login.
// The server must still authorize the account, clinic and selected portal.
export type ClinicalPortalChoice = 'professional' | 'patient';
type PortalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const CLINICAL_PORTAL_OAUTH_INTENT_KEY = 'verto.clinical-portal-oauth-intent.v1';
export const CLINICAL_PORTAL_OAUTH_BLOCK_KEY = 'verto.clinical-portal-oauth-block.v1';
export const CLINICAL_PORTAL_OAUTH_ERROR_KEY = 'verto.clinical-portal-oauth-error.v1';

export function readClinicalPortalOAuthIntent(store: PortalStorage): ClinicalPortalChoice | null {
  const value = store.getItem(CLINICAL_PORTAL_OAUTH_INTENT_KEY);
  return value === 'patient' || value === 'professional' ? value : null;
}

export function isClinicalPortalOAuthBlocked(store: PortalStorage): boolean {
  return store.getItem(CLINICAL_PORTAL_OAUTH_BLOCK_KEY) === '1';
}

export function beginClinicalPortalOAuth(store: PortalStorage, portal: ClinicalPortalChoice): void {
  store.removeItem(CLINICAL_PORTAL_OAUTH_BLOCK_KEY);
  store.removeItem(CLINICAL_PORTAL_OAUTH_ERROR_KEY);
  store.setItem(CLINICAL_PORTAL_OAUTH_INTENT_KEY, portal);
}

export function clearClinicalPortalOAuthIntent(store: PortalStorage): void {
  store.removeItem(CLINICAL_PORTAL_OAUTH_INTENT_KEY);
}

export function completeClinicalPortalOAuth(store: PortalStorage): void {
  clearClinicalPortalOAuthIntent(store);
  store.removeItem(CLINICAL_PORTAL_OAUTH_BLOCK_KEY);
  store.removeItem(CLINICAL_PORTAL_OAUTH_ERROR_KEY);
}

export function failClinicalPortalOAuth(
  store: PortalStorage,
  portal: ClinicalPortalChoice,
  errorCode: unknown,
): void {
  clearClinicalPortalOAuthIntent(store);
  // Fail closed even if clearing a previous server cookie subsequently fails.
  store.setItem(CLINICAL_PORTAL_OAUTH_BLOCK_KEY, '1');
  const reason = errorCode === 'INVALID_CREDENTIALS' ? 'denied' : 'retry';
  store.setItem(CLINICAL_PORTAL_OAUTH_ERROR_KEY, portal + ':' + reason);
}

export function consumeClinicalPortalOAuthError(store: PortalStorage): {
  portal: ClinicalPortalChoice;
  message: string;
} | null {
  const raw = store.getItem(CLINICAL_PORTAL_OAUTH_ERROR_KEY) || '';
  store.removeItem(CLINICAL_PORTAL_OAUTH_ERROR_KEY);
  const [portal, reason] = raw.split(':');
  if (portal !== 'patient' && portal !== 'professional') return null;
  return {
    portal,
    message: reason === 'denied'
      ? 'Acesso não disponível para este portal com esta conta e método de autenticação.'
      : 'Não foi possível concluir a autenticação neste portal. Tente novamente.',
  };
}
