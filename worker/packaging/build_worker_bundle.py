#!/usr/bin/env python3
# build worker release packages for distribution

import argparse
import hashlib
import json
import shutil
import tarfile
import tempfile
import urllib.request
import zipfile
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


def dl(url, file: Path):
    r = urllib.request.Request(url, headers={"User-Agent": ""})
    response = urllib.request.urlopen(r).read()
    file.write_bytes(response)


# merge the contents of the src folder into the dst folder
def merge_into(src: Path, dst: Path):
    if src.is_dir():
        subdir = dst / src.name
        subdir.mkdir(exist_ok=True)
        for child in src.iterdir():
            merge_into(child, subdir)
    else:
        src.rename(dst / src.name)


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
                member = tarfile.data_filter(member, path)
                if member is None:
                    return None
                if "share/terminfo/" in member.name:
                    # we dont care so much about these and extracting them does not work under macos
                    # because it has a case insensitive fs and terminfo ships some symlinks that
                    # point to themselves when case is ignored
                    return None
                return member

            tf.extractall(tmp, filter=filter)
        else:
            raise Exception(f"File has unsupported archive type: {file}")

        # we currently support layouts types of archives:
        # * ones that contain a single binary file (we place this in bin/) and
        # * ones that contain a single toplevel folder that contains a lib/ and bin/ folder
        #   from these take the lib/ and bin/ folders.
        # other file layouts are unsupported at the moment.
        children = list(Path(tmp).iterdir())
        if len(children) == 1 and children[0].is_file():
            bin = target_path / "bin"
            bin.mkdir(exist_ok=True)
            children[0].chmod(0o755)
            children[0].rename(bin / children[0].name)
        elif len(children) == 1 and children[0].is_dir():
            root = children[0]
            for child in root.iterdir():
                if child.name not in ["bin", "lib"]:
                    continue
                merge_into(child, target_path)
        else:
            raise Exception(
                "Unsupported archive layout.Expecting either one toplevel file or one toplevel dir."
            )


def download_native_deps(native_deps_json: Path, platform: str, target: Path):
    deps = json.loads(native_deps_json.read_text())

    dl_folder = Path(__file__).parent / ".native-deps-dl"
    dl_folder.mkdir(exist_ok=True)

    rmtree(target, ignore_errors=True)
    target.mkdir()

    for dep, sources in deps.items():
        urls = sources[platform]
        if isinstance(urls, str):
            urls = [urls]

        for url in urls:
            dl_path = dl_folder / f"{dep}-{platform}-{Path(url).name}"

            if not dl_path.exists():
                print(f"-> Downloading {dep} for {platform} from {url}...")
                dl(url, dl_path)

            extract_native_dep_tar(dl_path, target)
    return target


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

            native_deps_folder = Path(tempdir) / "native_deps"
            rmtree(native_deps_folder, ignore_errors=True)
            download_native_deps(
                Path(__file__).parent / "native_deps.json", platform, native_deps_folder
            )

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
                print("-> packing native deps")
                archive.add(native_deps_folder, "")
            if not force_rebuild:
                source_hash_file.write_text(current_src_digest)

            print("-> done")
