# Production history load repair — 2026-10-08

## Cause

My manual calendar-smoke cleanup inserted two owner-account test messages without `timestamp`. The database permits null timestamps and returned them first in descending history order. History loading called `a.timestamp.localeCompare(b.timestamp)`, which threw on null; the page displayed a misleading connection error.

The failing test session was `sess_r20260331f1_calendar_smoke_manual_cleanup_091237dbb02d4b63b95d71977567f7f8`. Only its two exact messages (`1ef97a50-2d32-49da-962a-2b02843860d4`, `a98a20cb-6886-4c4d-99f4-b0ab444fcbef`) were repaired, with timestamps from their cleanup task's creation time. Updates required the owner ID, exact message ID, exact test session and a null existing timestamp. No real messages or other accounts were modified.

## Code repair

- Normalize missing or invalid timestamps before returning history and image-history rows to the UI, using a stable fallback so sorting remains safe.
- Represent nullable database timestamps accurately in the type.
- Refuse context-window navigation when an anchor has no timestamp.
- The committed calendar live smoke already supplies timestamps; the defect was in the one-off manual cleanup helper.

## Verification and deployment

- Timestamp regression tests and existing agentic-routing tests: 10/10 pass.
- Local TypeScript check passes.
- Vercel production build and TypeScript validation pass; 41 static routes generated.
- Production deployment: `dpl_4B7McDoXxLJaW7ZCUnNSUxRdXYm7`, READY, aliased to `www.himeera.com`.
- Canonical directory and required project/team IDs verified before deployment.
- Owner history REST request returns HTTP 200 with 20 rows and no missing timestamps after repair.

Authenticated browser checks on the exact production deployment passed: real owner history renders, survives refresh, and still renders after injecting a null timestamp into an owner history response. Injection was browser-only; stored rows were not changed for this test. Both runs had successful history responses and no history-load exception.

Authenticated browser testing uses the custom Supabase domain's storage key (`sb-api-auth-token`), and existing project protection credentials are scoped to the tested Vercel origin. No authentication or deployment-protection settings were changed. Temporary test credentials were removed after locally signing out the test session.
