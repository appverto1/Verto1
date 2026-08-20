# Clinical Measurement Engine V3 — Threat Model

**Status:** Living document  
**Baseline date:** 2026-08-20  

## Purpose

This document lists concrete ways the V3 engine may be attacked, corrupted or made to produce clinically misleading results. It is intentionally separate from Accepted ADRs so new threats can be added without rewriting historical architecture decisions.

## Threat catalog

| ID | Threat | Primary control | Expected failure mode |
|---|---|---|---|
| TM-001 | Cross-tenant patient IDOR | Server-side tenant/patient resolution + RLS | Reject without existence leakage |
| TM-002 | Foreign `definition_version_id` | Composite tenancy validation | Atomic reject |
| TM-003 | Target/phase mismatch | Composite foreign-key/domain validation | Reject |
| TM-004 | Replay of accepted payload | Idempotency key | Return/reuse prior result; no duplicate raw rows |
| TM-005 | Duplicate `client_event_id` in batch | Unique scope + atomic validation | Reject/normalize deterministically |
| TM-006 | Forged `clinical_date` | Server-derived session clinical date | Ignore/reject untrusted value |
| TM-007 | Forged `ingestion_mode` | Server validation/provenance rules | Reject impossible mode or canonicalize |
| TM-008 | Forged task-analysis eligibility | Server protocol snapshot resolution | Client value cannot affect canonical eligibility |
| TM-009 | Overlapping primary observation slices | Range/exclusion constraint by stream | Database rejects conflict atomically |
| TM-010 | Backdated phase edit by normal update | Append-only privileged correction path | Direct mutation denied |
| TM-011 | VOID against foreign patient event | Tenant/patient ownership validation | Reject without mutation |
| TM-012 | Projection poisoning/replay | Raw-source reconstruction + worker idempotency | Rebuild restores canonical derived state |
| TM-013 | Exploratory response used as canonical state | Authority separation | Canonical transition endpoint rejects exploratory evidence |
| TM-014 | Client-supplied mastery result | Server-only decision rule evaluation | Ignore/reject |
| TM-015 | Late sync silently changes history | Revision/audit event | Point marked revised; affected projection rebuilt |
| TM-016 | IOA matched by timestamp approximation | Shared anchors only | No exact IOA computed without valid anchor |
| TM-017 | Missing IOA trial shifts alignment | Explicit shared anchor + missed observation state | Later anchors remain aligned |
| TM-018 | Provider/context filter expands access | Effective filters computed server-side | Unauthorized dimensions omitted/rejected |
| TM-019 | Oversized bulk payload DoS | Strict envelope/item limits | Early reject before expensive DB work |
| TM-020 | N+1 analytical drilldown | Batch/family projection query plan | Bounded query count |
| TM-021 | Schema fallback loop causes repeated egress | Versioned contract/schema capability | No repeated blind fallbacks |
| TM-022 | Stale client protocol snapshot | Server validates snapshot version/status | Accept only policy-compatible event or quarantine/reject |
| TM-023 | Client attempts destructive raw update | No destructive raw mutation API | Method unavailable/denied |
| TM-024 | Duplicate duration from overlapping devices | Stream identity + non-overlap | Denominator cannot double-count |
| TM-025 | Browser computes daily average from session points | API grain contract | Canonical UI adapter has no aggregation path |

## Attack principles

1. IDs are identifiers, never authorization grants.
2. Client-calculated semantics are untrusted.
3. Retries are assumed normal, not exceptional.
4. Offline order can differ from event occurrence order.
5. A valid mathematical result can still be clinically misleading if dimensions or epochs are mixed incorrectly.
6. Database constraints should enforce invariants that cannot safely rely on application code alone.

## Review cadence

Update this document whenever a new exploit path, race condition, data quality failure or semantic ambiguity is found. Accepted ADRs are not rewritten solely to add new threats unless the architecture decision itself changes.
