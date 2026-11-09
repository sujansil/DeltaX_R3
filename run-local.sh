#!/usr/bin/env bash
# Local-only runner. Does not touch any Azure service or existing DeltaX repository.
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  echo "[R3] Creating local Python environment..."
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi
ADMIN_READY=$(.venv/bin/python -c 'from app import read_one; print(1 if read_one("SELECT username FROM admin LIMIT 1") else 0)')
if [[ "$ADMIN_READY" == "0" ]]; then
  echo "[R3] Create your operator credentials first."
  .venv/bin/python app.py init-admin
fi
echo
echo "[R3] Audience:  http://127.0.0.1:8303/"
echo "[R3] Admin:     http://127.0.0.1:8303/admin"
echo "[R3] Press Ctrl+C to stop."
echo
exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8303
