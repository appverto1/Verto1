# ADR-0007 — Reliability and Interobserver Agreement

**Status:** Accepted  
**Date:** 2026-08-20  
**Decision owners:** Clinical Measurement Architecture  
**Scope:** Clinical Measurement Engine V3  
**Related ADRs:** ADR-0001, ADR-0003, ADR-0006, ADR-0008  
**Supersedes:** —  
**Superseded by:** —  
**Implementation status:** Partially implemented — canonical ABA reliability/IOA and paired reliability streams are live; broader multidisciplinary Reliability Profile remains an extension  

## Context

IOA/reliability cannot be represented by one universal formula. Different measurement families and collection methods require different pairing strategies and calculation methods. Timestamp proximity is insufficient for exact trial matching.

## Decision

Reliability is modeled through a versioned `Reliability Profile` and explicit paired observation identity.

### Reliability profile

A profile declares whether reliability is enabled and the permitted method, such as:

- exact/trial-by-trial agreement;
- exact count per interval;
- proportional interval agreement;
- scored/unscored interval;
- total count agreement;
- total or mean duration agreement;
- ordinal exact match;
- ordinal tolerance, where explicitly configured.

If no compatible reliability profile exists, canonical IOA is not computed.

### Pairing model

A reliability pairing establishes:

- `pair_id`;
- primary stream;
- reliability stream;
- definition version;
- anchor strategy.

Anchor strategies may include:

- `SHARED_OPPORTUNITY`
- `INTERVAL_INDEX`
- `SESSION_TOTAL`
- other explicitly defined methods.

Exact trial-by-trial matching uses a shared opportunity identity, not timestamp approximation.

### Missed observations

A reliability observer may explicitly record a missed observation against a known shared anchor so later events do not shift alignment.

### Transport is not semantics

QR code, Bluetooth, NFC or other mechanisms may establish the pairing UX but do not define the data model. Integrity rests on server-recognized pair and anchor identities.

## Rejected Alternatives

### Timestamp-nearest-neighbor trial matching

Rejected because clock skew and missed trials can cascade into false pairings.

### Universal IOA formula

Rejected because valid methods differ by measurement family and observational design.

### Numeric proportional agreement for arbitrary ordinal scales

Rejected unless the specific reliability profile explicitly defines a meaningful rule.

## Consequences

### Positive

- Exact pairing where methodology requires it.
- Family-appropriate reliability calculations.
- Safe offline paired-observer workflows.

### Negative / Cost

- Additional pairing/session UX.
- More specialized calculation handlers.

## Security Considerations

Pair/session IDs cannot confer access across tenants or patients. Both streams must be authorized within the same intended clinical scope.

## Verification

- A missing reliability trial does not shift all subsequent shared-opportunity matches.
- Timestamp differences alone never establish exact trial-by-trial identity.
- An ordinal measure without a configured reliability method yields no fabricated IOA score.
- Foreign stream/pair identifiers are rejected.
