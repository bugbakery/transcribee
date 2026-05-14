#!/usr/bin/env python3

from sys import argv
from pathlib import Path
import json
import tarfile
import urllib.request
import zipfile
import tempfile


def _dl(url, file: Path):
    r = urllib.request.Request(url, headers={'User-Agent': ''})
    response = urllib.request.urlopen(r).read()
    file.write_bytes(response)


def _extract_relevant(file: Path, target_path: Path):
    print(f"extracting {file}")
    with tempfile.TemporaryDirectory() as tmp:
        if zipfile.is_zipfile(file):
            zf = zipfile.ZipFile(file)
            zf.extractall(tmp)
        elif tarfile.is_tarfile(file):
            tf = tarfile.open(file)
            # handle macos still having a case insensitive fs in 2026
            def filter(member: tarfile.TarInfo, path: str, /) -> tarfile.TarInfo | None:
                target = (Path(tmp) / member.name)
                if target.exists(follow_symlinks=False):
                    if member.issym():
                        return None
                    else:
                        target.unlink()
                return member
            tf.extractall(tmp, filter=filter)
        else:
            raise Exception(f"File has unsupported archive type: {file}")

        children = list(Path(tmp).glob("*"))
        if len(children) == 1 and children[0].is_file():
            bin = target_path / "bin"
            bin.mkdir(exist_ok=True)
            children[0].chmod(0o755)
            children[0].rename(bin / children[0].name)
        else:
            def move_into(src: Path, dst: Path):
                if src.is_dir():
                    subdir = (dst / src.name)
                    subdir.mkdir(exist_ok=True)
                    for child in src.iterdir():
                        move_into(child, subdir)
                else:
                    src.rename(dst / src.name)

            root = children[0]
            for child in root.iterdir():
                if child.name not in ["bin", "lib"]:
                    continue
                move_into(child, target_path)

def download_native_deps(platforms: list[str]):
    parent_dir = Path(__file__).parent

    deps = json.loads((parent_dir / "native-deps.json").read_text())

    deps_folder = parent_dir / "native-deps"
    deps_folder.mkdir(exist_ok=True)

    dl_folder = parent_dir / ".native-deps-dl"
    dl_folder.mkdir(exist_ok=True)

    for platform in platforms:
        for dep, sources in deps.items():
            urls = sources[platform]
            if isinstance(urls, str):
                urls = [urls]

            for url in urls:
                dl_path = dl_folder / f"{dep}-{platform}-{Path(url).name}"

                if not dl_path.exists():
                    print(f"Downloading {dep} for {platform} from {url}...")
                    _dl(url, dl_path)

                _extract_relevant(dl_path, deps_folder)


if __name__ == "__main__":
    if len(argv) != 2:
        print(f"usage: {argv[0]} <PLATFORM> / all")
        exit(-1)

    platforms = ["darwin-aarch64", "darwin-x86_64", "linux-aarch64", "linux-x86_64", "win-aarch64", "win-x86_64"]
    if argv[1] == "all":
        pass
    else:
        assert argv[1] in platforms
        platforms = [argv[1]]

    download_native_deps(platforms)
