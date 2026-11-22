#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -x backend/.venv/bin/python ]; then
  python3 -m venv backend/.venv
fi
if ! backend/.venv/bin/python -c 'import fastapi, uvicorn, httpx, dotenv' >/dev/null 2>&1; then
  backend/.venv/bin/python -m pip install -r backend/requirements.txt
fi
if curl --fail --silent http://127.0.0.1:8000/api/status 2>/dev/null | backend/.venv/bin/python -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("scoring")=="deterministic" and d.get("data_source")=="sample" else 1)' 2>/dev/null; then
  printf '\nCivic Lens is already running: http://127.0.0.1:8000\n'
  open http://127.0.0.1:8000
  exit 0
fi
printf '\nCivic Lens: http://127.0.0.1:8000\nLeave this window open. Press Control+C to stop.\n\n'
(
  for attempt in {1..30}; do
    if curl --fail --silent --output /dev/null http://127.0.0.1:8000/health; then
      open http://127.0.0.1:8000
      break
    fi
    sleep 1
  done
) &
exec backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
