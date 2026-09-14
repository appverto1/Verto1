# Verto Engineering PR Gate

## Task dossier
- Issue/spec:
- Classification: 🟢 / 🟡 / 🔴
- Principal writer:
- `GLOBAL_WRITE_LOCK`: INACTIVE / ACTIVE
- Locked base SHA:
- Branch head SHA:

## Scope contract
- Authorized scope:
- Explicitly prohibited scope:
- Why every changed file is necessary:

## Changed files
- [ ] Every changed file is listed and justified.
- [ ] No unrelated refactor/rewrite was introduced.
- [ ] Existing state/cache/persistence contracts remain intact unless explicitly authorized.
- [ ] Commercial/Super Admin remains intact.

## Functional validation
- Targeted tests:
- `npm ci`:
- Typecheck:
- Build:
- `npm run check:pre-main`:
- Relevant regression tests:
- Proven pre-existing unrelated failures:

## Persistence / history
- [ ] No destructive replacement of historical data.
- [ ] Idempotence checked where applicable.
- [ ] Existing clinical/financial history remains addressable.
- [ ] Repeated save/reload/relogin behavior checked where applicable.

## Database / Supabase
- Migration: `none` / describe
- RLS impact: `none` / describe
- Atomicity/transaction impact: `none` / describe
- Advisor results: `n/a` / describe
- [ ] No secret/service-role value was added to source code.
- [ ] Queries select only necessary columns and avoid N+1/full-load regressions.

## Reviewer — 03
Reviewer compares the actual diff against `SPEC_APPROVED`.
- Review result: `REVIEW_PASS` / blocking state
- Scope preservation:
- Security verdict:
- Persistence/history verdict:
- Performance verdict:
- Commercial/Super Admin verdict:

## CI — 10
- Workflow/run:
- Validated head SHA:
- CI result: `CI_PASS` / blocking state

## PR Engineer — 11
- [ ] PR metadata matches the Issue contract.
- [ ] Changed-file justification is complete.
- [ ] Commit/release summary is complete.
- Result: `PR_READY` / blocking state

## Merge Gatekeeper — 12
Immediately before merge:
- [ ] Expected PR head SHA revalidated.
- [ ] Base drift checked.
- [ ] Required CI is passing.
- [ ] `REVIEW_PASS` is recorded.
- [ ] Issue is in a merge-eligible state.

If required checks are failing/pending, do not merge even if GitHub technically allows it.

## Rollout — 13
After merge to `staging`:
- [ ] Railway deployment matches merged staging SHA.
- [ ] Build/runtime/HTTP health checked.
- [ ] Supabase staging/advisors checked after applicable database changes.
- [ ] Failures are routed to 14 — Recovery/Incident.
- Result: `STAGING_VERIFIED` / blocking state

## Smoke handoff
- Highest automatic state: `SMOKE_READY`.
- Exactly one first smoke-test step is prepared for the founder.
- Production is forbidden in the default autonomous flow.

## Commit / release summary
Provide the final summary suitable for commit/release history here.
