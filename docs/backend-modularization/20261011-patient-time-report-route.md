# Backend modularization: patient time-report GET

- Baseline: `staging` commit `5fc564ba5b11bef1f21b56e4f81fd6c43e587f60`; original `server.ts` blob `aa914fac455bbd82fab898843cdee795acccf33a` (101730 lines).
- Single independent route: `GET /api/reports/time/patient`; original body and HTTP error/success branches copied without changes into `services/patientTimeReportRoute.ts`. The same `checkAuth` and `requireClinicCapability('reports.view')` middleware remain in the same order and registration point.
- Explicit injected dependencies: checkAuth, requireClinicCapability, sanitizeString, currentClinicId, sanitizeIsoDateTime, fetchTimeReportAppointments, buildPatientTimeReport.
- Relevant files: `server.ts`, `services/patientTimeReportRoute.ts`, `tests/patientTimeReportRoute.test.ts`, this checkpoint. No DB migration, permissions/RLS change, Stripe/Resend change or production modification.
- Static preflight: unique original route, matching independent block, direct moved-body parity and exact round-trip reconstruction of `server.ts`. Expected server.ts size: 101730 → 101707 lines (23 lines saved).
- Focused automated HTTP test added for 401/403, blocked DB access, authenticated clinic isolation, successful filters/200 and 500 response. Execute with `node --import tsx tests/patientTimeReportRoute.test.ts` on Node 20; also require `npm run build` and PR staging CI.
- Status: source/parity preflight performed. End-to-end test/build, PR CI, merge and deploy must be verified separately. No merge or deployment authorized.
- Feature branch: `refactor/backend-patient-time-report-route-20261011`. Commit SHA/PR and test results to be recorded after actual GitHub verification.
- Next candidate: separate read-only professional time report; recheck staging head and overlapping PRs first.
