# Backend modularization batch 02 — direct extraction of 12 clinic authorization, membership and work-schedule handlers

Baseline: `server.ts` blob `a301111eac512996c2a019b728e080b9aa54b63a` from PR #380, branch `refactor/backend-server-route-batch02-20261011`.

All 12 exact AST handlers move into two service modules, preserving the original route declarations, method, URL, ALL existing middleware expressions and their order in `server.ts`. Original statements copied as-is (except removing harmless trailing whitespace); access to original lexical dependencies via lazy per-request getter. Context type definition copied verbatim and types imported from existing modules. No database/schema/RLS/Stripe/production writes. One-time GitHub Actions writer commits to isolated feature branch only after structural checks, typecheck, build and clean diff; temporary writer removed prior to PR.

## Extraction performed
- Strict original SHA and AST guards, byte-for-byte source roundtrip before any writes.
- 12 handlers, 9 clinic access/membership and 3 schedule, method/path/middleware preserved.
- New server lines: 102028 -> 100990 (removed 1038).
- Per-handler SHA256 and middleware preserved in committed manifest. No merge/deploy.
