# ADR-0004 — Projections and Family Read Models

**Status:** Proposed  
**Date:** 2026-08-20  
**Decision owners:** Clinical Measurement Architecture  
**Scope:** Clinical Measurement Engine V3  
**Related ADRs:** ADR-0001, ADR-0002, ADR-0003, ADR-0005, ADR-0008  
**Supersedes:** —  
**Superseded by:** —  
**Implementation status:** Not started  

## Context

The product needs fast dashboards without turning summaries into a second source of truth or exploding database reads. A single sparse mega-table also weakens family-specific constraints and indexing.

## Decision

Raw evidence remains canonical. Projection workers produce family-specific session-level and analytical read models. These models are rebuildable and may be cached/materialized for frequently used access paths.

### Primary session read models

The primary evolution view should preserve a stable analytical grain, typically one semantic point per session/target/phase-epoch/definition-version for compatible families.

### Family-specific physical projections

Examples include:

- session proportion summaries
- session rate summaries
- session count summaries
- session duration summaries
- session latency summaries
- session interval summaries
- session ordinal summaries
- session task-analysis summaries
- prompt distribution breakdowns

Exact physical names are deferred to DDL, but family semantics must remain explicit.

### Multidimensional analysis

Context, provider, time-of-day and opportunity type are analytical dimensions. Tier-3 drilldowns may use lower-level fact slices or specialized secondary projections. The main session evolution read model must not be forced into a row explosion merely to preload every investigative dimension.

### Aggregation authority

Mathematical incompatibility is a hard block. Epistemological mixing such as combining contexts may be allowed only as exploratory analysis with warnings and without authority to update canonical FSM/decision support.

### Projection revision

Projection recomputation does not create history when the semantic result is unchanged. A semantic revision event is created when accepted late data, invalidation or correction materially changes the derived point/result.

## Rejected Alternatives

### Summary as source of truth

Rejected because it prevents deterministic reconstruction and safe semantic corrections.

### Monthly summary as minimum clinical grain

Rejected because intervention changes and phase boundaries can be lost inside coarse calendar buckets.

### One universal sparse fact table as the only read model

Rejected because constraints, indexing and semantics vary materially by measurement family.

## Consequences

### Positive

- Fast read paths while preserving raw truth.
- Lower N+1 risk.
- Targeted projection rebuilds.
- Easier family-specific indexing.

### Negative / Cost

- More projection code and migration objects.
- Requires robust queueing and idempotent worker behavior.

## Security Considerations

Projection reads remain tenant-scoped. Projection data must never broaden access beyond the authorization of the underlying patient/session data.

## Verification

- Delete and rebuild a read model and compare semantic equivalence.
- Late data changes only affected scopes and produces a revision marker when values change.
- Tier-1/Tier-2 screens do not preload Tier-3 provider/context breakdowns.
- Exploratory aggregation cannot feed canonical mastery or FSM transitions.
