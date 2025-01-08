#!/usr/bin/env python

import argparse

import yaml
from transcribee_backend.main import app

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    args = parser.parse_args()
    with open(args.file, "w") as f:
        yaml.dump(app.openapi(), f)
