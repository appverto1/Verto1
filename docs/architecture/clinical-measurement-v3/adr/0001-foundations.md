# ADR-0001 — Clinical Measurement Engine V3 Foundations

**Status:** Proposed  
**Date:** 2026-08-20  
**Decision owners:** Clinical Measurement Architecture  
**Scope:** Clinical Measurement Engine V3  
**Related ADRs:** ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008  
**Supersedes:** —  
**Superseded by:** —  
**Implementation status:** Not started  

## Context

The V2 measurement model couples collected facts, clinical interpretation and frontend presentation too tightly. This creates several structural risks: synthetic 0–100 scores for unlike measures, premature reduction of ordinal categories to percentages, client-side clinical calculations, ambiguous denominators, fragile historical reconstruction and a design centered on discrete trials that does not generalize cleanly to rate, duration, latency, interval recording, task analysis or measurements used by other specialties.

V3 must preserve historical truth, support ABA deeply, allow other specialties without forcing ABA semantics onto them, remain tenant-safe and minimize database read/write amplification.

## Decision

The Verto Clinical Measurement Engine V3 adopts an append-only raw evidence model, versioned semantic definitions, bitemporal knowledge, family-specific projections and a server-authoritative semantic API.

### INV-001 — Raw Data Is Append-Only

Raw clinical observations are never hard-deleted or destructively updated. Corrections are represented by compensating events such as `VOID`, `CORRECTION` or `SUPERSEDE`.

### INV-002 — Projections Are Derived

Summaries, read models and dashboard views are not sources of clinical truth. They must be rebuildable from accepted raw evidence and immutable/versioned semantic configuration.

### INV-003 — Clients Do Not Decide Clinical Semantics

Clients report mechanical facts and user actions. Eligibility, denominator membership, semantic validity, mastery computation and canonical aggregation are resolved server-side against an immutable protocol snapshot.

### INV-004 — Mathematical Integrity First

Measurement families preserve their native mathematical structure end-to-end. Ordinal scales remain ordinal. Prompt hierarchies remain categorical. Rates retain event counts and observation duration. Proportions retain numerator and denominator. Task analysis retains step structure and eligibility.

### INV-005 — Bitemporal Knowledge

Clinical occurrence time and system knowledge time are distinct. The architecture must be able to represent when something happened clinically and when the system learned, corrected or invalidated it.

### INV-006 — History Is Annotated, Not Rewritten

Historical corrections append new knowledge and preserve prior recorded states. The system must support both a current corrected view and, where required, reconstruction of what was known at an earlier point in system time.

### INV-007 — Frontend Renders, Backend Concludes

The frontend may choose responsive visual treatment within declared capabilities, but it must not perform canonical clinical aggregation, IOA calculation, mastery evaluation, eligibility resolution or other domain conclusions.

### INV-008 — Authority Isolation

Canonical and exploratory analyses are separate authorities. Exploratory aggregation may help investigation but cannot mutate canonical FSM state, mastery evidence or official clinical decision support.

### INV-009 — Non-Overlapping Time Denominators

Within the same primary observation stream, overlapping active observation slices must not double-count time in rate, duration or other time-normalized denominators.

### INV-010 — Evidence and Human Decision Are Separate

A human clinical decision is an immutable event referencing a specific evidence revision. Current evidence support and workflow attention are separate states and may change without erasing the historical human decision.

## Rejected Alternatives

### Universal 0–100 score

Rejected because it destroys semantic meaning across incompatible measurement families and encourages false comparisons.

### Frontend-derived clinical summaries

Rejected because canonical clinical state must remain server-authoritative and reproducible.

### Mutable raw observations

Rejected because destructive mutation makes historical audit, late correction and reconstruction unreliable.

### One universal sparse measurement table for every family

Rejected as the default projection model because it weakens constraints, indexing clarity and semantic maintainability. Physical read models should be family-specific where aggregation rules differ materially.

## Consequences

### Positive

- Stronger auditability and reproducibility.
- Safer offline and retrospective correction workflows.
- Clean extension to non-ABA specialties.
- Reduced risk of mathematically valid but clinically misleading charts.
- Enables deterministic rebuilds of projections.

### Negative / Cost

- More up-front schema and projection complexity.
- More explicit versioning and event identity.
- More family-specific handlers and tests.

### Operational

The architecture materially improves traceability and audit readiness, but does not by itself guarantee legal, payer, research or methodological compliance.

## Security Considerations

- Tenant identity must be resolved server-side.
- Foreign IDs cannot confer authority.
- Client-provided semantic claims are untrusted.
- All critical writes must be idempotent and atomic.

## Verification

- `INV-001`: no V3 endpoint performs destructive mutation of accepted raw observations.
- `INV-002`: projections can be deleted and rebuilt to semantically equivalent outputs.
- `INV-003`: forged eligibility or semantic fields in client input cannot change persisted canonical semantics.
- `INV-008`: exploratory requests cannot transition canonical FSM state.
- `INV-009`: overlapping time slices in the same primary stream are rejected or otherwise prevented from double-counting.
- `INV-010`: changing evidence support does not delete or mutate the historical clinical decision event.
