# Verto Clinical Measurement Engine V3 — Architecture Baseline 1.0

**Status:** Proposed baseline  
**Date:** 2026-08-20  
**Scope:** Clinical Measurement Engine V3  
**Implementation status:** Not started  

## Purpose

This directory records the architecture decisions, semantic contract, threat model and verification matrix that govern the Verto Clinical Measurement Engine V3.

The V3 engine is additive. It must coexist with V2 until an explicitly controlled rollout authorizes a cutover. No document in this baseline authorizes destructive migration, silent reinterpretation of historical data, or activation of a V3 writer in production.

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

## Planned execution order

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
