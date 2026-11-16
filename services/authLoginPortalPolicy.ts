/**
 * Account-category gate for the three public login entry points.
 * These values are classifications only: the persisted role (never a browser hint)
 * is the authority for the application session and its clinic/patient permissions.
 */
const PROFESSIONAL_ROLES = new Set([
  'owner', 'admin', 'director', 'coordinator', 'supervisor',
  'therapist', 'receptionist', 'biller',
]);

export type ClinicalLoginPortal = 'professional' | 'patient';

const normalizeRole = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export function persistedClinicalLoginPortal(role: unknown): ClinicalLoginPortal | null {
  const normalized = normalizeRole(role);
  if (normalized === 'patient') return 'patient';
  if (PROFESSIONAL_ROLES.has(normalized)) return 'professional';
  return null;
}

export function requestedClinicalLoginPortal(intendedRole: unknown): ClinicalLoginPortal | null {
  const normalized = normalizeRole(intendedRole);
  if (normalized === 'patient') return 'patient';
  if (normalized === 'professional' || PROFESSIONAL_ROLES.has(normalized)) return 'professional';
  return null;
}

export function matchesClinicalLoginPortal(intendedRole: unknown, persistedRole: unknown): boolean {
  const requested = requestedClinicalLoginPortal(intendedRole);
  const persisted = persistedClinicalLoginPortal(persistedRole);
  return requested !== null && requested === persisted;
}

export const INVALID_PORTAL_CREDENTIALS_MESSAGE = 'E-mail ou senha inválidos.';
