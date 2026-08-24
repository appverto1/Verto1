# ADR-0008 — Semantic API Contract

**Status:** Accepted  
**Date:** 2026-08-20  
**Decision owners:** Clinical Measurement Architecture  
**Scope:** Clinical Measurement Engine V3  
**Related ADRs:** ADR-0001 through ADR-0007  
**Supersedes:** —  
**Superseded by:** —  
**Implementation status:** Implemented — production baseline (2026-08-23)  

## Context

The presentation layer needs a unified response shape without reimplementing clinical mathematics or being coupled directly to database-specific projection schemas. The API must also preserve family semantics, phase continuity, criteria, quality, provenance and analytical authority.

## Decision

The API returns a versioned `SemanticMeasurementResponse`. It communicates meaning and rendering capabilities, not library-specific drawing instructions.

### Core responsibilities

The API defines:

- identity and semantic family;
- authorized scope and effective filters;
- canonical vs exploratory authority;
- analysis grain;
- phase and criterion epochs;
- server-evaluated clinical decision rules;
- family-specific discriminated measurement payloads;
- continuity segments;
- quality and reliability metadata;
- audit/revision events;
- provenance and freshness;
- permitted/recommended presentation capabilities.

### Continuity

The backend defines segment continuity. A renderer must never infer that points across different segments can be connected. Phase epochs and segments are related but distinct concepts.

### Grain vs visual ticks

Analytical point grain is server-defined. Visual tick density is a presentation concern. The frontend may change labels/tick density but must not average or regroup canonical clinical points.

### Clinical criteria

Mastery or other clinical decision rules are versioned semantic rules. A reference line may visualize one threshold component but does not itself mean the rule was satisfied.

### Measurement unions

`OBSERVED` points carry a family-specific `measurement.kind`. Invalid fields do not appear as null placeholders.

### Canonical vs exploratory

Exploratory results must explicitly report exploratory authority and reasons. They cannot be consumed as canonical state transitions.

### Lazy analytical capabilities

A renderer capability may be `READY` or `REQUIRES_ANALYTICAL_DRILLDOWN`, allowing Tier-3 provider/context analysis to be fetched only when requested.

## Rejected Alternatives

### Recharts-specific contract

Rejected because domain semantics must survive renderer/library replacement.

### Parallel arrays

Rejected because index drift creates silent data corruption in the presentation layer.

### Client-side daily aggregation

Rejected because correct aggregation may require denominator weighting, phase boundaries and family-specific rules.

### One scalar `value` for every family

Rejected because task analysis and ordinal measurements require richer structures.

## Consequences

### Positive

- Frontend remains clinically non-authoritative.
- Strong TypeScript exhaustiveness.
- Renderer independence.
- Lazy Tier-3 analysis reduces unnecessary reads.

### Negative / Cost

- Contract versioning is required.
- Adapters are needed for each renderer and semantic family.

## Security Considerations

- IDs in filters never confer authorization.
- Tenant/patient/provider scopes are recomputed server-side.
- Restricted dimensions are omitted rather than leaked.
- Exploratory authority cannot be client-forged.

## Verification

- A frontend adapter can render rate, ordinal, task analysis and proportion without computing canonical metrics.
- Points from different continuity segments are never connected.
- Three sessions on one day remain three analytical points unless the server explicitly returns a daily grain.
- Unsupported/unauthorized provider IDs cannot expand the returned scope.
- Exploratory results cannot update canonical FSM state.
