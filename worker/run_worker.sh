#!/bin/sh
set -e
cd "$(dirname "$(realpath -- "$0")")"
bin/python -m transcribee_worker.run $*
