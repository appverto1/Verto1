# ABA chart GET batch extraction — 2026-10-13

- Base staging: 52e2686c21d284ee0e948f9827b4719032a328e6. Six GET routes: charts/{targets, behaviors, mastery, maintenance, session-changes, overview}.
- Original middleware chains, registration locations, patient/clinic scope checks, callbacks and response logic preserved. The callback bodies in the new module match the original byte for byte; the original server.ts is exactly reconstructable from the output.
- Lazy dependency injection only (no new requests, DB/RLS/role changes, persistence changes, Stripe changes, or background jobs).
- Regression: original middleware statements, full server.ts byte-for-byte roundtrip, 6 invalid-patient checks and targets-success tenant scoping mock.
- server.ts: 99101 → 98712 lines (−389).
- Real CI status, deploy status and live authenticated staging smoke require independent verification.
