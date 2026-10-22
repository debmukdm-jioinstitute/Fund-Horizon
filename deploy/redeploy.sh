#!/usr/bin/env bash
# Rebuild and restart the API container on the AWS server from the latest main, with automatic rollback.
# Manual run (AWS Session Manager, as the ubuntu user; ssm-user cannot touch /home/ubuntu):
#   curl -sL https://raw.githubusercontent.com/debmukdm-jioinstitute/Fund-Horizon/main/deploy/redeploy.sh | sudo -iu ubuntu bash
# Normally this runs by itself via deploy/auto-deploy.sh. Secrets stay in /home/ubuntu/fh.env; the database in /home/ubuntu/fhdata.
set -euo pipefail
H=/home/ubuntu
REPO=https://github.com/debmukdm-jioinstitute/Fund-Horizon

run_api() {  # $1 = image
  sudo docker rm -f fh-api >/dev/null 2>&1 || true
  sudo docker run -d --name fh-api --restart unless-stopped --network fhnet -p 127.0.0.1:8000:8000 \
    -v $H/fhdata:/dbdata --env-file $H/fh.env \
    -e FH_DB_PATH=/dbdata/plans.db -e FH_COOKIE_SECURE=true -e FH_GUEST_LOGIN=1 -e FH_SEED_CRM=false -e FH_INTERNAL_ONLY=false \
    -e FH_COBALT_URL=http://cobalt:9000 \
    -e FH_CORS_ORIGINS=https://fundhorizon.website,https://www.fundhorizon.website,https://fund-horizon-web.fundhorizon.workers.dev \
    "$1" >/dev/null
}
healthy() { for _ in $(seq 1 18); do sleep 5; curl -sf -m 5 localhost:8000/health >/dev/null && return 0; done; return 1; }

rm -rf $H/fh-src && git clone --depth 1 $REPO $H/fh-src
cd $H/fh-src
git rev-parse HEAD > $H/.last-built-sha
sudo docker image inspect fh-api:latest >/dev/null 2>&1 && sudo docker tag fh-api:latest fh-api:prev || true
sudo docker build -f deploy/api.Dockerfile --target lean -t fh-api:new .
sudo docker network create fhnet >/dev/null 2>&1 || true
run_api fh-api:new
if healthy; then
  sudo docker tag fh-api:new fh-api:latest
  echo "API up on $(git rev-parse --short HEAD)"
else
  echo "New build failed its health check; rolling back" >&2
  if sudo docker image inspect fh-api:prev >/dev/null 2>&1; then run_api fh-api:prev; healthy && echo "Rolled back to the previous build" >&2; fi
  exit 1
fi
