#!/usr/bin/env bash
docker build . -f .devcontainer/Dockerfile -t transcribee-dev-env
docker run --rm -ti -v "$(pwd)":/workspace --mount source=transcribee-dev-env-nix,target=/nix,type=volume -p 5173:5173 transcribee-dev-env
