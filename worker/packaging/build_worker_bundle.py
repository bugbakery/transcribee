#!/usr/bin/env python3
# build worker release packages for distribution

import argparse
import hashlib
import shutil
import tarfile
import tempfile
from io import BytesIO
from os import environ
from pathlib import Path
from shutil import rmtree
from subprocess import check_call, check_output

PLATFORMS = [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-aarch64",
    "linux-x86_64",
    "win-x86_64",
]


def download_python(folder: Path, platform: str, target: Path):
    with tempfile.TemporaryDirectory() as tempdir:
        platform_map = {
            "darwin-aarch64": "macos-aarch64-none",
            "darwin-x86_64": "macos-x86_64-none",
            "linux-aarch64": "linux-aarch64-gnu",
            "linux-x86_64": "linux-x86_64-gnu",
            "win-x86_64": "windows-x86_64-none",
        }

        python_version = None
        with open(folder / ".python-version") as pv_file:
            python_version = pv_file.readline().strip()
        print(f"-> using python version {python_version}")

        python_target = f"cpython-{python_version}-" + platform_map[platform]

        cmd = [
            "uv",
            "python",
            "install",
            "--managed-python",  # do not use system python
            "--no-bin",  # do not add to systems bin directory
            "--install-dir",
            str(tempdir),
            python_target,
        ]
        print("-> running", " ".join(cmd))
        check_call(cmd, cwd=folder)

        # The following lines are more thought-out than you might think. UV behaves a bit weird
        # here. It won't create links for version aliases when downloading python for windows on
        # OSes other than windows. So we might not get a folder (or link) matching the name of our
        # requested target. Nor can we assume to only get one non-symlink installation, since when
        # running on windows the aliases are created but are no symlinks.
        #
        # The naive approach of picking the first installation and resolving the potential symlink
        # works here because we download to a clean directory and all folders living here should be
        # the same installation we just downloaded.
        python_dir = next(Path(tempdir).glob("cpython-*"))
        shutil.move(python_dir.resolve(), target)

        return target


def find_site_packages(python_folder: Path):
    windows_path = python_folder / "Lib" / "site-packages"
    if windows_path.exists():
        return windows_path

    unix_path = next(python_folder.glob("lib/python3.*/site-packages"), None)
    if unix_path is not None:
        return unix_path

    raise Exception(f"Could not find site_packages in {python_folder}")


def install_venv(python_folder: Path, venv_folder):
    print("-> populating site_packages")
    target_site_packages = find_site_packages(python_folder)
    venv_site_packages = find_site_packages(venv_folder)
    shutil.copytree(venv_site_packages, target_site_packages, dirs_exist_ok=True)


def prepare_venv(folder: Path, platform: str, target: Path):
    rmtree(str(target), ignore_errors=True)
    env = {
        **environ,
        "MACOSX_DEPLOYMENT_TARGET": "15.0",
        "UV_NO_EDITABLE": "1",
        "UV_NO_DEV": "1",
        "UV_VENV_RELOCATABLE": "1",
        "UV_PROJECT_ENVIRONMENT": str(target),
        "VIRTUAL_ENV": str(target),
    }
    platform_map = {
        "darwin-aarch64": "aarch64-apple-darwin",
        "darwin-x86_64": "x86_64-apple-darwin",
        "linux-aarch64": "aarch64-unknown-linux-gnu",
        "linux-x86_64": "x86_64-manylinux_2_28",
        "win-x86_64": "x86_64-pc-windows-msvc",
    }
    cmd = ["uv", "sync", "--quiet", "--python-platform", platform_map[platform]]
    print("-> running", " ".join(cmd))
    check_call(cmd, cwd=folder, env=env)
    return target


def hash_tree(path: Path) -> str:
    paths = sorted(
        (
            check_output(
                ["git", "ls-files", "-c", "-o", "--exclude-standard"], cwd=str(path)
            )
            .decode("utf-8")
            .splitlines()
        )
    )
    hash = hashlib.new("sha256")
    for p in paths:
        if Path(p).is_file():
            with open(p, "rb") as f:
                hashlib.file_digest(f, lambda: hash)
    return hash.hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("platform", choices=[*PLATFORMS, "all"])
    parser.add_argument("--force-rebuild", action="store_true")

    args = parser.parse_args()
    force_rebuild = args.force_rebuild
    if args.platform == "all":
        platforms = PLATFORMS
    else:
        platforms = [args.platform]

    worker_dir = Path(__file__).parent.parent

    target = Path(__file__).parent / "build"
    target.mkdir(exist_ok=True)

    for platform in platforms:
        archive_path = target / f"worker-{platform}.tar"
        source_hash_file = target / f".worker-{platform}.tar.src-hash"

        if not force_rebuild:
            current_src_digest = hash_tree(worker_dir)
            if archive_path.exists() and source_hash_file.exists():
                archive_src_digest = source_hash_file.read_text()
                if archive_src_digest == current_src_digest:
                    print(
                        f"worker bundle for {platform} is up-to-date, not building it again"
                    )
                    continue

        print(f"building worker bundle for {platform}")

        with tempfile.TemporaryDirectory() as tempdir:
            venv_folder = Path(tempdir) / "venv"
            rmtree(venv_folder, ignore_errors=True)
            prepare_venv(worker_dir, platform, venv_folder)

            python_folder = Path(tempdir) / "python"
            rmtree(python_folder, ignore_errors=True)
            download_python(worker_dir, platform, python_folder)
            install_venv(python_folder, venv_folder)

            archive_path.unlink(missing_ok=True)
            with tarfile.open(archive_path, "w") as archive:
                info = tarfile.TarInfo(".platform")
                info.size = len(platform.encode("utf-8"))
                archive.addfile(info, BytesIO(platform.encode("utf-8")))

                ext = "bat" if platform.startswith("win-") else "sh"
                archive.add(
                    Path(__file__).parent / f"run_worker.{ext}.tmpl",
                    f"run_worker.{ext}",
                )
                print("-> packing python")
                archive.add(python_folder, "python")
            if not force_rebuild:
                source_hash_file.write_text(current_src_digest)

            print("-> done")
