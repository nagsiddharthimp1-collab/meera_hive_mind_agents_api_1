# Growth headline follow-up — 2026-10-12

Source commit: `90651ca`; production deployment: `dpl_5AJH1Ndvamxees48uyyr7ssd8Ggv`.

Kept Registered users. Replaced New-user activation and Signup → paid headline cards with Avg. messages / new user and Payment opened. Ordered eight cards by acquisition, engagement, and monetization with explicit stage labels; existing detailed activation funnel remains available.

New-user messages divides messages in the selected window from new signups by every signup in that window, including zero-message signups. Payment opens counts distinct canonical users with tracked payment-page-open events in the selected window; new and existing users are included. Both compare with the preceding equal-length window. No schema change.

Passed deterministic boundary/identity/zero/unavailable tests, TypeScript, targeted ESLint (zero errors; six existing non-null assertion warnings), live database adapter checks, and browser checks including card order, payment opener drilldown, filters, CSV, source-error recovery, graphs, and no horizontal overflow at 320–1440px. Vercel production build generated all 43 pages; staged analytics returned HTTP 200. Verified project identity before deploy and promotion.

After promotion, the signed-in production dashboard showed Registered users 476, New signups 40, Active users 49, Returning users 13, Avg. messages / new user 3.4, Payment opened 1, Paying customers 1, and Revenue collected ₹499 for Sep 13–Oct 12. Production payment-open drilldown returned one row. Screenshot: `analytics-funnel-production.png`.
