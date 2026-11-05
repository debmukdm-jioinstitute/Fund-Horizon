#!/usr/bin/env bash
# Zero-downtime API deploy of a PRE-BUILT image. GitHub Actions builds and pushes it to GHCR (deploy-api.yml); this server only
# pulls it, starts it beside the live one, waits until it is healthy, switches a small nginx proxy (reload, no dropped
# requests), then retires the old container. If the new image is unhealthy it is discarded and the old one keeps serving.
# Nothing is built or installed here. Sessions live in the database on /home/ubuntu/fhdata, so nobody is signed out.
# Needs FH_IMAGE (full image ref) and GHCR_TOKEN (read access to it), both passed in by the workflow. Secrets stay in /home/ubuntu/fh.env.
set -euo pipefail
H=/home/ubuntu
# One deploy at a time; a second run waits here.
exec 8>$H/.redeploy.lock; flock 8
PX=$H/fh-proxy
# The old 5-minute timer (build on this box) is retired; stop it so it can never fight the Actions deploy.
sudo rm -f /etc/cron.d/fh-auto-deploy
if [ -z "${FH_IMAGE:-}" ]; then echo "Deploys now come from GitHub Actions (Deploy API). Nothing to do here."; exit 0; fi
[ "$FH_IMAGE" = "$(cat $H/.deploy-ok-image 2>/dev/null)" ] && { echo "$FH_IMAGE is already live; nothing to do"; exit 0; }
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

echo "$GHCR_TOKEN" | $D login ghcr.io -u actions --password-stdin >/dev/null
$D image inspect fh-api:latest >/dev/null 2>&1 && $D tag fh-api:latest fh-api:prev || true
$D pull -q "$FH_IMAGE"
$D tag "$FH_IMAGE" fh-api:new
$D logout ghcr.io >/dev/null
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
echo "$FH_IMAGE" > $H/.deploy-ok-image
$D tag fh-api:new fh-api:latest
[ "$cur" != none ] && { sleep 15; $D rm -f fh-api-$cur >/dev/null 2>&1 || true; }  # let in-flight requests finish
$D image prune -f >/dev/null 2>&1 || true  # keep the small disk free
echo "API up on $FH_IMAGE (fh-api-$new)"
