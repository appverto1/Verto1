# Backend modularization — public auth configuration route

- Date: 2026-10-11. Baseline staging e78a05511dfd03b82d32d92d44f4231004d71a64, server blob b5460aa69d3cee3ff6ec96849f61537974007997 (102,066 original lines).
- Scope: GET /api/auth/config only, same registration position (after signup-direct and before resend-confirmation), same handler body, status 200/500, payload keys, error handling, redirect evaluation, environment precedence and sanitization.
- Source parity: original server source reconstructed byte-for-byte by reversing import and handler replacement; single-route registration asserted.
- Files: server.ts, services/authConfigRouteHandler.ts, tests/authConfigRouteHandler.test.ts, scripts/pre-main-gate.mjs, this checkpoint. No runtime dependency changes outside the route.
- Test: new Node 20 TS test calls local mock Express endpoint for HTTP 200/500, failed callback short circuit, URL fallback, response fields and route ordering; automatically executed in pre-main gate.
- Branch: `refactor/backend-auth-config-route-20261011`. Implementation commit: `dfe7d414125a944c3ceb327aa5fce7a2cfbdb527`. PR [#387](https://github.com/appverto1/Verto1/pull/387) against `staging`. This docs-only checkpoint commit advances the final HEAD; GitHub Actions CI results are recorded in the PR after final verification. No merge/deploy.
- Temporary one-shot workflow and script remove themselves before the commit/push. No changes to secrets, production, Stripe, Resend, Supabase, RLS, clinic/patient roles, clinical saves, HTTP middleware or request volume.
- Other pending PRs #381/#383 change distinct sections of server.ts, and #383 changes a different portion of pre-main gate. Any eventual merge requires current-base conflict and regression checks.
- Progress: one selected route out of one extracted (100% slice). Candidate direct reduction: 10/102066 lines. Staging stays 0/102066 (0%) until authorized integration. Whole backend denominator unknown.
- No merge/deploy/smoke of a live environment; no Fábrica Verto or Issues dependency.
