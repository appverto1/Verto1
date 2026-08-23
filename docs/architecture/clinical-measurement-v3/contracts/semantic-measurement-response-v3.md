# SemanticMeasurementResponse V3 — Contract Baseline

**Status:** Accepted — production baseline 2026-08-23  
**Contract family:** `3.x`  
**Architecture:** ADR-0008  

## Purpose

This document defines the semantic response shape exchanged between the Clinical Measurement Engine and presentation clients. It is intentionally renderer-agnostic.

## Top-level shape

```ts
type SemanticMeasurementResponse = {
  contract_version: string;
  identity: MeasurementIdentity;
  scope: MeasurementScope;
  authority: AnalysisAuthority;
  semantics: MeasurementSemantics;
  temporal_context: TemporalContext;
  phase_epochs: PhaseEpoch[];
  criterion_epochs: CriterionEpoch[];
  clinical_decision_rules: ClinicalDecisionRule[];
  data: MeasurementData;
  rendering: RenderingContract;
  warnings: Warning[];
  audit_events: AuditEvent[];
  provenance: Provenance;
};
```

## Authority

```ts
type AnalysisAuthority =
  | { level: "CANONICAL" }
  | { level: "EXPLORATORY"; reasons: string[] };
```

Exploratory responses must never be used to transition canonical clinical state.

## Scope and filters

Filters are effective server-authorized filters, not an echo of untrusted request IDs.

```ts
type FilterSelection =
  | { mode: "ALL_AUTHORIZED" }
  | { mode: "INCLUDE"; ids: string[] };
```

## Measurement point union

```ts
type MeasurementPoint =
  | ObservedPoint
  | NoEligibleOpportunityPoint
  | NoValidObservationWindowPoint
  | ExpectedNotCollectedPoint
  | InterruptedPoint;
```

### Observed point

```ts
type ObservedPoint = {
  type: "OBSERVED";
  id: string;
  session_id: string;
  occurred_at: string;
  clinical_date: string;
  phase_epoch_id: string;
  measurement: Measurement;
  quality: QualityIssue[];
  reliability: ReliabilityState;
  dimensions?: AuthorizedDimensions;
  ingestion: IngestionProvenance;
  revision?: PointRevision;
};
```

## Measurement discriminated union

```ts
type Measurement =
  | ProportionMeasurement
  | RateMeasurement
  | DurationMeasurement
  | LatencyMeasurement
  | OrdinalMeasurement
  | ContinuousMeasurement
  | TaskAnalysisMeasurement;
```

### Proportion

```ts
type ProportionMeasurement = {
  kind: "PROPORTION";
  numerator: number;
  denominator: number;
  proportion: number; // server-derived; scale declared by definition/renderer semantics
};
```

### Rate

```ts
type RateMeasurement = {
  kind: "RATE";
  event_count: number;
  observation_duration: {
    value: number;
    unit: "SECOND" | "MINUTE" | "HOUR";
  };
  normalized_rate: {
    value: number;
    unit: "EVENTS_PER_MINUTE" | "EVENTS_PER_HOUR";
  };
};
```

### Ordinal

```ts
type OrdinalMeasurement = {
  kind: "ORDINAL";
  level_key: string;
  order_index: number;
  display_label: string;
};
```

`order_index` indicates ordering only. It does not authorize arithmetic distance assumptions.

### Task analysis

```ts
type TaskAnalysisMeasurement = {
  kind: "TASK_ANALYSIS";
  chaining_strategy: "FORWARD" | "BACKWARD" | "TOTAL_TASK" | "OTHER";
  protocol_snapshot_id: string;
  steps: TaskAnalysisStep[];
  derived: {
    eligible_steps: number;
    independent_eligible_steps: number;
  };
};
```

Eligibility is server-resolved from the immutable protocol snapshot.

## Representation model

Not every family has a scalar time series.

```ts
type MeasurementData = {
  primary_representation: Representation;
  supplementary_representations: Representation[];
};
```

Representative `kind` values:

- `TIME_SERIES`
- `ORDERED_CATEGORY_SERIES`
- `TASK_ANALYSIS_MATRIX`
- `PROMPT_COMPOSITION`
- `DATA_TABLE`

### Segmented time series

```ts
type TimeSeriesRepresentation = {
  kind: "TIME_SERIES";
  semantic_role: string;
  continuity_policy: "BREAK_ON_PHASE_EPOCH" | "SERVER_SEGMENTED";
  segments: {
    segment_id: string;
    phase_epoch_id: string;
    points: MeasurementPoint[];
  }[];
};
```

The frontend must not join points across segments.

## Directionality

```ts
type Directionality =
  | { type: "INCREASE_IS_BETTER" }
  | { type: "DECREASE_IS_BETTER" }
  | { type: "TARGET_RANGE_IS_BETTER"; min: number; max: number }
  | { type: "NO_DIRECTIONAL_JUDGMENT" };
```

Numeric axes remain mathematically natural by default. Directionality is interpretation, not implicit axis reversal.

## Criteria and overlays

A clinical decision rule and a renderer overlay are different objects. A threshold line may visualize one component of a compound rule.

Example compound criterion:

```json
{
  "metric": "INDEPENDENCE_PROPORTION",
  "operator": "GREATER_THAN_OR_EQUAL",
  "threshold": 80,
  "minimum_denominator_per_point": 5,
  "window": {
    "unit": "SESSION",
    "size": 3,
    "consecutive": true
  }
}
```

The backend returns the evaluation state. The frontend does not recompute mastery.

## Temporal provenance

Each point can preserve:

- `occurred_at`
- `clinical_date`
- `received_at`
- ingestion mode
- revision number and reason when semantically changed

The response also exposes projection/source watermarks and freshness.

## Audit events

Examples:

- `OBSERVATION_INVALIDATED`
- `LATE_DATA_INCORPORATED`
- `RETROSPECTIVE_PHASE_CORRECTION`
- `CLINICAL_DECISION_EVIDENCE_CHANGED`

Audit events annotate history. They do not silently mutate historical user decisions.

## Rendering contract

The backend declares semantic capabilities, for example:

```json
{
  "recommended_view": "SINGLE_METRIC_EVOLUTION",
  "capabilities": [
    {"renderer": "TIME_SERIES", "availability": "READY"},
    {"renderer": "SCATTER", "availability": "REQUIRES_ANALYTICAL_DRILLDOWN"}
  ]
}
```

Presentation clients may choose responsive tick density, tooltip design, zoom and layout. They may not change analytical grain or perform canonical aggregation.
