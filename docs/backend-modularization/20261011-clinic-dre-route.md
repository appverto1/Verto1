# Backend modularization: clinic DRE GET route

- Baseline staging commit: `162a1c53c93aefaedb88cad36d9fbba8656b3724`.
- Original server.ts Git blob: `b5460aa69d3cee3ff6ec96849f61537974007997` (102,066 lines).
- Extracted exactly one `GET /api/clinic/dre` handler to `services/clinicDreHandler.ts`; route registration stays at its original position with exactly the same `checkAuth` middleware.
- Business logic and response/error payload are copied byte-for-byte; no additional database query, environment access, auth change, data write or new dependency.
- The one-time isolated writer validated original blob SHA, unique route anchor, original 37-line handler and exact reverse reconstruction before editing.
- Resulting `server.ts` has 102031 lines; direct reduction: 35 lines (35 / 102,066 = 0.0343%).
- Node 20 focused test and Vite build are required by the temporary one-run workflow; full staging CI is required before merge. No production deployment.
- The temporary writer script and workflow are removed from the resulting feature branch before PR; no privileged writer workflow goes to staging.
- PR, merge and deploy: not performed at initial checkpoint; verify actual GitHub state and append evidence after checks.
