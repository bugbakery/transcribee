#!/usr/bin/env bash

# Installs the dependencies of all transcribee components & sets them up to a workable state.
# This script should work on a fresh clone of transcribee but should be run in an environment like
# the one described in the shell.nix file.

set -euxo pipefail

echo -e "\033[1m# installing dependencies:\033[0m\n"

# So Ctrl+C kills all runnning commands
trap 'kill 0' SIGINT

pdm install -p backend/ &
pdm install -p worker/ &
pnpm --prefix frontend/ install &

# Wait until all install commands are finished
wait
