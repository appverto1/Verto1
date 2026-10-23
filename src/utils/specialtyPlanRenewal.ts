import { clinicalSpecialtiesMatch } from './clinicalSpecialties';

/**
 * The database permits ONE active clinical cycle, while independent
 * specialty drafts may be prepared in parallel. This helper locates a current
 * plan to explain the distinction in the creation form; it never authorizes
 * access to another professional's scope. Completed/archived plans are history.
 *
 * This is UI discovery only. The server independently enforces current
 * membership, clinic/patient scope, and plan write authorization.
 */
export function currentSpecialtyPlanScope(scopes: unknown, specialty: unknown): any | null {
  if (!Array.isArray(scopes)) return null;
  const matching = scopes.filter((scope: any) =>
    String(scope?.mode || '').toLowerCase() === 'specialty' &&
    ['draft', 'active', 'paused'].includes(String(scope?.status || '').toLowerCase()) &&
    clinicalSpecialtiesMatch(scope?.specialty, specialty)
  );
  return matching.find((scope: any) => String(scope.status).toLowerCase() === 'active') ||
    matching[0] || null;
}
