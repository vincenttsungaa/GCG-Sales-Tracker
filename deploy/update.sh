#!/usr/bin/env bash
# Put the latest code live: pull, install, build the frontend, restart. From the repo folder:  bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"

git pull --ff-only
uv pip install --python backend/venv/bin/python -r backend/requirements.txt
(cd frontend && npm ci && npm run build)
sudo systemctl restart cardstakk

for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  if curl -fsS http://127.0.0.1:8001/api/ >/dev/null; then echo "CardStakk is running."; exit 0; fi
done
echo "CardStakk didn't start. See why with: journalctl -u cardstakk -n 50"
exit 1
