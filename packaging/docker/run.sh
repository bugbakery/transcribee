#!/bin/bash
set -eo pipefail

# migrate db before starting
poe migrate

if [ ! -z "$TESTUSER_PASSWORD" ]; then
  poe admin create_user --user test --pass "$TESTUSER_PASSWORD"
fi

if  [ ! -z "$WORKER_TOKEN_PATH" ] && [ ! -f "$WORKER_TOKEN_PATH" ]; then
  WORKER_TOKEN=$(tr -dc 'A-Za-z0-9' < /dev/random | head -c32 || true)
  poe admin create_worker --token "$WORKER_TOKEN" --name "Default Docker Worker"
  echo -n $WORKER_TOKEN > "$WORKER_TOKEN_PATH"
fi

uvicorn transcribee_backend.main:app \
  --host "0.0.0.0" \
  --ws websockets \
  --workers 1 # TODO: fix backend for more than one worker
