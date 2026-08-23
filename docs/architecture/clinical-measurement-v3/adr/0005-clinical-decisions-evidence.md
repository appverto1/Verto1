# ADR-0005 — Clinical Decisions, Evidence Support and Workflow Attention

**Status:** Accepted  
**Date:** 2026-08-20  
**Decision owners:** Clinical Measurement Architecture  
**Scope:** Clinical Measurement Engine V3  
**Related ADRs:** ADR-0001, ADR-0002, ADR-0004, ADR-0008  
**Supersedes:** —  
**Superseded by:** —  
**Implementation status:** Implemented — production baseline (2026-08-23)  

## Context

A mathematical criterion being satisfied is not the same thing as a human clinical decision. Likewise, later evidence correction must not erase the historical fact that a clinician made a decision in good faith using the evidence then available.

## Decision

V3 separates three orthogonal state domains:

1. `clinical_state` — current clinical decision state.
2. `evidence_support_state` — current mathematical support for the relevant clinical decision/rule.
3. `workflow_attention_state` — operational attention required from the clinical team.

### Evidence evaluation

The projection/decision-rule engine evaluates canonical evidence against a versioned clinical decision rule. A mathematical result such as `MASTERY_CRITERIA_MET` is evidence state, not automatically a human decision.

### Human clinical decision

A clinician may create an immutable decision event such as `CLINICIAN_CONFIRMED_MASTERY` referencing the exact `evidence_revision` used at decision time.

Immutable means the event itself is not destructively edited or deleted. Human decisions may later be superseded/revoked by another explicit clinical decision event.

### Evidence changes after decision

If evidence later changes because of a void, correction or late data:

- the historical clinical decision event remains unchanged;
- current evidence support is recalculated;
- if the supporting evidence materially changed, `evidence_support_state` reflects that condition;
- `workflow_attention_state` may become `REVIEW_REQUIRED`;
- the system must not silently reinterpret this workflow state as a new clinical decision.

### Example

At system time T1:

- evidence revision 17 satisfies criterion;
- clinician confirms mastery referencing revision 17.

At system time T2:

- a supporting observation is invalidated;
- evidence revision 18 no longer satisfies the criterion.

The system can truthfully represent both:

- mastery was clinically confirmed at T1 based on revision 17; and
- current supporting evidence has changed and requires review.

## Rejected Alternatives

### Single `status` enum for everything

Rejected because it conflates clinical judgment, evidence support and workflow.

### Automatic rollback from `MASTERED` to acquisition

Rejected because it erases the historical human decision and lets software revoke a clinical judgment silently.

### Irrevocable human decision

Rejected because clinicians may legitimately revise decisions. Revisions must be new explicit events, not destructive edits.

## Consequences

### Positive

- Strong audit trail of reasoning and evidence.
- Clear UX for “decision remains, evidence changed”.
- Prevents software from silently revoking human clinical decisions.

### Negative / Cost

- More state machines and UI states.
- Reports must distinguish historical decisions from present evidence support.

## Security Considerations

Clinical decision events require authorized clinical roles and server-side tenant/patient authorization. A client cannot choose an arbitrary evidence revision outside the authorized target/scope.

## Verification

- Invalidating evidence never deletes or mutates the original clinical decision event.
- New evidence can trigger `REVIEW_REQUIRED` workflow without altering the historical decision record.
- A later clinician revocation creates a new event and preserves the original confirmation.
- Cross-patient evidence revision references are rejected.
