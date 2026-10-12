# Engaged new users — production verification

Source commit: `7fa4522`. Deployment: `dpl_F8WN91FfETAWc4jeJ2d7tj4EUUbK`.

Replaced the Active users headline card with Engaged new users: users who signed up in the selected UTC window and sent at least 10 user messages in that same window. Added share of all new signups and a distinct `engaged-new` drilldown. Ordered engagement cards: Engaged new users, Avg. messages / new user, Returning users. Existing active-user charts and five-message detailed funnel remain unchanged.

Verified 9/10/11-message boundaries, canonical/auth identity resolution, previous-window counts, existing-user exclusion, assistant-message exclusion, date boundaries, zero activity, missing message data, and matching drilldown users. TypeScript passed; targeted ESLint had zero errors and six existing warnings. Browser checks passed for card order, threshold/share display, drilldown, chart data, filters, CSV, source-error recovery, and viewport widths 320–1440px. Live database adapter checks passed. Production build generated all 43 pages; staged analytics returned HTTP 200. Verified canonical directory and exact Vercel team/project before deployment and promotion.

Signed-in production verification for Sep 13–Oct 12 showed 3 engaged new users, 7.5% of 40 signups, and three matching drilldown rows. The live card order places Avg. messages / new user before Returning users. Screenshot: `analytics-engaged-new-production.png`.
