# Verto Clinical Measurement Engine V3 — Architecture Baseline 1.0

**Status:** Accepted production baseline  
**Date:** 2026-08-20  
**Scope:** Clinical Measurement Engine V3  
**Implementation status:** Implemented for the production baseline; scoped compatibility exceptions are listed below  

## Purpose

This directory records the architecture decisions, semantic contract, threat model and verification matrix that govern the Verto Clinical Measurement Engine V3.

The V3 engine is additive and is now the production Default-On authority for semantically supported/readiness-green ABA targets, while V2 remains historical/compatibility. No document in this baseline authorizes destructive migration, silent reinterpretation of historical data, or backfill of semantics that were not originally observed.


## Current implementation state — 2026-08-23

The production baseline implements versioned identities/definitions, bitemporal activation and phase epochs, typed sessions/expectations/streams, append-only raw primitives, ABA-specific primitives, idempotent bulk ingestion, projection queues/read models, semantic decision/evidence APIs, canonical ABA analytics, Plan/PTS generic writing/reading and patient-scoped presentation caching.

Operationally, ABA V3 uses `V3_DEFAULT_ON` plus `DEFAULT_INHERIT`; explicit false state remains a kill switch. Session-target bindings are immutable and may be materialized on explicit access to a target planned as V3 without creating a clinical trial.

Scoped compatibility remains intentional rather than hidden:

- ABC has no invented V3 semantic model and remains Legacy V2.
- Historical V2 data is not rewritten into V3.
- Simplified Plan/PTS Task Analysis collection remains on compatibility flow until the full step-level universal contract is used there.
- ADR-0007 is implemented for canonical ABA reliability/IOA and paired reliability streams; a broader multidisciplinary versioned Reliability Profile remains an extension, not a blocker for the current ABA production baseline.

Current operations are documented in `docs/operations/ABA_V3_PRODUCTION_RUNBOOK.md`; the older pilot runbook is historical.

## Architectural principles

1. Raw clinical observations are append-only.
2. Projections and read models are derived and reconstructible.
3. Clinical semantics are server-authoritative.
4. Measurement families preserve their mathematical nature.
5. Clinical time and system knowledge time are distinct.
6. Historical corrections append knowledge instead of rewriting history.
7. Canonical and exploratory analyses have different authority.
8. Clinical decisions are distinct from current evidence support and workflow attention.
9. Observation denominators may not double-count overlapping time within the same stream.
10. Offline and bulk ingestion must be idempotent and tenant-safe.

## Directory map

- `adr/` — immutable architecture decisions after acceptance.
- `contracts/` — semantic API contract consumed by presentation clients.
- `security/` — living threat model.
- `verification/` — traceability from invariants and threats to automated tests.

## ADR lifecycle

- `Proposed`: may be edited while under review.
- `Accepted`: decision is frozen. Material changes require a new ADR that supersedes the old one.
- `Superseded`: retained for historical context and linked to its replacement.
- `Rejected`: retained when the rejected alternative is architecturally important.

Accepted ADRs must not be silently rewritten.

## Canonical ADR template

```md
# ADR-000X — Title

Status: Proposed
Date: YYYY-MM-DD
Decision owners: Clinical Measurement Architecture
Scope: Clinical Measurement Engine V3
Related ADRs: ...
Supersedes: —
Superseded by: —
Implementation status: Not started

## Context
## Decision
## Architectural Invariants
## Rejected Alternatives
## Consequences
### Positive
### Negative / Cost
### Operational
## Security Considerations
## Verification
## References
```

## Change discipline

If implementation work reveals an unresolved structural question, the implementation must not invent a local answer. Resolve the question in a Proposed ADR, or create a new ADR if an Accepted decision must change, before continuing.

## Original execution order (historical)

1. ADR baseline and verification model.
2. Migration A — identities and versioning.
3. Tests for tenancy, immutability and temporal invariants.
4. Migration B — sessions, expectations and collection streams.
5. Raw measurement primitives.
6. ABA-specific primitives.
7. Bulk/idempotent ingestion.
8. Projection queue and family-specific read models.
9. Semantic API.
10. Renderer registry.
11. Dark deploy and shadow comparison before any V3 writer cutover.
