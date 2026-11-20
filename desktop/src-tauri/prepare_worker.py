#!/usr/bin/env python3
import os
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from subprocess import check_call, check_output

if __name__ == "__main__":
    platform = os.environ["CARGO_CFG_TARGET_OS"]
    if platform == "macos":
        platform = "darwin"
    elif platform == "windows":
        platform = "win"

    arch = os.environ["CARGO_CFG_TARGET_ARCH"]
    target = f"{platform}-{arch}"

    worker_dir = Path(__file__).parent.parent.parent / "worker" / "packaging"
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
        tar.extractall(worker_target_dir, filter="tar")

    # sign the contents of the worker directory if APPLE_SIGNING_IDENTITY is set
    if "APPLE_SIGNING_IDENTITY" in os.environ:
        files = check_output(
            "find worker -type f -perm +0111 -o -name '*.dylib' -not \\( -name '*.py' \\)",
            shell=True,
            encoding="utf-8",
        )
        executor = ThreadPoolExecutor(max_workers=100)

        def sign(file):
            remove_return = check_call(f"codesign --remove-signature {file}", shell=True)
            if remove_return == 0:
                sign_return = check_call(
                    f"codesign -s {os.environ['APPLE_SIGNING_IDENTITY']} --options=runtime {file}",
                    shell=True,
                )
                if sign_return:
                    print(f"failed to sign {file}")
            else:
                print(f"could not remove signature from {file}")

        futures = [executor.submit(sign, file) for file in files.splitlines()]

    worker_platform_file.touch()
