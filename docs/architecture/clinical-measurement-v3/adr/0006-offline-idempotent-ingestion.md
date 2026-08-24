# ADR-0006 — Offline and Idempotent Bulk Ingestion

**Status:** Accepted  
**Date:** 2026-08-20  
**Decision owners:** Clinical Measurement Architecture  
**Scope:** Clinical Measurement Engine V3  
**Related ADRs:** ADR-0001, ADR-0002, ADR-0003, ADR-0007  
**Supersedes:** —  
**Superseded by:** —  
**Implementation status:** Implemented — production baseline (2026-08-23)  

## Context

Clinical collection must tolerate unstable connectivity, retries, device restarts and complex multi-step trials without duplicating evidence or trusting client-resolved semantics.

## Decision

V3 ingestion uses idempotent client identities, server-side authorization and atomic family routing.

### Idempotency

At minimum:

- each accepted client event/envelope has a stable `client_event_id` within an authorized tenant/device scope;
- complex trial steps have stable `client_step_id` values;
- duplicate retries must return/reuse the original accepted result rather than insert new evidence.

### Server-authoritative routing

The bulk ingress path performs:

1. authentication;
2. tenant and membership resolution;
3. envelope validation and strict size limits;
4. idempotency/deduplication;
5. session/target/definition/protocol snapshot validation;
6. family routing;
7. atomic persistence;
8. projection enqueue.

The central ingress layer must not become a giant family-specific conditional monolith. Family handlers enforce their own semantic structure.

### Offline semantics

Clients may cache an immutable protocol snapshot for UX/offline collection, but canonical eligibility and validity are revalidated server-side on sync.

### Ingestion provenance

Every accepted event records ingestion mode (`LIVE`, `OFFLINE_SYNC`, `RETROSPECTIVE_ENTRY`, `CORRECTION`) and server-controlled receive/record times.

## Rejected Alternatives

### Client-generated canonical semantic fields

Rejected because clients are untrusted and may be stale or buggy.

### Retry-by-insert

Rejected because network retries would duplicate clinical evidence.

### Per-row RPC loops

Rejected because they amplify latency, race windows and database round-trips.

## Consequences

### Positive

- Safe offline collection.
- Lower N+1 and retry duplication risk.
- Atomic complex-trial ingestion.

### Negative / Cost

- Requires durable idempotency design.
- Requires payload versioning and strict schema validation.

## Security Considerations

- Enforce strict payload and field size limits.
- Resolve all foreign identifiers against authorized tenant scope.
- Reject foreign or deprecated-incompatible protocol references according to server rules.
- Never embed secrets in client code.

## Verification

- Send the same bulk payload repeatedly; raw row counts remain unchanged after the first accepted write.
- Reorder offline events; event-time semantics remain correct.
- Forge eligibility or clinical date; server canonical values remain authoritative.
- Mix foreign-tenant IDs into a valid payload; entire critical operation fails atomically without leakage.
