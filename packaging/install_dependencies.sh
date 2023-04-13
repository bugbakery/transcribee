#!/usr/bin/env bash

# Installs the dependencies of all transcribee components
# This script should work on a fresh clone of transcribee but should be run in an environment like
# the one described in the shell.nix file.

set -euxo pipefail

echo -e "\033[1m# installing dependencies:\033[0m\n"

# So Ctrl+C kills all runnning commands
trap 'kill 0' SIGINT

pids=()

pdm install -p backend/ & pids+=($!)
pdm install -p worker/ & pids+=($!)
pnpm --prefix frontend/ install & pids+=($!)

# Wait until all install commands are finished
error=false
for pid in ${pids[*]}; do
    if ! wait $pid; then
        error=true
    fi
done

if $error; then
    exit 1
fi
