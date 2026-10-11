# Backend modularization — independent checkpoint

## 2026-10-11 — appointment policy payload hashing

- Baseline staging: 7a8c2df1a57b78640804d36de8e54b5fb190e0a1
- Extracted the existing stableValue / payloadHash helper from services/clinicAppointmentPolicyRoutes.ts to services/appointmentPolicyPayloadHash.ts.
- No changes to the handler logic, RPC argument p_payload_hash, route registrations, authentication, tenants, database, or runtime side effects.
- Regression test: tests/appointmentPolicyPayloadHash.test.ts (8 reference-equivalence inputs plus determinism and call-site checks).
- Local isolated verification: Node 22 experimental TS stripping passed for the extracted helper (no full-repo dependencies available locally).
- Pending: repository Node 20 CI/typecheck/build, PR review, merge and staging smoke. No production deployment.
- Branch: refactor/backend-appointment-policy-hash-20261011 (PR/commit in GitHub history).
- Direct server.ts line reduction: 0 of 102066 (0.0000%). Modularization unit: one pure backend helper extracted.
- Technical note: an attempt to update the 4.76 MB server.ts blob through the GitHub connector failed with an h2 transport error. No server.ts change was published; choose a different safe modularization slice instead.
- Next: resume direct server.ts extraction only when an authorized write transport can handle the file size; otherwise select another isolated backend module. Never repeat this helper extraction if the import exists.
