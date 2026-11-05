# API deploy: build in GitHub Actions, EC2 only pulls

```
push to main (backend/, deploy/, data/)
  -> job build:  docker buildx (layer cache) -> ghcr.io/debmukdm-jioinstitute/fund-horizon-api:<sha> + :latest   (~2-4 min)
  -> job deploy: SSM runs deploy/redeploy.sh on the instance (docker pull, start beside live, health check, nginx swap)  (~1-2 min)
  -> checks:     /health and /health/core floors
```

EC2 builds and installs nothing: no `git clone`, no `pip install`, no 5-minute timer. If the new image is unhealthy it is
discarded and the old container keeps serving (automatic rollback). Sessions live in `/home/ubuntu/fhdata`, nobody is signed out.

## One-time setup
1. Repo secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` already exist for the old flow; nothing new.
2. The first run creates the GHCR package. If the pull fails with "denied", open GitHub, Packages, `fund-horizon-api`,
   Package settings, and add the repository `Fund-Horizon` with **Read** access.
3. Nothing to install on EC2. The next deploy removes the old `/etc/cron.d/fh-auto-deploy` timer by itself.

## Re-run or roll back
- Re-run: GitHub, Actions, **Deploy API (AWS)**, Run workflow (or re-run the failed run).
- Roll back to an earlier commit: run the workflow from that commit's SHA on `main`, or on the instance
  `sudo docker tag fh-api:prev fh-api:new` and re-run the swap steps. Image tags are commit SHAs, so every release is kept in GHCR.

## Why it is "fast" and what is not instant
Build is cached by layer: a code-only change reuses the dependency layer, so only the app copy and push run. The swap
waits for the new container's `/health` (up to 2 min). Total is typically 3-6 min, down from 18-26.
