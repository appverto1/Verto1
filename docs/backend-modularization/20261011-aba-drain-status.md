# Backend modularization — ABA V3 drain status route

- Baseline staging: 5fc564ba5b11bef1f21b56e4f81fd6c43e587f60; server blob aa914fac455bbd82fab898843cdee795acccf33a.
- Scope: extract only GET /api/aba/v3/admin/drain-status handler, leaving requireAbaV3PreflightFeature, checkAuth and checkPlatformAdmin at the same route registration and in the same order.
- Exact handler body preserved through dependency injection; same scope checks, RPC, cache-control private no-store, HTTP 400/422/500 and return objects. No business logic change.
- Verified source roundtrip byte-for-byte, handler uniqueness, API middleware order. Tested directed mock handler + build. CI pre-main runs the new directed test.
- Candidate server reduction: 25 lines, staging only after approved merge. Whole-backend completion unknown.
- Files: server.ts, services/abaV3DrainStatusHandler.ts, tests/abaV3DrainStatusHandler.test.ts, scripts/pre-main-gate.mjs, this checkpoint.
- One-shot workflow and script are deleted from feature branch prior to commit. No merge/deploy/production and no Factory/Issues.
- Other open server PRs #381, #383, #387, #388, #392 target distinct route handlers; integrate against fresh current base and re-run tests to avoid lost changes.
