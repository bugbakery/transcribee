#!/bin/bash
set -euo pipefail

# migrate db before starting
poe migrate

if [ ! -z "$TESTUSER_PASSWORD" ]; then
  poe admin create_user --user test --pass "$TESTUSER_PASSWORD"
fi

uvicorn transcribee_backend.main:app \
  --host "0.0.0.0" \
  --ws websockets \
  --workers 1 # TODO: fix backend for more than one worker
