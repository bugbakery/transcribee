#!/usr/bin/env python3
import os
from download_native_deps import download_native_deps

platform = os.environ["TAURI_ENV_PLATFORM"]
arch = os.environ["TAURI_ENV_ARCH"]

download_native_deps([f"{platform}-{arch}"])
