---
name: Verto Engineering Task
about: Product request or incident handled by the Verto Engineering OS
title: "[VERTO] "
labels: ""
assignees: ""
---

# PRODUCT INTENT

Describe only the desired outcome, observed problem or user experience. Technical implementation is not required here.

# USER IMPACT

Who is affected, in which environment, and what is happening today?

# EXPECTED EXPERIENCE

What should the user be able to do when this task is complete?

# EVIDENCE

Screenshots, reproduction steps, logs, examples, patient/clinic test context using non-sensitive identifiers, or other evidence.

# INITIAL CONSTRAINTS

Any explicit product/business constraints supplied by Mateus.

---

# ENGINEERING DOSSIER

> Downstream agents append their sections below. Never delete previous evidence or overwrite an earlier handoff.

## NEW

- Requested by:
- Created at:
- Target environment: `staging`

## INVESTIGATING

_To be completed by Orchestrator/Architect._

## ARCHITECTURE_READY

Required fields:
- base `staging` SHA:
- classification: 🟢 / 🟡 / 🔴
- reproduction/validation evidence:
- root cause or target architecture:
- affected surfaces:
- dependencies/couplings:
- specialist routing:
- risks:

## RED_TEAM_REVIEWED

Required fields:
- independent counter-analysis:
- disproved assumptions:
- accepted risks:
- required amendments:
- recommendation: proceed / block

## SPEC_LOCKED

Required fields:
- exact base SHA:
- authorized scope:
- prohibited scope:
- invariants to preserve:
- expected files/surfaces:
- security requirements:
- persistence/history requirements:
- performance requirements:
- required tests:
- acceptance criteria:
- abort criteria:
- migration/RLS plan or `none`:
- target commit summary:

## IMPLEMENTATION_READY

Required fields:
- branch:
- head SHA:
- commits:
- changed files:
- implementation summary:
- tests executed/results:
- database changes:
- residual risks:

## REVIEW_PASS

Required fields:
- spec vs diff verdict:
- scope preservation:
- security verdict:
- persistence/history verdict:
- performance verdict:
- Commercial/Super Admin verdict:
- regression verdict:
- required CI/test evidence:
- reviewer conclusion:

## STAGING_READY

Required fields:
- merged staging SHA:
- Railway deployment:
- build/runtime/HTTP log verdict:
- Supabase advisor verdict when applicable:
- known pre-existing failures:
- smoke test step 1:

## WAITING_SMOKE

Mateus performs the smoke test one step at a time.

## SMOKE_PASS

Only valid when Mateus explicitly reports `PASS`.

## DONE

Required fields:
- production SHA/deployment when applicable:
- post-deploy health/log verdict:
- final completion percentage:
- final commit/release summary:
