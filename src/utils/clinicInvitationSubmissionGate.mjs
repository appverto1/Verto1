/**
 * UI-only guard for duplicate invitation submissions and late responses after
 * switching clinics. Backend authorization, membership and invitation
 * idempotency remain authoritative.
 */
export function createClinicInvitationSubmissionGate() {
  /** @type {{ tenantKey: string } | null} */
  let pending = null;

  return {
    hasPending() {
      return pending !== null;
    },
    begin(tenantKey) {
      if (pending !== null) return null;
      const request = { tenantKey: String(tenantKey ?? '').trim() };
      pending = request;
      return request;
    },
    isCurrent(request, activeTenantKey) {
      return request !== null
        && pending === request
        && request.tenantKey === String(activeTenantKey ?? '').trim();
    },
    end(request) {
      if (pending !== request || request === null) return false;
      pending = null;
      return true;
    },
    reset() {
      pending = null;
    },
  };
}
