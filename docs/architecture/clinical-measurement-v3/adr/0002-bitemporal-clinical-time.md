# ADR-0002 — Bitemporal Clinical Time

**Status:** Proposed  
**Date:** 2026-08-20  
**Decision owners:** Clinical Measurement Architecture  
**Scope:** Clinical Measurement Engine V3  
**Related ADRs:** ADR-0001, ADR-0004, ADR-0005, ADR-0006, ADR-0008  
**Supersedes:** —  
**Superseded by:** —  
**Implementation status:** Not started  

## Context

Clinical events may occur offline, cross midnight, be entered retrospectively, be corrected after review or be associated with a phase that was documented later than its clinical effective date. A single timestamp cannot represent both clinical occurrence and system knowledge.

## Decision

V3 separates valid-time semantics from system-time semantics.

### Required temporal concepts

- `occurred_at_utc`: physical/clinical event time normalized to UTC.
- `recorded_at`: server knowledge time for the accepted event.
- `clinical_date`: intentional date assigned by the session context for clinical grouping.
- `timezone_snapshot`: IANA timezone and effective offset captured for the session/collection context.
- `received_at`: server ingestion time when distinct from recorded acceptance.
- `invalidated_at` / correction timestamps: system-time events that alter current evidence support without erasing the original event.

### Clinical date policy

`clinical_date` is established by the server-authoritative session/collection context. It must not be accepted as an unrestricted arbitrary client value.

A session that begins before midnight and ends after midnight may retain one clinical date while individual events keep their actual `occurred_at_utc` values and local occurrence dates.

### Ingestion modes

Accepted ingestion must distinguish at least:

- `LIVE`
- `OFFLINE_SYNC`
- `RETROSPECTIVE_ENTRY`
- `CORRECTION`

Offline arrival and retrospective memory-based entry are not semantically equivalent.

### Phase corrections

A retroactive phase correction must not destructively rewrite a prior phase row. It is a privileged append-only correction with effective time, recorded time, actor, reason and impacted interval.

The system must preserve both:

- what protocol/configuration was actually bound to the collection snapshot at collection time; and
- the current corrected clinical interpretation of the phase timeline.

### As-of reconstruction

The architecture should permit an `as_of` system-time lens for audit/reconstruction. The default user view may use current corrected truth, but prior-known state must not be irretrievably lost.

## Rejected Alternatives

### UTC timestamp only

Rejected because UTC alone does not preserve intentional clinical date or local session meaning.

### Browser-local date grouping

Rejected because the viewer's timezone may differ from the clinical timezone.

### Absolute prohibition of retroactive phase correction

Rejected because late documentation may be clinically legitimate. Silent rewriting is prohibited; explicit bitemporal correction is allowed.

## Consequences

### Positive

- Correct day/session grouping across timezones.
- Accurate distinction between late sync and retrospective entry.
- Audit reconstruction of what was known when.

### Negative / Cost

- More timestamps and temporal joins.
- Correction workflows require privileged operations and projection invalidation.

### Operational

Temporal correction must enqueue targeted projection rebuilds only for impacted scopes.

## Security Considerations

- Clients cannot forge `recorded_at`.
- Retroactive corrections require explicit authorization and reason codes.
- Cross-tenant temporal references must be rejected.

## Verification

- A Manaus event at 23:30 local remains on the intended clinical date regardless of viewer timezone.
- A cross-midnight session retains its declared clinical date while preserving actual event timestamps.
- `OFFLINE_SYNC` and `RETROSPECTIVE_ENTRY` produce distinguishable provenance.
- Retroactive phase correction creates a new historical record and never rewrites prior system-time knowledge.
