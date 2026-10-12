# Backend modularization — TISS payer profiles list GET

- Baseline: `staging` `5fc564ba5b11bef1f21b56e4f81fd6c43e587f60`, `server.ts` blob `aa914fac455bbd82fab898843cdee795acccf33a`; entrypoint initially 101730 lines.
- Slice: **only** `GET /api/admin/tiss/payer-profiles`, moved verbatim to `services/tissPayerProfilesListRoute.ts` via explicit closure dependencies; at the same original location `server.ts` invokes the route register function. Same `noStoreDynamicResponse`, `checkAuth`, `insurance_tiss` module guard and `billing.mapping.manage` capability in the same order.
- No modified query order/shape, status code, error payload, schema fallback behavior, tenant scope, storage, migrations, billing, Stripe, Resend, background jobs, clinical persistence or production environment. Neighbor route `GET /api/admin/tiss/payer-profiles/:payerId` is untouched.
- Files: `server.ts`, `services/tissPayerProfilesListRoute.ts`, `tests/tissPayerProfilesListRoute.test.ts`, this document. Expected entrypoint lines: 101730 → 101710 (−20).
- Safety: unique original route anchor; guarded baseline `server.ts` blob; exact copied route body; byte-exact round-trip back to baseline. Checks fail closed if staging drifts.
- Targeted HTTP test covers missing auth, module denial, capability denial, invalid clinic ID, two clinic-scoped queries (forged client header ignored), optional column fallback, missing table and expected 500. All DB activity is in-memory mocked; no live DB or real tenant used.
- Branch: `refactor/backend-tiss-payer-profiles-read-20261012`; pending actual commit/PR result and CI verification. No merge or deployment authorized.
- Next: choose a separate non-overlapping TISS read endpoint, only after re-inspecting staging/PRs and checkpoint. Do not repeat this extraction.
