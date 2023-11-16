#!/usr/bin/env bash

set -euxo pipefail

echo -e "\033[1m# setting up backend:\033[0m\n"
pdm run -p ../backend/ migrate
pdm run -p ../backend/ create_user --user test --pass test
pdm run -p ../backend/ create_worker --token dev_worker --name "Development Worker"
