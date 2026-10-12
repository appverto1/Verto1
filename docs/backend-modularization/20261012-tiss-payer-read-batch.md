# Backend: TISS and payer financial GET extraction — October 12, 2026

- Source staging HEAD: 5c871886748de10185567193d3391b827c77b908; server.ts Git blob ec019c5b9a6e88bc5ae9fb10081442ed88a17e4d.
- Tenants and authenticated clinic scoping: unchanged original expressions. Middleware, method, route path and registration order stay in server.ts.
- 20 independent original GET callbacks extracted exactly to services/tissPayerReadHandlers.ts.
- server.ts: 100113 → 99382 lines (−731 lines).
- Safety: unique original AST route signatures, lazy getter dependencies and byte-exact server.ts roundtrip before writes.
- Tests: 20 original AST handler statement/middleware/dependency checks and mocked HTTP tenant-scope scenarios; required through existing batch01 regression runner.
- No migration, SQL/RLS rewrite, request-count change, additional polling, Stripe/webhook change or modifications to any POST/PATCH/PUT/DELETE route.
- Existing HTTP GET handlers that can call materialization or tracking-write helpers were excluded from this slice.
- CI tests do not replace live authenticated tenant smoke tests. Production/main remain out of scope.

## Original endpoints
- GET /api/admin/tiss/provider-profile — 11 original lines
- GET /api/admin/tiss/payer-profiles/:payerId — 13 original lines
- GET /api/patients/tiss-authorizations — 44 original lines
- GET /api/patients/:patientId/tiss-authorizations — 33 original lines
- GET /api/tiss/professional-profile/me — 18 original lines
- GET /api/admin/tiss/professional-profiles — 23 original lines
- GET /api/admin/tiss/professional-profiles/:professionalId — 14 original lines
- GET /api/tiss/pre-guides — 89 original lines
- GET /api/tiss/official-documents — 70 original lines
- GET /api/tiss/official-documents/tracking — 34 original lines
- GET /api/tiss/xml-drafts — 36 original lines
- GET /api/tiss/xml-drafts/:draftId — 22 original lines
- GET /api/tiss/revenue-cycle/events — 35 original lines
- GET /api/tiss/billing-batch-drafts — 38 original lines
- GET /api/tiss/billing-batch-drafts/:batchId — 22 original lines
- GET /api/tiss/pre-guides/coverage — 136 original lines
- GET /api/tiss/pre-guides/:appointmentId — 33 original lines
- GET /api/payer-options — 33 original lines
- GET /api/admin/payers — 25 original lines
- GET /api/admin/payers/:payerId/requirements — 23 original lines
