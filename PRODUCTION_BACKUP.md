# Meera frontend production backup

Snapshot recorded: 2026-09-10 (Asia/Kolkata)

## Production identity

- Vercel project: `meera-frontendv2`
- Project ID: `prj_vcwkcVasl0IHsZaNuCqNF362AN5Y`
- Team ID: `team_GElsejSOv3JCiuXlZNgvnGT5`
- Production deployment ID: `dpl_4RiCFYnTVAHGgDvszPmPrHWQgejG`
- Immutable deployment URL: `meera-frontendv2-8ldameaq0-ss-projects-147424ea.vercel.app`
- Production alias: `meera-frontendv2-ss-projects-147424ea.vercel.app`
- Deployment state: `READY`
- Deployment timestamp: `2026-09-09T07:42:37.676Z`
- Reported Git SHA: `61ed20a0a8dd7644a647c1a86f56fcc7bdd0848b`
- Reported Git ref: `codex/bejb69csl-baseline`
- Reported commit message: `fix(auth): avoid forced Google account chooser`

## Provenance comment

Vercel reported `gitDirty=1` for this deployment. At verification time the canonical deployment directory was still at the reported Git SHA and contained one untracked file: `p.textContent.includes('Text')`. The file is zero bytes, predates the production deployment, and is included in this branch so the GitHub backup records the observable uploaded working tree rather than silently discarding the dirty-source marker. It has no runtime content.

All tracked application source in this backup comes from the deployment-reported commit. This note was added after deployment for auditability and was not part of the deployed runtime.

No Vercel environment variables, secrets, build cache, or generated `.next` output are stored here. Creating this backup did not redeploy or modify production.

Verification performed on the snapshot: `pnpm exec tsc --noEmit --incremental false` passed, and `git diff --check` passed.

## Restore reference

Use the annotated Git tag `prod-frontend-20260910` or branch `codex/backup-prod-frontend-20260910`. Confirm `.vercel/project.json` points to the project and team IDs above before any deliberate restore deployment.
