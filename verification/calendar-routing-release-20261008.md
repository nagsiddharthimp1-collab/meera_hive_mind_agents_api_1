# Calendar routing release — 2026-10-08

Canonical directory: `_deploy_meera_frontend`, branch `codex/bejb69csl-baseline`, baseline snapshot `05ddb68`.

Changes: recognize natural calendar rescheduling verbs, consult real pending actions for typed approval, and display the backend's truthful no-pending response directly. Ordinary chat and conditional consent remain outside this approval flow.

Verification: frontend routing tests 8/8 passed; Vercel production build and TypeScript check passed. The local OneDrive build had a filesystem error, so the remote build was used. No UI component files were changed.

The current directory and `.vercel/project.json` were checked before deployment and promotion: `meera-frontendv2`, project `prj_vcwkcVasl0IHsZaNuCqNF362AN5Y`, team `team_GElsejSOv3JCiuXlZNgvnGT5`.

Deployment `dpl_5Xtyp7hgZys9buK1Y2GpUcDdZX75` is READY and promoted. Production alias `https://meera-frontendv2-ss-projects-147424ea.vercel.app` returns HTTP 200.

Backend verification and scope are recorded in `meera-supabase/verification/calendar-routing-fix-20261008.md`. Only the owner's account and disposable, invitation-free calendar events were used for live testing.
