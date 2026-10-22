#!/usr/bin/env bash
# Runs every 5 minutes on the server (installed by deploy/install-auto-deploy.sh). If main has new changes under
# backend/, deploy/ or data/, it runs deploy/redeploy.sh (build, health check, automatic rollback).
# Frontend-only commits are skipped: the web app is on Cloudflare and deployed separately.
set -uo pipefail
H=/home/ubuntu
REPO=https://github.com/debmukdm-jioinstitute/Fund-Horizon
exec 9>$H/.auto-deploy.lock; flock -n 9 || exit 0
remote=$(git ls-remote $REPO refs/heads/main | cut -f1); [ -n "$remote" ] || exit 0
last=$(cat $H/.deployed-sha 2>/dev/null || true)
[ "$remote" = "$last" ] && exit 0
if [ -n "$last" ]; then
  tmp=$(mktemp -d); git clone -q --filter=blob:none --no-checkout $REPO $tmp 2>/dev/null
  changed=$(git -C $tmp diff --name-only "$last" "$remote" -- backend deploy data 2>/dev/null || echo force)
  rm -rf $tmp
  if [ -z "$changed" ]; then echo "$(date -u +%FT%TZ) $remote: nothing to deploy"; echo "$remote" > $H/.deployed-sha; exit 0; fi
fi
echo "$(date -u +%FT%TZ) deploying $remote"
if bash $H/fh-redeploy.sh; then echo "$remote" > $H/.deployed-sha; echo "$(date -u +%FT%TZ) deployed $remote"
else echo "$(date -u +%FT%TZ) deploy of $remote FAILED (rolled back); will retry on the next push"; echo "$remote" > $H/.deployed-sha; fi
