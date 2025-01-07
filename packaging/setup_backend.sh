#!/usr/bin/env bash

set -euxo pipefail

echo -e "\033[1m# setting up backend:\033[0m\n"
wait4x postgresql "postgres://@/transcribee?host=$(pwd)/../backend/db/sockets/"
poe -C ../backend/ migrate
poe -C ../backend/ create_user --user test --pass test
poe -C ../backend/ create_worker --token dev_worker --name "Development Worker"
