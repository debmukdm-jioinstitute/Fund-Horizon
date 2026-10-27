#!/usr/bin/env bash
# Zero-downtime API deploy from the latest main. Builds a new container beside the live one, waits until it is
# healthy, switches a small nginx proxy (reload, no dropped requests), then retires the old container.
# If the new build is unhealthy it is discarded and the old one keeps serving. Sessions live in the database on
# /home/ubuntu/fhdata, so nobody is signed out.
# Manual run (AWS Session Manager, as the ubuntu user; ssm-user cannot touch /home/ubuntu):
#   curl -sL https://raw.githubusercontent.com/debmukdm-jioinstitute/Fund-Horizon/main/deploy/redeploy.sh | sudo -iu ubuntu bash
# Normally this runs by itself via deploy/auto-deploy.sh. Secrets stay in /home/ubuntu/fh.env.
set -euo pipefail
H=/home/ubuntu
# One deploy at a time: the server timer and the GitHub Actions deploy can fire together; the second waits here.
exec 8>$H/.redeploy.lock; flock 8
REPO=https://github.com/debmukdm-jioinstitute/Fund-Horizon
PX=$H/fh-proxy
# Every run builds the newest main, so a run queued behind the lock is redundant once that main is already live.
remote=$(git ls-remote $REPO refs/heads/main | cut -f1)
[ -n "$remote" ] && [ "$remote" = "$(cat $H/.deploy-ok-sha 2>/dev/null)" ] && { echo "main $remote is already live; nothing to do"; exit 0; }
D="sudo docker"

start_api() {  # $1 = container name, $2 = image
  $D rm -f "$1" >/dev/null 2>&1 || true
  $D run -d --name "$1" --restart unless-stopped --network fhnet \
    -v $H/fhdata:/dbdata --env-file $H/fh.env \
    -e FH_DB_PATH=/dbdata/plans.db -e FH_COOKIE_SECURE=true -e FH_GUEST_LOGIN=1 -e FH_SEED_CRM=false -e FH_INTERNAL_ONLY=false \
    -e FH_COBALT_URL=http://cobalt:9000 \
    -e FH_CORS_ORIGINS=https://fundhorizon.website,https://www.fundhorizon.website,https://fund-horizon-web.fundhorizon.workers.dev \
    "$2" >/dev/null
}
healthy() {  # $1 = container name; up to 2 minutes
  for _ in $(seq 1 24); do
    sleep 5
    $D exec "$1" python -c "import urllib.request as u; u.urlopen('http://localhost:8000/health', timeout=5)" >/dev/null 2>&1 && return 0
  done
  return 1
}
point_proxy() {  # $1 = container name. Written in place (same inode) so the bind mount and reload keep working.
  cat > $PX/default.conf <<CONF
server {
    listen 80;
    client_max_body_size 50m;
    location / {
        proxy_pass http://$1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$http_host;
        proxy_read_timeout 300s;
    }
}
CONF
}

rm -rf $H/fh-src && git clone --depth 1 $REPO $H/fh-src
cd $H/fh-src
git rev-parse HEAD > $H/.last-built-sha
$D image inspect fh-api:latest >/dev/null 2>&1 && $D tag fh-api:latest fh-api:prev || true
$D build -f deploy/api.Dockerfile --target lean -t fh-api:new .
$D network create fhnet >/dev/null 2>&1 || true
mkdir -p $PX; touch $PX/default.conf

cur=$(cat $PX/active 2>/dev/null || echo none)
[ "$cur" = blue ] && new=green || new=blue

start_api fh-api-$new fh-api:new
if ! healthy fh-api-$new; then
  $D rm -f fh-api-$new >/dev/null 2>&1 || true
  echo "New build failed its health check; discarded. The live API was not touched." >&2
  exit 1
fi

if $D ps --format '{{.Names}}' | grep -qx fh-proxy; then
  point_proxy fh-api-$new
  $D exec fh-proxy nginx -s reload
else
  # One-time move from "container publishes :8000" to "proxy publishes :8000": a gap of a couple of seconds.
  point_proxy fh-api-$new
  $D rm -f fh-api >/dev/null 2>&1 || true
  $D rm -f fh-proxy >/dev/null 2>&1 || true
  $D run -d --name fh-proxy --restart unless-stopped --network fhnet -p 127.0.0.1:8000:80 \
    -v $PX/default.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine >/dev/null
fi
echo $new > $PX/active
git rev-parse HEAD > $H/.deploy-ok-sha
$D tag fh-api:new fh-api:latest
[ "$cur" != none ] && { sleep 15; $D rm -f fh-api-$cur >/dev/null 2>&1 || true; }  # let in-flight requests finish
echo "API up on $(git rev-parse --short HEAD) (fh-api-$new)"
