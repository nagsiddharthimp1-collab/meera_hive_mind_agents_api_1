# Product and growth analytics release — 12 October 2026

Canonical frontend: `C:\Users\siddh\OneDrive\Documents\ChatGPT\Meera\_deploy_meera_frontend`.
Branch: `codex/bejb69csl-baseline`, descended from baseline `05ddb68`.
Deployed source commit: `d5e380d`.
Project: `meera-frontendv2`, `prj_vcwkcVasl0IHsZaNuCqNF362AN5Y`, team `team_GElsejSOv3JCiuXlZNgvnGT5`.
Tested production deployment: `dpl_HxytUy5JWD6wGxPDe1PUx1aQJkdK`.
Deployment URL: https://meera-frontendv2-6bvkqzgo4-ss-projects-147424ea.vercel.app
Live URL: https://www.himeera.com/analytics
Database: MeeraDb / `xilapyewazpzlvqbbtgl`; applied migration `20261012105426_growth_product_dashboard`.

## Delivered

One scrollable home dashboard: business KPIs, registered/new/active/returning/inactive/ever-paid/never-paid user segments, inline paginated/searchable user drilldowns, active-share donut, engagement distribution, signup and active-user trends, tracked-channel outcomes, nested signup activation funnel, exact-day D1/D7/D14/D30 cohort heatmap, engagement trend, revenue and recorded AI spend graphs, unit economics, AI request/token/cost trends, model breakdown, and recent-activity model/status filters. Shared presets/custom dates, equal-length previous-period comparisons, accessible chart data tables, CSV trend export, mobile layouts, independent loading/error states, and source definitions are included.

The old executive RPC reproducibly returned PostgreSQL `57014` (statement timeout). The home page now uses a separate read-only source function with native UUID joins, database-side user/day aggregation and AI grouping sets. It does not fetch chat content. The existing legacy endpoint and other analytics views remain available.

## Verification

- Production build passed compilation, TypeScript checks, and all 43 static pages.
- Local TypeScript passed after restoring formatting helpers needed by the existing subpages.
- Targeted ESLint passed with no errors. Three incompatible legacy TypeScript ESLint rules were disabled for the check (`no-empty-function`, `no-unused-expressions`, `no-unused-vars`); nine non-null assertion warnings remain. No project lint configuration or dependency versions were changed.
- Metric tests passed: UTC boundaries, equal-length comparison windows, database-grouped activity counts, alias resolution, attribution, nested funnel, exact-day retention maturity, missing-versus-zero handling, and weekly bucketing.
- Real production-source adapter checks passed: 30-day snapshot, today, 7 days, 90 days, lifetime, and equality of graph totals to headline metrics. Direct load durations ranged from approximately 0.4 to 2.8 seconds in the recorded run.
- Current 30-day live snapshot: 476 registered users, 40 signups, 49 active users, 13 returning users, 329 user messages, 90% new-user activation, one payer, INR 499 revenue, 1,563 recorded requests, and USD 2.5955 recorded cost with 72.7% cost coverage.
- Browser simulations use real aggregate fixtures, synthetic browser authentication, and anonymized user names/emails. They passed metric rendering, all chart types, cohort rendering, metric switching, chart data tables, inline user drilldown/search, date presets/invalid dates, CSV download, independent source failures and recovery, status filters, and no browser errors.
- Browser layout checks passed at 1440, 1024, 768, 550, 390 and 320 pixels without horizontal page overflow. Desktop/mobile screenshots were visually reviewed. The mobile sidebar also closes when crossing the mobile breakpoint.
- Staged deployment `/analytics` returned 200. Both new API routes rejected anonymous requests with 401. Database privilege checks confirmed `anon=false`, `authenticated=false`, `service_role=true` for function execution. The function is SECURITY INVOKER with fixed search path and UTC timezone.
- Security advisors returned existing unrelated findings; none reference the new reporting function. No table permissions or existing security policies were changed.
- Promoted the same READY production build. Vercel inspection confirms `www.himeera.com` resolves to `dpl_HxytUy5JWD6wGxPDe1PUx1aQJkdK`.
- Real signed-in production browser confirmed the month metrics, chart/cohort/model sections, seven-day metrics (19 active users, 495 AI requests), and live user drilldown (25 rows with pagination). Restored the default month, closed the drilldown, and saved `analytics-production.png`.

## Measurement limits

All dashboard boundaries are UTC and today remains incomplete. Acquisition uses existing first-touch growth-link attribution; the current 40 signups have no tracked source and correctly remain Unknown. AI cost/latency are recorded telemetry with explicit coverage, not assumed complete OpenRouter account invoices. Ever-paid history is not current subscription entitlement. Retention uses only matured exact-day denominators; no future return activity is included. Product snapshots can be reused server-side for up to 60 seconds. Historical activation speed and lifetime value are not inferred. OpenRouter's linked activity reference required sign-in; no access to its private account data is claimed.
