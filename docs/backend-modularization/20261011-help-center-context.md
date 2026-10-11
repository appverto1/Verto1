# Backend modularization — help center context extraction

- Date: 2026-10-11.
- Baseline: `staging` at `e78a05511dfd03b82d32d92d44f4231004d71a64`; parent file `services/helpCenterRoutes.ts` blob `21b4444b2d44d99e2c9a8253719869d03b55fabe`.
- Branch: `refactor/backend-help-center-context-20261011`.
- Extraction: move `setValues` and the `helpContext` closure to `services/helpCenterContext.ts` via `createHelpContext(currentClinicId)`. Preserve exact context-field and SHA-256 calculation, route registration, middleware ordering, authorization, HTTP behavior, and media handling.
- Tests: isolated Node 22 type-stripping run of equivalent helper, 16 assertions PASS; source-tail check confirms all route handlers after `/api/help/catalog` anchor are unchanged. Repository Node 20/tsx test, full typecheck/build, CI and staging smoke remain pending.
- PR/merge/deploy: pending. No production changes. Direct `server.ts` reduction: 0 lines (0% of 102066 baseline lines).
- Idempotency: skip if `createHelpContext` already imported by `helpCenterRoutes.ts`; do not duplicate this extraction. Other unmerged slices exist on `refactor/backend-appointment-policy-hash-20261011` and `refactor/backend-module-purchase-eligibility-support-20261011`.
- Next: validate with Node 20 CI, open PR against staging when permitted, and extract another independent low-risk backend slice without modifying `server.ts` through an unverified large-file write.
