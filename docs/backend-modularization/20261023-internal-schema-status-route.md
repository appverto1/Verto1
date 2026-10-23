# Backend modularization — protected internal schema-status

- Date: 2026-10-23; base staging a850b45a54dc64ccbe3962976d10ba87c2c376e0; source server blob 89d3a895797eb61503c777c0ea68f9a1c61f93a0.
- Supersedes [PR #388](https://github.com/appverto1/Verto1/pull/388), whose old branch diverged by 404 commits.
- Only GET /api/internal/schema-status is extracted. The handler body matches the old route byte-for-byte.
- Route remains in the same location with checkAuth then checkPlatformAdmin, including session, platform admin identity and MFA checks.
- Response contract, Boolean(req.query?.refresh), checkedAt, TTL and nextCheckAt remain identical.
- Exact server reverse-transformation parity verified, 19 net lines removed. One request remains one authorized schema status lookup.
- HTTP regression inherited from #388 tests 401, 403, zero probes for denied requests, full success contract, refresh behavior and null timestamps.
- New test added to pre-main ratchet. No SQL, RLS, Supabase migrations, Stripe, billing, clinical saves, notifications or Production changes.
- GitHub CI, Railway deployment and human smoke are separate validation gates, never inferred as passed.
