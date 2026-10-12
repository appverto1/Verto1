# Backend modularization: financial read batch (2026-10-12)

- Base staging: 8556cb75276323e5f316cab358714ceab64ead3b; original server.ts Git blob: 10a3505c621159e8b51242836a5d9a280fa54a95.
- Ten GET handlers extracted, original app.get method, URL, middleware order and registration position preserved.
- Ten factories lazily obtain their original lexical dependencies per request; the original handler statements are copied without rewriting.
- server.ts: 100,632 → 100,113 lines (−519; 0.516% of the entrypoint).
- Exact reconstruction of original server.ts verified before changing files.
- AST parity test compares original route body statements, guards and middleware; targeted in-memory HTTP tests cover scoping and invalid identifiers.
- No migration, RLS, SQL rewrite, auth shortcut, Stripe, Resend, production deployment, new polling or write-handler changes.
- Existing GET /api/financial/expenses contains a pre-existing materialization RPC; this side effect is kept exactly as before.
- Target branch is staging. Live multi-tenant staging smoke and costs are not proven by mock testing.

## Extracted routes
- GET /api/private-pricing/catalog (70 original source lines)
- GET /api/private-pricing/appointments/:appointmentId/snapshot (23 original source lines)
- GET /api/patient-finance/ledger (195 original source lines)
- GET /api/patient-finance/transactions/:transactionId/document (48 original source lines)
- GET /api/patient-finance/policy (17 original source lines)
- GET /api/payments (21 original source lines)
- GET /api/financial/professional-payments (23 original source lines)
- GET /api/financial/expenses (89 original source lines)
- GET /api/financial/entries (23 original source lines)
- GET /api/financial/feature-survey (21 original source lines)
