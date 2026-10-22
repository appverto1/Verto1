import { clinicalSpecialtiesMatch } from './clinicalSpecialties';

/**
 * The database permits one current specialty scope per patient and specialty.
 * Do not bypass the unique index or delete clinical records to create a
 * competing active scope. Instead guide authorized clinicians to the existing
 * plan's versioned PATCH workflow; completed/archived scopes are history.
 *
 * This is UI discovery only. The server independently enforces current
 * membership, clinic/patient scope, and plan write authorization.
 */
export function currentSpecialtyPlanScope(scopes: unknown, specialty: unknown): any | null {
  if (!Array.isArray(scopes)) return null;
  return scopes.find((scope: any) =>
    String(scope?.mode || '').toLowerCase() === 'specialty' &&
    ['draft', 'active', 'paused'].includes(String(scope?.status || '').toLowerCase()) &&
    clinicalSpecialtiesMatch(scope?.specialty, specialty)
  ) || null;
}
