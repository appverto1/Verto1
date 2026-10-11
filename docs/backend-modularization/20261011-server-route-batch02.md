# Backend modularization batch 02 — direct extraction of 12 clinic authorization, membership and work-schedule handlers

Baseline: `server.ts` blob `a301111eac512996c2a019b728e080b9aa54b63a` from PR #380, branch `refactor/backend-server-route-batch02-20261011`.

All 12 exact AST handlers move into two service modules, preserving the original route declarations, method, URL, ALL existing middleware expressions and their order in `server.ts`. Original statements copied as-is (except removing harmless trailing whitespace); access to original lexical dependencies via lazy per-request getter. Context type definition copied verbatim and types imported from existing modules. No database/schema/RLS/Stripe/production writes. One-time GitHub Actions writer commits to isolated feature branch only after structural checks, typecheck, build and clean diff; temporary writer removed prior to PR.

## Extraction performed
- Strict original SHA and AST guards, byte-for-byte source roundtrip before any writes.
- 12 handlers, 9 clinic access/membership and 3 schedule, method/path/middleware preserved.
- New server lines: 102028 -> 100990 (removed 1038).
- Per-handler SHA256 and middleware preserved in committed manifest. No merge/deploy.

## Validation of direct reduction and required CI coverage

- GitHub Actions isolated-writer [run 38160108833](https://github.com/appverto1/Verto1/actions/runs/38160108833) **success**: exact Git blob check, twelve original AST route/middleware checks, byte-roundtrip, typecheck and production build; bot committed only to isolated feature branch.
- Standalone focused read-only [run 38160386822](https://github.com/appverto1/Verto1/actions/runs/38160386822) **success**: **31 executable handler scenarios**, structural contract regression, typecheck and build.
- Direct reduction verified: `server.ts` 102,028 -> **100,990 lines**, **−1,038** relative to PR #380, Git blob `1190f72721e0bf56e57f8805d49829934fc8d707` at 4,717,398 bytes. Compared with pristine staging, 102,066 -> 100,990, **−1,076 lines**, approx 1.054% of original lines (candidate only; staging not modified).
- Migrated bodies include 1,052 original handler lines. Nine routes to `services/clinicAccessMembershipHandlers.ts`, three routes to `services/clinicWorkScheduleHandlers.ts`. Original method/path/middleware arguments remain in server.ts, preserving sequential registration.
- A new `tests/serverRouteBatch02SourceParity.test.mjs` reads the baseline Git blob and compares all twelve original AST statement sequences byte-faithfully (except trailing whitespace) to the moved implementations. It is now a required CI step; verify results before claiming success.
- Cleanup: branch-only writer workflow and two one-shot scripts removed from the final PR; only production code, tests, the manifest and checkpoint remain. Workflow `.github/workflows/staging-ci.yml` requires structural, original-statement parity and functional regressions in the regular staging gate.
- The branch stacks on PR #380, which already contains ten tested extractions from PR #379. The new PR should be the sole merge candidate. Do not merge ancestors independently, and no deploy, DB write or staging smoke has occurred.

## Final pre-main structural regression repair

- First staging CI run [38160586175](https://github.com/appverto1/Verto1/actions/runs/38160586175) passed Node 20 typecheck, build, all ten batch 01 tests, /api/ready tests and all three new batch 02 regressions. Its pre-main gate found one **test-location-only** failure: `tests/teamManagementTenantRefresh.regression.test.mjs` looked for member-role projections in `server.ts` after the GET handler moved to the module.
- Updated this existing regression to inspect **the same original `role: m.role` and `not m.users.role` assertions** in `services/clinicAccessMembershipHandlers.ts`; added a guard that `server.ts` still registers the original clinic team capability middleware on the same GET URL. All other tenant-switching freshness assertions stay identical.
- Verify the full CI again on the new HEAD before claiming green. No behavior or billing/security logic rewritten, and no merge/deploy.
