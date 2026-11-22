#!/bin/bash
set -e
cd "$(dirname "$0")"

# Finder and Terminal may resolve python3 to Apple's older system Python.
python_bin=""
for candidate in python3.12 python3.13 python3.14 python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /opt/local/bin/python3.12 /opt/local/bin/python3.13 /opt/local/bin/python3.14; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
    python_bin="$(command -v "$candidate")"
    break
  fi
done
if [ -z "$python_bin" ]; then
  printf '\nCivic Lens needs Python 3.12 or newer. Install it from https://www.python.org/downloads/ and launch again.\n'
  exit 1
fi
if [ ! -x backend/.venv/bin/python ]; then
  "$python_bin" -m venv backend/.venv
elif ! backend/.venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
  printf '\nRebuilding the local Python environment for Civic Lens…\n'
  mkdir -p backend/.cache
  mv backend/.venv "backend/.cache/previous-venv-$$"
  "$python_bin" -m venv backend/.venv
fi

requirements_hash="$(backend/.venv/bin/python -c 'from pathlib import Path; import hashlib; print(hashlib.sha256(Path("backend/requirements.txt").read_bytes()).hexdigest())')"
installed_hash="$(cat backend/.venv/.requirements.sha256 2>/dev/null || true)"
if [ "$requirements_hash" != "$installed_hash" ] || ! backend/.venv/bin/python -c 'import fastapi, uvicorn, httpx, dotenv' >/dev/null 2>&1; then
  backend/.venv/bin/python -m pip install -r backend/requirements.txt
  printf '%s' "$requirements_hash" > backend/.venv/.requirements.sha256
fi

# Optional settings allow a separate verification copy without affecting the main demo.
app_port="${CIVIC_LENS_PORT:-8000}"
case "$app_port" in ''|*[!0-9]*) printf 'CIVIC_LENS_PORT must be a number.\n'; exit 1 ;; esac
if [ "$app_port" -lt 1 ] || [ "$app_port" -gt 65535 ]; then
  printf 'CIVIC_LENS_PORT must be between 1 and 65535.\n'
  exit 1
fi
app_url="http://127.0.0.1:$app_port"
if curl --fail --silent "$app_url/api/status" 2>/dev/null | backend/.venv/bin/python -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("scoring")=="deterministic" and d.get("data_source") in ("sample", "live+sample") else 1)' 2>/dev/null; then
  printf '\nCivic Lens is already running: %s\n' "$app_url"
  if [ "${CIVIC_LENS_NO_BROWSER:-0}" != "1" ]; then open "$app_url"; fi
  exit 0
fi
printf '\nCivic Lens: %s\nLeave this window open. Press Control+C to stop.\n\n' "$app_url"
if [ "${CIVIC_LENS_NO_BROWSER:-0}" != "1" ]; then
  (
    for attempt in {1..30}; do
      if curl --fail --silent --output /dev/null "$app_url/health"; then
        open "$app_url"
        break
      fi
      sleep 1
    done
  ) &
fi
exec backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port "$app_port"
