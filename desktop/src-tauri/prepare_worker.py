#!/usr/bin/env python3
import os
import tarfile
from pathlib import Path
from subprocess import check_call

if __name__ == "__main__":
    platform = os.environ["TAURI_ENV_PLATFORM"]
    arch = os.environ["TAURI_ENV_ARCH"]
    target = f"{platform}-{arch}"

    worker_dir = Path(__file__).parent.parent.parent / "worker"
    check_call(["python", "build_worker_bundle.py", target], cwd=worker_dir)
    worker_tar = worker_dir / "build" / f"worker-{target}.tar"

    worker_target_dir = Path(__file__).parent / "worker"
    worker_platform_file = worker_target_dir / ".platform"

    if (
        worker_platform_file.exists()
        and worker_platform_file.stat().st_mtime > worker_tar.stat().st_mtime
        and worker_platform_file.read_text() == target
    ):
        print("worker is already up to date. not extracting again.")
        exit(0)

    print("extracting worker...")
    with tarfile.open(worker_tar) as tar:
        tar.extractall(worker_target_dir, filter="data")

    worker_platform_file.touch()
