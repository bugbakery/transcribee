#!/usr/bin/env bash

# Installs the dependencies of all transcribee components & starts them for development purposes.
# This script should work on a fresh clone of transcribee but should be run in an environment like
# the one described in the shell.nix file.

set -euxo pipefail

./packaging/dev_prepare.sh

echo -e "\033[1m# setting up backend:\033[0m\n"
pdm run -p backend/ manage migrate
pdm run -p backend/ manage create_superuser_if_not_exists --user test --pass test
pdm run -p backend/ manage create_worker --token dev_worker --name "Development Worker"

echo -e "\n\n\033[1m# starting application:\033[0m\n"
overmind start
