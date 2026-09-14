# Verto Engineering PR Gate

## Task dossier

- Issue/spec:
- Locked base SHA:
- Branch head SHA:
- Classification: 🟢 / 🟡 / 🔴

## Scope contract

- Authorized scope:
- Explicitly prohibited scope:
- Why every changed file is necessary:

## Changed files

- [ ] Every changed file is listed and justified.
- [ ] No unrelated refactor/rewrite was introduced.
- [ ] Existing state/cache/persistence contracts remain intact unless explicitly authorized.

## Functional validation

- Targeted tests:
- Build/typecheck/lint:
- Relevant regression tests:
- Pre-existing failures proven unrelated:

## Persistence / history

- [ ] No destructive replacement of historical data.
- [ ] Idempotence checked where applicable.
- [ ] Existing financial/clinical history remains addressable.
- [ ] Repeated save/reload/relogin behavior checked where applicable.

## Database / Supabase

- Migration: `none` / describe
- RLS impact: `none` / describe
- Atomicity/transaction impact: `none` / describe
- Advisor results: `n/a` / describe
- [ ] No secret/service-role value was added to source code.
- [ ] Queries select only necessary columns and avoid N+1/full-load regressions.

## Security review

- [ ] Tenant isolation / IDOR / BOLA checked.
- [ ] Server-side authorization checked.
- [ ] Server-side input/file validation checked where applicable.
- [ ] No entitlement/capability bypass or accidental coupling introduced.
- [ ] No unsafe SECURITY DEFINER/public privileged path introduced.

## Critical preservation

- [ ] Commercial/Super Admin remains functional.
- [ ] Unrelated modules remain unchanged.
- [ ] Existing permissions/capabilities remain unchanged unless explicitly in scope.
- [ ] Rollback/recovery path is understood for critical changes.

## Reviewer contract

Reviewer must compare the actual diff against `SPEC_LOCKED`, not merely judge whether the code looks reasonable. Any unexplained extra scope is blocking.

## Release gate

- [ ] REVIEW_PASS recorded in the task dossier.
- [ ] Expected PR head SHA revalidated before merge.
- [ ] Staging deployment verified after merge.
- [ ] Railway build/runtime/HTTP logs checked.
- [ ] Supabase advisors checked after applicable DDL.
- [ ] Exactly one first smoke-test step prepared for Mateus.

Production deployment is forbidden until Mateus explicitly reports smoke `PASS`.

## Commit summary

Provide the final summary suitable for commit/release history here.