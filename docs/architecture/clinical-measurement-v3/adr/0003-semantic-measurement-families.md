# ADR-0003 — Semantic Measurement Families

**Status:** Accepted  
**Date:** 2026-08-20  
**Decision owners:** Clinical Measurement Architecture  
**Scope:** Clinical Measurement Engine V3  
**Related ADRs:** ADR-0001, ADR-0004, ADR-0007, ADR-0008  
**Supersedes:** —  
**Superseded by:** —  
**Implementation status:** Implemented — production baseline (2026-08-23)  

## Context

Clinical measurements differ fundamentally in their mathematics. Treating every target as a percentage or scalar score corrupts meaning and creates unsafe aggregation.

## Decision

V3 defines a closed set of semantic measurement primitives with explicit extensibility rather than arbitrary formulas.

Initial families include:

- `COUNT`
- `RATE`
- `PROPORTION`
- `DURATION`
- `LATENCY`
- `IRT`
- `INTERVAL`
- `ORDINAL`
- `CONTINUOUS`
- `TASK_ANALYSIS`
- `CATEGORICAL`

Optional domain capabilities include prompt distribution, trial steps, observation slices and IOA/reliability.

### Family-specific structure

A valid observed measurement uses a discriminated union. Fields that do not apply to a family do not exist rather than being set to fake defaults.

Examples:

- `RATE`: event count + valid observation duration + server-derived normalized rate.
- `PROPORTION`: numerator + denominator.
- `ORDINAL`: level key + order index + label; no denominator.
- `TASK_ANALYSIS`: structured steps, server-derived eligibility and optional derived eligible-step summary.

### Ordinal integrity

Ordinal order does not imply equal interval distance. The engine must not automatically compute arithmetic means or percentage conversion merely because ordinal levels have numeric order indexes.

### Prompt fading

Prompt levels are categorical. Canonical prompt visualizations use distributions/composition rather than a synthetic weighted average prompt score.

### Directionality

Interpretation is explicit and separate from numeric order:

- `INCREASE_IS_BETTER`
- `DECREASE_IS_BETTER`
- `TARGET_RANGE_IS_BETTER`
- `NO_DIRECTIONAL_JUDGMENT`

Directionality must not silently reverse the mathematical axis. Natural numeric orientation is the default.

### Absence semantics

Non-observation states must be compatible with the measurement family. Opportunity-based measures may expose `NO_ELIGIBLE_OPPORTUNITY`; time-window measures may expose `NO_VALID_OBSERVATION_WINDOW`. Zero remains distinct from absence.

## Rejected Alternatives

### `denominator = 1` for ordinal values

Rejected because it fabricates ratio semantics.

### Universal nullable measurement object

Rejected because optional fields create invalid states and weaken compile-time exhaustiveness.

### Arbitrary user formulas

Rejected because unconstrained formulas turn the engine into an ungoverned spreadsheet and undermine canonical semantics.

## Consequences

### Positive

- Strong type safety from storage through API and frontend.
- Correct renderer selection by semantic family.
- Safer extension to other specialties.

### Negative / Cost

- More family-specific schemas, handlers and tests.
- Cross-family analytics require explicit semantic compatibility checks.

## Security Considerations

The client may submit family-appropriate mechanical observations but cannot override the server-resolved semantic definition version or derived eligibility.

## Verification

- Ordinal responses cannot be persisted as percentages by the canonical engine.
- A rate point with zero events over valid observed time is represented as zero rate, not missing data.
- Task-analysis eligibility is resolved server-side against an immutable protocol snapshot.
- Prompt fading read models preserve categorical counts.
