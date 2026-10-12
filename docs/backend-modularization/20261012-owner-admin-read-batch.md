# Owner/Admin GET route extraction (2026-10-12)

- Original staging 66c4188729196ff846ecd33e07b2c9d309c7528d; server blob 3b221575a18e3b01df24286168743e70bee8e06b.
- Nine read-only registrations extracted to services/ownerAdminReadHandlers.ts.
- Original app.get registration locations, all guards and middlewares are preserved unchanged.
- Byte-exact reconstructed original server.ts before publishing; AST body statement parity is part of the regression runner.
- 99382 to 99101 entrypoint lines (−281).
- No DB migration, write endpoint, Stripe, authentication or billing change, new query, logging, cron or polling.
- Existing checkOwner and checkPlatformAdmin wrappers are untouched, including the exact order.
- Only mocked/structural regressions are claimed; live role smoke test pending.

- GET /api/owner/stats (23 original lines)
- GET /api/owner/clients (9 original lines)
- GET /api/owner/financial-overview (35 original lines)
- GET /api/owner/financial-feature-surveys (12 original lines)
- GET /api/admin/demo/sandboxes (40 original lines)
- GET /api/admin/stats (38 original lines)
- GET /api/admin/clients (14 original lines)
- GET /api/admin/verto-protocols (31 original lines)
- GET /api/owner/leads/recovery (89 original lines)
