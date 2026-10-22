#!/usr/bin/env bash
# Rebuild and restart the API container on the AWS server from the latest main.
# Run on the server (Session Manager works): curl -sL https://raw.githubusercontent.com/debmukdm-jioinstitute/Fund-Horizon/main/deploy/redeploy.sh | bash
# Secrets stay on the server in /home/ubuntu/fh.env (OPENAI_API_KEY=...); the database lives in /home/ubuntu/fhdata.
set -euo pipefail
H=/home/ubuntu
rm -rf $H/fh-src && git clone --depth 1 https://github.com/debmukdm-jioinstitute/Fund-Horizon $H/fh-src
cd $H/fh-src && sudo docker build -f deploy/api.Dockerfile --target lean -t fh-api .
sudo docker network create fhnet >/dev/null 2>&1 || true
sudo docker rm -f fh-api >/dev/null 2>&1 || true
sudo docker run -d --name fh-api --restart unless-stopped --network fhnet -p 127.0.0.1:8000:8000 \
  -v $H/fhdata:/dbdata --env-file $H/fh.env \
  -e FH_DB_PATH=/dbdata/plans.db -e FH_COOKIE_SECURE=true -e FH_GUEST_LOGIN=1 -e FH_SEED_CRM=false -e FH_INTERNAL_ONLY=false \
  -e FH_COBALT_URL=http://cobalt:9000 \
  -e FH_CORS_ORIGINS=https://fundhorizon.website,https://www.fundhorizon.website,https://fund-horizon-web.fundhorizon.workers.dev \
  fh-api
sleep 25 && curl -s -m 10 localhost:8000/health && echo " <- API up"
