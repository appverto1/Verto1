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
| TEST-SEC-001 | TM-026 | Authenticated role attempts to execute CMV3 `SECURITY DEFINER` helper | EXECUTE denied; only explicit service entrypoints remain callable |
| TEST-AUTH-004 | TM-027 | Patient alias resolves to canonical ID different from route parameter | Query uses resolved canonical patient ID and clinic scope; no raw-alias lookup |
| TEST-SHADOW-001 | TM-028 | Compare mapped ABA target across Universal V3, canonical ABA V3 and Legacy V2 | Canonical V3 parity is release signal; V2 is labelled observational-only |

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

## Executable evidence map — production baseline 2026-08-23

The reserved IDs above remain the architecture-level vocabulary. The current repository has executable regression suites that cover the implemented baseline as follows:

| ADR / Area | Executable evidence in repository |
|---|---|
| ADR-0001 Foundations / tenancy / immutability | `clinicalMeasurementV3IdentitiesVersioning.test.mjs`, `clinicalMeasurementV3RawPrimitives.test.mjs`, `clinicalMeasurementV3SecurityShadow.test.mjs` |
| ADR-0002 Bitemporal time / corrections | `clinicalMeasurementV3IdentitiesVersioning.test.mjs`, `clinicalMeasurementV3RawPrimitives.test.mjs`, `abaV3SessionHistoryRevision.test.mjs` |
| ADR-0003 Semantic families | `clinicalMeasurementV3RawPrimitives.test.mjs`, `clinicalMeasurementV3AbaEngine.test.mjs`, `clinicalMeasurementV3PlanWriterUiConvergence.regression.test.mjs` |
| ADR-0004 Projections / read models / N+1 boundary | `clinicalMeasurementV3ProjectionReadModels.test.mjs`, `clinicalMeasurementV3PlanReadModelBulk.test.mjs`, `clinicalMeasurementV3DashboardConvergedReader.test.mjs`, `abaV3AnalyticalMetricExpansion.regression.test.mjs`, `abaV3SimplifiedAnalyticsUx.regression.test.mjs` |
| ADR-0005 Decisions / evidence / workflow | `clinicalMeasurementV3SemanticApiDecisions.test.mjs`, `abaMeasurementV3ProbesSessionFsm.test.mjs` |
| ADR-0006 Offline / idempotent ingestion | `clinicalMeasurementV3BulkIngestion.test.mjs`, `abaMeasurementV3PersistenceSync.test.mjs` |
| ADR-0007 Reliability / IOA | `abaMeasurementV3TaskIntervalIoa.test.mjs`; paired PRIMARY/RELIABILITY stream invariants are also covered by session/expectation schema tests. Broader multidisciplinary Reliability Profile remains an extension. |
| ADR-0008 Semantic API / presentation | `clinicalMeasurementV3Presentation.test.mjs`, `clinicalMeasurementV3DashboardConvergedReader.test.mjs`, `clinicalMeasurementV3ClinicalOutcomesConvergence.regression.test.mjs` |
| ABA Default-On production control | `abaV3OperationalRolloutControl.test.mjs`, `abaV3DefaultOnFinalizationArtifacts.test.mjs`, `abaV3FreshSessionBindingPrime.regression.test.mjs` |
| Production observability | `abaV3ProductionHealthObservability.test.mjs` |

The V3-focused test sweep is the release regression source. A documentation status must not be advanced by copy alone: the corresponding executable suites must remain green.
