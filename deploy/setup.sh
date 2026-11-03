#!/usr/bin/env bash
# One-time setup on the server (Oracle Cloud, Ubuntu 24.04). From the repo folder:  bash deploy/setup.sh
# Installs Node.js (to build the frontend), uv + Python 3.14 (the backend), and the CardStakk service.
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR=$(pwd)

# the free 1 GB server needs swap to build the frontend
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

sudo apt-get update
sudo apt-get install -y git curl ca-certificates
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
# uv brings its own Python 3.14 (the version CardStakk is built with) without touching the system one
export PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh

cd backend
[ -x venv/bin/python ] || uv venv venv --python 3.14
uv pip install --python venv/bin/python -r requirements.txt
[ -f .env ] || cp .env.example .env

sed "s|__APP_DIR__|$APP_DIR|g; s|__USER__|$USER|g" ../deploy/cardstakk.service | sudo tee /etc/systemd/system/cardstakk.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable cardstakk
echo
echo "Setup done. Next: fill in backend/.env (nano backend/.env), then run: bash deploy/update.sh"
