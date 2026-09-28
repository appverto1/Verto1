# Authorized Target Semantics — Factory v1

This document clarifies the exceptional-target representation used by the canonical `scripts/factory-recovery-controls.mjs` consistency verifier. It does not create a second verifier and does not relax the normal staging-only path.

## Normal path

`reference_branch` remains `staging`. Normal operations continue to require the canonical staging base/freshness equality already enforced by the verifier. No caller-controlled bypass flag is valid.

## Explicit exceptional target

A non-staging operational target is valid only when all of the following are present and mutually consistent:

- `reference_branch: staging`;
- `staging_freshness_sha` equal to the factual current staging ref;
- explicit `target_branch` and `target_base_sha`;
- canonical Issue `base_sha` equal to `target_base_sha`, so the exceptional operation has one factual authoritative base;
- factual target ref identity/sha in the collected `refs` snapshot;
- trusted ancestry proof `target_base_sha -> candidate head` in the collected `refs.target_ancestry` snapshot;
- structured `FACTORY_AUTHORIZED_TARGET_V1` authorization with allowlisted factual authority, non-empty `evidence_ref`, matching target branch and non-empty explicit allowed scope;
- non-empty explicit `operation_scope`, which must be a subset of the authorized scope;
- candidate branch/head exact-SHA consistency.

The only currently allowlisted exceptional-target authority is `FOUNDER_EXPLICIT`. Free-form Issue/comment text, `skip_staging_check`, generic or bypass-like flags, arbitrary targets, or caller assertions are not authority.

Missing authorization/required fields fail closed. Stale staging freshness, canonical/target-base mismatch, target-ref drift, target-base drift, invalid ancestry, or scope expansion remain failures. An exceptional target such as the founder-authorized #266 bootstrap to `main` therefore keeps `staging` as the Factory reference/freshness branch while binding canonical `base_sha` to the factual `main` target base.
