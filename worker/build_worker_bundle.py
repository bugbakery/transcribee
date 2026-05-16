#!/usr/bin/env python3
# build worker release packages for distribution

import json
import tarfile
import tempfile
import urllib.request
import zipfile
from io import BytesIO
from os import environ
from pathlib import Path
from shutil import rmtree
from subprocess import check_call, check_output
from sys import argv

PLATFORMS = [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-aarch64",
    "linux-x86_64",
    "win-x86_64",
]


def dl(url, file: Path):
    r = urllib.request.Request(url, headers={"User-Agent": ""})
    response = urllib.request.urlopen(r).read()
    file.write_bytes(response)


def extract_native_dep_tar(file: Path, target_path: Path):
    print(f"-> extracting {file}")
    with tempfile.TemporaryDirectory() as tmp:
        if zipfile.is_zipfile(file):
            zf = zipfile.ZipFile(file)
            zf.extractall(tmp)
        elif tarfile.is_tarfile(file):
            tf = tarfile.open(file)

            # handle macos still having a case insensitive fs in 2026
            # (python ships some file in lowercase and a symlink in upper case)
            def filter(member: tarfile.TarInfo, path: str, /) -> tarfile.TarInfo | None:
                target = Path(tmp) / member.name
                if target.exists(follow_symlinks=False):
                    if member.issym():
                        return None
                    else:
                        target.unlink()
                return member

            tf.extractall(tmp, filter=filter)
        else:
            raise Exception(f"File has unsupported archive type: {file}")

        children = list(Path(tmp).iterdir())
        if len(children) == 1 and children[0].is_file():
            bin = target_path / "bin"
            bin.mkdir(exist_ok=True)
            children[0].chmod(0o755)
            children[0].rename(bin / children[0].name)
        elif len(children) == 1 and children[0].is_dir():

            def merge_into(src: Path, dst: Path):
                if src.is_dir():
                    subdir = dst / src.name
                    subdir.mkdir(exist_ok=True)
                    for child in src.iterdir():
                        merge_into(child, subdir)
                else:
                    src.rename(dst / src.name)

            root = children[0]
            for child in root.iterdir():
                if child.name not in ["bin", "lib"]:
                    continue
                merge_into(child, target_path)

        else:
            raise Exception(
                "Unsupported archive structure."
                "Expecting either one toplevel file or one toplevel dir."
            )


def download_native_deps(parent_dir: Path, platform: str):
    deps = json.loads((parent_dir / "native-deps.json").read_text())

    dl_folder = parent_dir / ".native-deps-dl"
    dl_folder.mkdir(exist_ok=True)

    deps_folder = parent_dir / "native-deps"
    rmtree(str(deps_folder), ignore_errors=True)
    deps_folder.mkdir()

    for dep, sources in deps.items():
        urls = sources[platform]
        if isinstance(urls, str):
            urls = [urls]

        for url in urls:
            dl_path = dl_folder / f"{dep}-{platform}-{Path(url).name}"

            if not dl_path.exists():
                print(f"-> Downloading {dep} for {platform} from {url}...")
                dl(url, dl_path)

            extract_native_dep_tar(dl_path, deps_folder)
    return deps_folder


def prepare_venv(folder: Path, platform: str):
    venv_folder = folder / ".venv"

    rmtree(str(venv_folder), ignore_errors=True)
    env = {
        **environ,
        "MACOSX_DEPLOYMENT_TARGET": "15.0",
        "UV_NO_EDITABLE": "1",
        "UV_NO_DEV": "1",
        "UV_VENV_RELOCATABLE": "1",
    }
    plotform_map = {
        "darwin-aarch64": "aarch64-apple-darwin",
        "darwin-x86_64": "x86_64-apple-darwin",
        "linux-aarch64": "aarch64-unknown-linux-gnu",
        "linux-x86_64": "x86_64-manylinux_2_28",
        "win-x86_64": "x86_64-pc-windows-msvc",
    }
    cmd = ["uv", "sync", "--quiet", "--python-platform", plotform_map[platform]]
    print("-> running", " ".join(cmd))
    check_call(cmd, cwd=folder, env=env)
    return venv_folder


def newest_mtime(path: Path, *, git):
    newest = 0
    if git:
        paths = (
            check_output(
                ["git", "ls-files", "-c", "-o", "--exclude-standard"], cwd=str(path)
            )
            .decode("utf-8")
            .splitlines()
        )
        for p in paths:
            if not Path(p).exists():
                continue
            newest = max(newest, Path(p).stat().st_mtime)
    else:
        if path.is_file():
            newest = max(newest, path.stat().st_mtime)
        elif path.is_dir():
            for f in path.iterdir():
                newest = max(newest, newest_mtime(f, git=False))
    return newest


if __name__ == "__main__":
    if len(argv) != 2:
        print(f"usage: {argv[0]} <PLATFORM> / all")
        exit(-1)

    if argv[1] == "all":
        platforms = PLATFORMS
    else:
        assert (
            argv[1] in PLATFORMS
        ), f"platform {argv[1]} is invalid. possible platforms are {','.join(PLATFORMS)} and all"
        platforms = [argv[1]]

    worker_dir = Path(__file__).parent

    target = worker_dir / "build"
    target.mkdir(exist_ok=True)

    for platform in platforms:
        archive_path = target / f"worker-{platform}.tar"

        archive_mtime = newest_mtime(archive_path, git=False)
        source_mtime = newest_mtime(worker_dir, git=True)
        if archive_mtime > source_mtime:
            print(f"worker bundle for {platform} is up-to-date, not building it again")
            continue

        print(f"building worker bundle for {platform}")

        venv_folder = prepare_venv(worker_dir, platform)
        native_deps_folder = download_native_deps(worker_dir, platform)

        archive_path.unlink(missing_ok=True)
        with tarfile.open(archive_path, "w") as archive:
            info = tarfile.TarInfo(".platform")
            info.size = len(platform.encode("utf-8"))
            archive.addfile(info, BytesIO(platform.encode("utf-8")))

            if platform.startswith("win-"):
                info = tarfile.TarInfo("run_worker.bat")
                text = "pushd %~dp0\n"
                text += "bin\\python -m 'transcribee_worker.run' %*\n"
                info.size = len(text.encode("utf-8"))
                archive.addfile(info, BytesIO(text.encode("utf-8")))
            else:
                info = tarfile.TarInfo("run_worker.sh")
                info.mode = 0o755
                text = "#!/bin/sh\n"
                text += "set -e\n"
                text += 'cd "$(dirname "$(realpath -- "$0")")"\n'
                text += "bin/python -m transcribee_worker.run $*\n"
                info.size = len(text.encode("utf-8"))
                archive.addfile(info, BytesIO(text.encode("utf-8")))
            print("-> packing venv")
            archive.add(venv_folder / "lib", "lib")
            print("-> packing native deps")
            archive.add(native_deps_folder, "")
        print("-> done\n")

    check_call(["uv", "sync", "--quiet"], cwd=worker_dir)
