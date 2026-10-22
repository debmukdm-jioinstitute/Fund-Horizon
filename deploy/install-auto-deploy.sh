#!/usr/bin/env bash
# One-time setup, run in AWS Session Manager:
#   curl -sL https://raw.githubusercontent.com/debmukdm-jioinstitute/Fund-Horizon/main/deploy/install-auto-deploy.sh | sudo -iu ubuntu bash
# Deploys the latest main now, then installs a 5-minute check that deploys new backend/deploy/data changes by itself.
set -euo pipefail
H=/home/ubuntu
RAW=https://raw.githubusercontent.com/debmukdm-jioinstitute/Fund-Horizon/main/deploy
curl -sfL $RAW/redeploy.sh -o $H/fh-redeploy.sh
curl -sfL $RAW/auto-deploy.sh -o $H/fh-auto-deploy.sh
chmod +x $H/fh-redeploy.sh $H/fh-auto-deploy.sh
# Deploy the latest main now; only later pushes are picked up by the timer.
bash $H/fh-redeploy.sh
cp $H/.last-built-sha $H/.deployed-sha
echo '*/5 * * * * ubuntu /home/ubuntu/fh-auto-deploy.sh >> /home/ubuntu/auto-deploy.log 2>&1' | sudo tee /etc/cron.d/fh-auto-deploy >/dev/null
sudo chmod 644 /etc/cron.d/fh-auto-deploy
echo "Auto-deploy installed. Log: /home/ubuntu/auto-deploy.log"
