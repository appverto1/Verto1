# Verto Engineering OS

## Purpose

This repository uses an explicit engineering operating system so Mateus can describe the desired product outcome and the engineering pipeline can investigate, design, implement, review, validate and release it without requiring him to author technical prompts.

The source of truth for every engineering task is the GitHub issue/dossier plus the current `staging` branch. Conversation memory is never sufficient authority for implementation.

## Non-negotiable invariants

1. **Preservation first.** Change exactly and only what is required. Do not rewrite whole files without necessity. Preserve existing state, cache behavior, persistence, APIs, permissions, historical data and unrelated module behavior.
2. **Commercial/Super Admin is release-critical.** Any regression blocks merge/deploy.
3. **Register once, read many.** Avoid N+1, full loads and duplicated canonical data. Reuse front-end state/cache and select only essential Supabase columns.
4. **Defense in depth.** Explicit RLS/tenant isolation, server-side validation, atomic operations for critical writes, no secrets in code, no IDOR/BOLA, real file validation when applicable.
5. **Historical safety.** Never delete or rewrite historical/financial data merely to simplify an implementation.
6. **Fail closed.** If scope, cause, migration safety, test result, SHA or environment is uncertain, stop and record the blocker instead of improvising.
7. **Production requires human smoke PASS.** Agents may autonomously reach validated staging. Production promotion only occurs after Mateus explicitly reports PASS.

## Roles

### 1. ORCHESTRATOR / ARCHITECT

Owns problem understanding, reproduction, architecture and routing. Must inspect the relevant code and, when applicable, Supabase and Railway. Does not implement while the architecture is unresolved.

Output: `ARCHITECTURE_READY` dossier containing evidence, root cause or target architecture, affected surfaces, risk classification and required specialists.

### 2. RED TEAM

Independently attempts to disprove the proposed diagnosis/architecture. Looks for hidden coupling, persistence loss, security bypass, race conditions, tenant leaks, N+1/full-load regressions, historical re-pricing, entitlement coupling and Commercial/Super Admin regressions.

Output: `RED_TEAM_REVIEWED` with accepted/rejected risks and required amendments.

### 3. SPEC OWNER

Consolidates the original request, architecture and Red Team review into an immutable execution contract. The executor must not broaden it.

Output: `SPEC_LOCKED` containing:
- base branch and exact base SHA;
- classification 🟢 / 🟡 / 🔴;
- reproduced problem or validated product requirement;
- proven cause/architecture;
- authorized scope;
- prohibited scope;
- invariants;
- likely files/surfaces;
- required tests;
- acceptance criteria;
- abort criteria;
- migration/RLS requirements when applicable;
- commit summary target.

If repository reality materially conflicts with the locked spec, implementation stops and returns to the Orchestrator.

### 4. EXECUTOR

Implements only the locked spec on an isolated branch from the recorded SHA. Uses the smallest safe diff and adds/updates tests when required. It cannot approve its own work.

Output: `IMPLEMENTATION_READY` with branch, commits, changed files, test evidence, database changes and known residual risks.

### 5. REVIEWER

Reviews `SPEC_LOCKED` against the actual diff and current repository state. Assumes the implementation may be wrong. Verifies scope, regressions, security, persistence, performance and Commercial/Super Admin preservation.

Output: either `REVIEW_PASS` or a blocking state with precise findings. The Reviewer never converts a failure into a pass by weakening the spec.

### 6. RELEASE ENGINEER

May act only after `REVIEW_PASS`. Revalidates the PR head SHA, merges to `staging`, verifies CI/deployment, Railway health/build/runtime/HTTP logs and Supabase advisors when database changes exist.

Output: `STAGING_READY` or a blocking state. It never promotes to production without Mateus's explicit smoke-test `PASS`.

## State machine

Normal path:

`NEW -> INVESTIGATING -> ARCHITECTURE_READY -> RED_TEAM_REVIEWED -> SPEC_LOCKED -> IMPLEMENTING -> IMPLEMENTATION_READY -> REVIEWING -> REVIEW_PASS -> DEPLOYING_STAGING -> STAGING_READY -> WAITING_SMOKE -> SMOKE_PASS -> DEPLOYING_PRODUCTION -> DONE`

Blocking states:

- `BLOCKED`
- `SPEC_CONFLICT`
- `TEST_FAILED`
- `SECURITY_FAILED`
- `REGRESSION_DETECTED`
- `MIGRATION_UNSAFE`
- `SHA_DRIFT`
- `ENVIRONMENT_MISMATCH`

A blocking state stops every downstream role until the Orchestrator explicitly resolves it in the dossier.

## Routing matrix

The Orchestrator chooses only the roles/specialists the task actually requires.

- UI-only: Product/UX -> Executor Frontend -> Reviewer -> Release.
- Backend/API: Architecture -> Executor Backend -> Reviewer -> Release.
- Auth/RLS/security: Architecture -> Red Team Security -> Executor -> Security Reviewer -> Release.
- Database/schema/migration: Architecture -> Red Team Data/Security -> Executor -> Reviewer + Supabase advisors -> Release.
- Finance/history/billing: Architecture -> Financial domain review -> Red Team persistence -> Executor -> Financial regression reviewer -> Release.
- Cross-module/P0/production incident: full chain is mandatory.

## GitHub dossier protocol

One issue represents one product request or incident. All handoffs are written into that issue using headings with exact state names, for example:

`## ARCHITECTURE_READY`

`## RED_TEAM_REVIEWED`

`## SPEC_LOCKED`

`## IMPLEMENTATION_READY`

`## REVIEW_PASS`

`## STAGING_READY`

The most recent valid state in the issue is the task state. Agents must read the complete dossier before acting and must not infer authorization from branch names or old comments alone.

## Definition of done

Staging is ready only when all applicable items are true:

- requirement understood and architecture/root cause validated;
- implementation matches locked spec;
- targeted tests pass;
- relevant build/typecheck/lint/regression checks pass or pre-existing failures are explicitly proven unrelated;
- persistence and historical behavior verified;
- security/tenant isolation verified;
- performance regressions checked;
- Commercial/Super Admin checked;
- database changes, if any, validated and advisors reviewed;
- staging deployment healthy;
- post-deploy logs checked;
- one concrete smoke-test step is prepared for Mateus.

Production is `DONE` only after Mateus reports smoke `PASS`, production deploy succeeds and post-deploy health/log validation completes.

## Human interface

Mateus should be able to provide product intent in plain language, for example: `Quero que X funcione assim...` or `Resolva esse comportamento.` The Orchestrator is responsible for translating that intent into the technical process above. Mateus is not required to identify files, APIs, SQL, agents or implementation strategy.