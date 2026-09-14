---
name: Verto Engineering Task
about: Contrato operacional da fábrica Verto
 title: "[VERTO] "
labels: ""
assignees: ""
---

# REQUEST

## Objective

## Context

## Current behavior

## Expected behavior

# EXECUTION CONTRACT

## Classification
- Risk: 🟢 / 🟡 / 🔴
- Reason:

> Classification defines HOW this task is executed, not WHETHER it is executed.

## Chosen architecture
- Approach:
- Why:
- Alternatives rejected:
- Dependencies/couplings:

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
- [ ] Preserve state/cache/persistence contracts unless explicitly in scope.
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
- Backfill/reconciliation: `none` / describe
- Rollback/recovery notes:

## Security
- Isolation/permissions:
- Server-side authorization/validation:
- Atomicity/concurrency:
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
- `active_handoff`:
- `attempt`: 1
- `handoff_count`: 0
- `discussion_cycle`: 0/2
- Next gate:
- Target environment: `staging`

# CANONICAL ROSTER
00 Orchestrator
01 Auditor / Red Team
02 Product & UX Architect
03 Reviewer / QA
04 Prontuário
05 Integration
06 Financeiro
07 Agenda
08 ABA
09 Supabase / Data
10 CI / Regression
11 PR Engineer
12 Merge Gatekeeper
13 Rollout / Deploy
14 Recovery / Incident

Strategic debate: `00 -> 01 -> 02 -> 00`, maximum 2 complete cycles. If disagreement remains, 00 decides and records rationale.

# ENGINEERING DOSSIER

## INTAKE
- founder intent:
- evidence/reproduction:
- initial surfaces:

## DESIGN_AUDIT
Owned by 00 with 01 and/or 02 when relevant.
- repository/infrastructure evidence:
- validated architecture:
- classification:
- specialist routing:
- principal writer:
- write lock:
- risks from 01:
- product/UX amendments from 02:
- decision:

## SPEC_APPROVED
- exact base SHA:
- authorized scope:
- prohibited scope:
- invariants:
- expected files/surfaces:
- database plan or `none`:
- security requirements:
- persistence/history requirements:
- performance requirements:
- required tests:
- acceptance criteria:
- stop-loss criteria:
- next gate:

## IMPLEMENTATION
Principal writer records:
- branch:
- head SHA:
- commits:
- changed files:
- implementation summary:
- tests:
- database changes:
- residual risks:

## DB_GATE
Owned/coordinated by 09 when needed.
- verdict:
- integrity/recovery notes:
- staging evidence:

## CI
Owned by 10.
- workflow/run:
- validated head SHA:
- install/typecheck/build/pre-main:
- targeted tests:
- pre-existing unrelated failures:
- result: `CI_PASS` / blocking state

## REVIEW
Owned by 03.
- spec vs diff:
- scope preservation:
- persistence/history:
- security/isolation:
- performance:
- Commercial/Super Admin:
- result: `REVIEW_PASS` / blocking state

## PR
Owned by 11.
- PR:
- base:
- head SHA:
- changed-file justification:
- release summary:

## MERGE
Owned by 12.
- expected head SHA:
- base drift:
- CI:
- review:
- merge decision:
- merged staging SHA:

## ROLLOUT
Owned by 13; failures route to 14.
- Railway staging deployment:
- deployed SHA:
- build/runtime/health:
- data checks when applicable:
- recovery required:

## SMOKE_READY
Highest automatic state.
- first human smoke step:
- waiting for founder: PASS / failure report

# FAILURE / RECOVERY
Use as needed: `SPEC_CONFLICT`, `TEST_FAILED`, `SECURITY_FAILED`, `REGRESSION_DETECTED`, `MIGRATION_UNSAFE`, `SHA_DRIFT`, `ENVIRONMENT_MISMATCH`, `ROLLOUT_FAILED`, `STOP_LOSS_REQUIRED`.

Failure route: `DIAGNOSE -> ROUTE -> FIX -> REVALIDATE -> resume`.

# PRODUCTION
Production is outside the default autonomous flow. `DONE` is not valid before human smoke PASS and any separately authorized production flow.
