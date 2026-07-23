#!/usr/bin/env python3
# this script runs pre-commit checks for projects that are managed via package managers.
# It currently supports uv, npm and cargo. For each respective package manager it searches a project
# files (pyproject.toml, package.json or Cargo.toml) and runs the commands that we have as a
# conventon for that language to check and lint the project. It automatically discovers all
# projects in the transcribee monorepo.

from pathlib import Path
from subprocess import PIPE, STDOUT, Popen, check_output, run
from sys import argv
from textwrap import indent
from threading import Thread
from time import sleep

PROJECT_FILE_TYPES = {
    "package.json": {
        "install": "npm install",
        "checks": {
            "test": "npm run test run",
            "tsc": "npm run check:tsc",
            "eslint": "npm run check:eslint",
            "format": "npm run format",
        },
    },
    "pyproject.toml": {
        "install": "uv sync --dev",
        "checks": {
            "test": "poe -q test",
            "pyright": "poe -q pyright",
        },
    },
    "Cargo.toml": {
        "install": "cargo fetch",
        "checks": {
            "fmt": "cargo fmt",
            "clippy": (
                "cargo clippy --all-features --fix --allow-dirty --allow-staged -- -D warnings"
            ),
            "test": "cargo test --all-features",
        },
    },
}

if __name__ == "__main__":
    root = Path(__file__).parent.parent
    repo_files = (
        check_output(
            "git ls-files --cached --others --exclude-standard",
            shell=True,
            cwd=str(root),
        )
        .decode()
        .splitlines()
    )
    project_files = [
        f
        for f in repo_files
        if any(f.endswith(f"/{end}") for end in PROJECT_FILE_TYPES.keys())
    ]

    if len(argv) > 1:
        dirty_files = argv[1:]
        project_files = [
            p
            for p in project_files
            if any(d.startswith(str(Path(p).parent)) for d in dirty_files)
        ]

    print("-> installing dependencies...")
    handles: dict[str, Popen] = {}
    for proj in project_files:
        proj = Path(proj)
        project_dir = (root / proj).parent
        cmd = PROJECT_FILE_TYPES[proj.name]["install"]
        handle = Popen(
            cmd, cwd=str(project_dir), shell=True, stderr=STDOUT, stdout=PIPE
        )
        handles[str(proj.parent)] = handle
    errors = []
    for name, handle in handles.items():
        returncode = handle.wait()
        if returncode != 0:
            print(f"❌ {name}:install")
            print(handle.stdout)
            errors.append(name)

    if len(errors) != 0:
        print("installing dependencies has failed")
        exit(1)

    print("-> running hooks...")
    processes = {}

    def spawn(key, cmd, project_dir):
        completed = run(
            f"DYLD_LIBRARY_PATH=$TRANSCRIBEE_DYLD_LIBRARY_PATH {cmd}",
            cwd=str(project_dir),
            shell=True,
            stderr=STDOUT,
            stdout=PIPE,
            text=True,
        )
        if completed.returncode == 0:
            print(f"✅ {key}")
        else:
            print(f"❌ {key}:")
            print(indent(completed.stdout, "   "))
            global errors
            errors.append(key)
        processes.pop(key)

    for proj in project_files:
        proj = Path(proj)
        project_dir = (root / proj).parent
        for name, cmd in PROJECT_FILE_TYPES[proj.name]["checks"].items():
            key = f"{proj.parent}:{name}"
            thread = Thread(target=spawn, args=(key, cmd, project_dir))
            thread.start()
            processes[key] = thread

    while len(processes) > 0:
        sleep(0.1)

    if len(errors) > 0:
        print(f"\n{len(errors)} checks have failed: {', '.join(errors)}")
        exit(1)
    else:
        print("all good :)")
