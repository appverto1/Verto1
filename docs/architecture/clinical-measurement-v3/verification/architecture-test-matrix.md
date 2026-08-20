# Clinical Measurement Engine V3 — Architecture Verification Matrix

**Status:** Living document  
**Baseline date:** 2026-08-20  

## Purpose

Trace architecture invariants and threat-model entries to executable tests. Test IDs below are reserved targets; implementation paths may be added when code exists.

| Test ID | Invariant / Threat | Scenario | Expected result |
|---|---|---|---|
| TEST-RAW-001 | INV-001 / TM-023 | Attempt destructive update/delete of accepted raw observation | Operation unavailable or rejected; raw evidence unchanged |
| TEST-PROJ-001 | INV-002 / TM-012 | Delete projection rows then rebuild | Semantic output equals pre-delete output |
| TEST-SEM-001 | INV-003 / TM-008 | Client forges TA eligibility | Persisted canonical eligibility matches server snapshot, not payload |
| TEST-SEM-002 | INV-004 | Persist ordinal observation | No denominator/percentage is fabricated |
| TEST-TIME-001 | INV-005 / TM-006 | Manaus 23:30 event synced next day | Clinical date remains intended local session date |
| TEST-TIME-002 | INV-005 | Session crosses midnight | Same clinical date; actual event timestamps preserved |
| TEST-TIME-003 | INV-006 / TM-010 | Retroactive phase correction | New correction/version appended; prior recorded state preserved |
| TEST-AUTH-001 | TM-001 | User from clinic A requests patient B | Reject without data leakage |
| TEST-AUTH-002 | TM-002 | Valid patient with foreign definition version | Atomic reject; no raw event/projection queue |
| TEST-AUTH-003 | TM-003 | Target paired with phase from another target | Reject via domain/FK invariant |
| TEST-IDEMP-001 | TM-004 | Same bulk payload repeated 10 times | Exactly one canonical raw event set |
| TEST-IDEMP-002 | TM-005 | Duplicate client event IDs in same batch | Deterministic reject/handling; no duplicate writes |
| TEST-RANGE-001 | INV-009 / TM-009 | Overlapping primary slices | Database rejects overlap atomically |
| TEST-RANGE-002 | TM-024 | Two device slices overlap same stream | Denominator never exceeds union-valid observation duration |
| TEST-EXP-001 | INV-008 / TM-013 | Exploratory mixed-context result sent to canonical transition | Canonical transition rejects exploratory evidence |
| TEST-DEC-001 | INV-010 | Evidence invalidated after mastery confirmation | Original decision event unchanged; evidence support changes; review workflow may open |
| TEST-DEC-002 | INV-010 | Clinician later revokes mastery | New decision event created; original remains |
| TEST-LATE-001 | TM-015 | Late offline slice changes rate from 4/h to 6/h | Projection revises point and emits audit/revision metadata |
| TEST-LATE-002 | ADR-0004 | Late payload produces no semantic change | No redundant semantic revision emitted |
| TEST-IOA-001 | TM-016 | Two trials close in time without shared anchor | Exact trial-by-trial IOA not computed |
| TEST-IOA-002 | TM-017 | Reliability observer misses shared opportunity 18 | 19+ remain aligned; 18 marked missed |
| TEST-API-001 | TM-025 | Three sessions same day | API returns three SESSION-grain points; frontend does not average |
| TEST-API-002 | ADR-0008 | Phase change between points | API returns separate continuity segments |
| TEST-API-003 | ADR-0008 | Compound mastery criterion | Backend returns evaluation; overlay threshold alone does not imply mastery |
| TEST-PERF-001 | TM-020 | Load Tier-1/Tier-2 patient dashboard | No per-target/provider N+1 query pattern |
| TEST-PERF-002 | ADR-0004 | Open Tier-1 view without drilldown | Tier-3 dimensional payload is not loaded |
| TEST-SCHEMA-001 | TM-021 | Unsupported contract/schema capability | Single deterministic compatibility path; no repeated fallbacks |
| TEST-SNAP-001 | TM-022 | Offline event references stale snapshot | Server follows defined compatibility policy; client cannot self-upgrade semantics |

## Completion rule

An ADR may be considered implemented only when its `Verification` section maps to one or more executable tests and those tests pass in the intended environment.

## Future test folders

```text
tests/integration/measurement-v3/
├── tenancy/
├── ingestion/
├── temporal/
├── range-integrity/
├── decisions/
├── reliability/
├── projections/
└── semantic-api/
```
