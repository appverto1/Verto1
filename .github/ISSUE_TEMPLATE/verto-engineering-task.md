---
name: Verto Engineering Task
about: Contrato operacional para qualquer alteração conduzida pela fábrica 00–14
title: "[VERTO] "
labels: ""
assignees: ""
---

# REQUEST

## Objective

Describe the desired outcome in product/operational terms.

## Context

Why this matters now, who is affected and in which environment.

## Current behavior

What happens today. Include evidence/reproduction when applicable.

## Expected behavior

What must be true when the task is complete.

---

# EXECUTION CONTRACT

## Classification

- Risk: 🟢 / 🟡 / 🔴
- Reason:

> Classification defines HOW this task is executed, not WHETHER it is executed.

## Chosen architecture

- Architecture/approach:
- Why this approach:
- Alternatives rejected:
- Relevant dependencies/couplings:

## Acceptance criteria

1.
2.
3.

## Out of scope

- 

## Risks

- 

## Preservation requirements

- [ ] Change exactly and only authorized scope.
- [ ] Preserve existing state/cache/persistence contracts unless explicitly in scope.
- [ ] Preserve permissions and tenant boundaries unless explicitly in scope.
- [ ] Preserve clinical/financial history.
- [ ] Preserve Commercial/Super Admin functionality.
- [ ] Avoid unrelated rewrites/refactors.

## Modules / surfaces

- Affected modules:
- Shared services/contracts:
- External integrations:

## Database

- Migration: `none` / describe
- RLS impact: `none` / describe
- RPC/transaction impact: `none` / describe
- Data backfill/reconciliation: `none` / describe
- Rollback/recovery notes:

## Security

- Tenant isolation / IDOR / BOLA:
- Server-side authorization/validation:
- Atomicity/race conditions:
- File validation when applicable:
- Secret handling:

## UX

- UX impact: `none` / describe
- Responsive/accessibility requirements:
- Copy/interaction requirements:

## Tests

- Targeted tests:
- Shared regression gates:
- Persistence/relogin validation when applicable:
- Commercial/Super Admin regression validation:

## Git contract

- Base branch: `staging`
- Exact base SHA:
- Planned branch:
- Principal writer: 04 / 05 / 06 / 07 / 08 / 09 / other explicit writer
- `GLOBAL_WRITE_LOCK`: `INACTIVE` / `ACTIVE`
- Target commit summary:

## Control

- Current agent: 00–14
- Current state: `INTAKE`
- Next gate:
- Target environment: `staging`

---

# ENGINEERING DOSSIER

> Agents append handoffs below. Do not delete previous evidence or silently weaken an earlier contract. Any material scope/architecture change returns to 00.

## INTAKE

Required:
- founder intent captured:
- evidence/reproduction summary:
- initial affected surfaces:

## DESIGN_AUDIT

Owned by 00 with 01 and/or 03 when relevant.

Required:
- repository/infrastructure evidence:
- root cause or validated target architecture:
- classification:
- specialist routing:
- principal writer:
- `GLOBAL_WRITE_LOCK` status:
- risks/challenges raised by 01:
- UX/product amendments from 03 when applicable:
- decision:

## SPEC_APPROVED

Required before implementation:
- exact base SHA:
- authorized scope:
- prohibited scope:
- invariants:
- expected files/surfaces:
- database/RLS plan or `none`:
- security requirements:
- persistence/history requirements:
- performance requirements:
- required tests:
- acceptance criteria:
- abort/stop-loss criteria:
- target commit summary:
- next gate:

## IMPLEMENTATION_READY

Principal writer records:
- branch:
- head SHA:
- commits:
- changed files:
- implementation summary:
- tests run locally/by available tooling:
- database changes:
- residual risks:
- preservation notes:

## DB_GATE

Required only when database work exists; owned/coordinated by 09.

- migration/RLS verdict:
- atomicity/integrity verdict:
- rollback/recovery verdict:
- staging application evidence:
- advisor evidence:
- result: `PASS` / blocking state / `n/a`

## CI

Owned by 10.

- workflow/run:
- PR head SHA validated:
- `npm ci`:
- typecheck:
- build:
- `check:pre-main`:
- targeted tests:
- pre-existing unrelated failures, if any:
- result: `CI_PASS` / `TEST_FAILED` / `REGRESSION_DETECTED`

## REVIEW

Owned by 02.

- spec vs diff verdict:
- unexplained scope verdict:
- persistence/history verdict:
- security/tenant verdict:
- performance verdict:
- Commercial/Super Admin verdict:
- regression verdict:
- result: `REVIEW_PASS` / blocking state

## PR

Owned by 11.

- PR number/link:
- base:
- head SHA:
- changed-file justification complete:
- commit/release summary complete:
- result: `PR_READY` / blocking state

## MERGE

Owned by 12.

Before merge revalidate:
- expected head SHA:
- base drift:
- CI status:
- review status:
- Issue contract state:
- merge decision:
- merged staging SHA:

> Native GitHub permissions are not authorization to bypass this gate. 12 refuses merge when any required gate is failing/pending.

## ROLLOUT

Owned by 13; route failures to 14.

- Railway staging deployment:
- deployed commit SHA:
- build verdict:
- runtime verdict:
- HTTP/health verdict:
- Supabase staging/advisor verdict when applicable:
- recovery required: yes/no

## STAGING_VERIFIED

Required:
- merged/deployed SHA matches:
- all applicable gates passed:
- known residual risks:
- Commercial/Super Admin preservation:
- first human smoke step prepared:

## SMOKE_READY

This is the highest automatic state.

- Smoke step 1:
- Waiting for Mateus: `PASS` / failure report

Do not provide multiple smoke steps at once.

---

# FAILURE / RECOVERY STATES

Use when applicable and keep the Issue open:

- `BLOCKED`
- `SPEC_CONFLICT`
- `TEST_FAILED`
- `SECURITY_FAILED`
- `REGRESSION_DETECTED`
- `MIGRATION_UNSAFE`
- `SHA_DRIFT`
- `ENVIRONMENT_MISMATCH`
- `ROLLOUT_FAILED`
- `STOP_LOSS_REQUIRED`

Failure route:

`DIAGNOSE -> ROUTE -> FIX -> REVALIDATE -> resume pipeline`

`STOP_LOSS_REQUIRED` is reserved for serious, concrete and non-mitigable destructive risk. Redesign to a reversible/staged approach before escalating whenever possible.

# PRODUCTION

Production is outside the default autonomous flow. `DONE` is not valid before human smoke PASS and a separately authorized production flow when production deployment is applicable.