# Backend modularization — internal schema status route

- Date: 2026-10-11. Baseline staging e78a05511dfd03b82d32d92d44f4231004d71a64, original server.ts Git blob b5460aa69d3cee3ff6ec96849f61537974007997 (102066 lines).
- Scope: extract exactly one GET /api/internal/schema-status handler into services/internalSchemaStatusRouteHandler.ts; keep the original callback source byte-for-byte, checkAuth + checkPlatformAdmin middleware positions, request-time Boolean(refresh), reschedule shape, timestamp/TTL computation, and version.
- Files: server.ts, services/internalSchemaStatusRouteHandler.ts, tests/internalSchemaStatusRouteHandler.test.ts, scripts/pre-main-gate.mjs, this checkpoint.
- Evidence: full-server reverse transformation restores the baseline byte-for-byte; registered route unique and located between health details and MFA setup; direct HTTP regression covers 401 unauthenticated, 403 without platform-admin, zero unauthorized schema queries, 200 body, refresh truthiness, TTL/null times.
- A temporary one-shot GitHub workflow/patch script validates the original Git SHA, runs test and production build, cleans up itself and pushes only the result. It is NOT retained in the PR. GitHub staging CI checks the final branch HEAD and the new test is part of the existing pre-main ratchet.
- Implementation commit: `d7dd7c2cd6a88e88886431e79edafc02247c30a9`; open PR [#388](https://github.com/appverto1/Verto1/pull/388) targeting `staging`. This documentation follow-up commit advances the final HEAD; independently verified final GitHub Actions CI evidence is appended to PR metadata. No merge, smoke or deploy.
- Collision scan: PR #381 changes distinct clinic routes in server.ts; #383 handles /api/health/details; #387 handles /api/auth/config. The extraction is between the health and auth routes and does not modify their handlers. Revalidation is mandatory before concurrent merges.
- No behavior, security, permission, session, SQL, Supabase, Stripe/webhook, Resend, billing, clinical saves, environment or production configuration changes.
- Progress: this 1/1 selected route is implemented (100%). Proposed server.ts line delta: 19/102066. Staging is still 0/102066 (0%) until authorized merge. Global backend completion not auditable without bounded scope.
- Independent and idempotent; no Fábrica Verto, Issues or factory checkpoints involved.
