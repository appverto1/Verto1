# Backend modularization — clinic appointment policy payload hash

- Date: 2026-10-11. Base `staging` `e78a05511dfd03b82d32d92d44f4231004d71a64` (`services/clinicAppointmentPolicyRoutes.ts` blob `d967d4108875951dcc87183f3a87ba01b8c3195f`).
- Slice: extract the exact existing stable object-key sort and SHA-256 operation hash used by `set_clinic_appointment_policy_v2` into `services/clinicPolicyPayloadHash.ts` without changing the serialized payload, idempotency key, backend permissions, validation, storage, save authority, or response.
- Files: `services/clinicAppointmentPolicyRoutes.ts`, `services/clinicPolicyPayloadHash.ts`, `tests/clinicPolicyPayloadHash.test.ts`, this checkpoint. One new pure module; original policy GET/PATCH registration, middleware and RPC arguments unchanged.
- Pre-commit roundtrip reconstructed original service byte-for-byte. Dedicated test compares existing canonical behavior (nested order, undefined omission, null, arrays, idempotency-key distinctions). CI Node 20 test/build/typecheck pending; run status to be reported in the PR.
- Branch: `refactor/backend-clinic-policy-hash-20261011`; implementation commit and PR are recorded in GitHub PR metadata; no merge, no deploy.
- Related open PRs: #381 (consolidated server extraction), #382 (Help Center), #383 (health details); paths in this slice are disjoint. Do not merge duplicate ancestors of #381.
- Progress: slice implementation 1/1 (100%) when committed. Baseline `server.ts` is unchanged, 0/102,066 lines reduced directly in staging (0%). Overall backend completion has no defensible bounded denominator.
- Next safe slice: pick a separate domain after inspecting then-current `staging` and open PR overlap. No factory or Issue dependency.
