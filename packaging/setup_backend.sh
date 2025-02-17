#!/usr/bin/env bash

set -euxo pipefail

echo -e "\033[1m# setting up backend:\033[0m\n"
if [[ -z "TRANSCRIBEE_BACKEND_DATABASE_URL" ]]; then
  wait4x postgresql "postgres://@/transcribee?host=$(pwd)/../backend/db/sockets/"
fi
poe -C ../backend/ migrate
poe -C ../backend/ admin create_user --user test --pass test
poe -C ../backend/ admin create_worker --token dev_worker --name "Development Worker"
