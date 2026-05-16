#!/usr/bin/env bash
set -ouxe pipefail
docker build . -f packaging/docker/Dockerfile-dev --tag transcribee-dev
docker run --rm -ti -v $(pwd):/workspace -p 5173:5173 transcribee-dev
