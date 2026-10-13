# Portal family appointment read-only modularization — 2026-10-13

- Original staging commit: `52e2686c21d284ee0e948f9827b4719032a328e6`.
- Exact original `server.ts` Git blob: `36af849f70c27af3bb1a47d8130e5266d60ea9be`.
- Cohesive single slice: three GET routes (family appointment list, appointment detail, rescheduling slots), all handlers copied unchanged to `services/portalAppointmentReadHandlers.ts`.
- Middleware registration remains at the same original place and in the same original order in `server.ts`.
- All dependencies are explicit lazy closure captures; same Supabase queries, tenant checks, role-scoping, HTTP payloads, logs and failure handling.
- No writes, migrations, Stripe, Resend or database changes; write endpoints for confirmation and rescheduling untouched.
- Exact source round-trip and original blob SHA guard checked before editing. AST parse check. Per-route historical SHA256 and middleware headers recorded in sibling JSON manifest.
- Before: 99101 lines; after: 98804 lines; reduction: 297 lines. Not a measure of architecture completion.
- Node20 HTTP auth and negative-path regressions, typecheck and build required before PR; standard staging CI required before merge.
- Disposable branch-only workflow/script must be removed from final proposed diff.
- [PR #404](https://github.com/appverto1/Verto1/pull/404) opened against staging; extracted branch commit `53abc7e27c23f6a2ea58eac4dfe030a0591a2600`.
- [Isolated Node20 CI run 38344459999](https://github.com/appverto1/Verto1/actions/runs/38344459999) SUCCESS: guard, reversible edit, six negative/contract tests, isolated tsc, build, diff-check, branch commit. Staging CI on PR #404 pending at this checkpoint. Merge/deployment not performed as of PR opening.
- A different ABA-chart read extraction advanced staging by one commit during branch validation; no source-route overlap was observed. Check actual PR mergeability and post-merge CI prior to rollout.
