{pkgs ? import <nixpkgs> {}}:
let
  pkgs = (import (builtins.fetchTarball {
    name = "nixos-unstable-with-fixed-pdm";
    url = "https://github.com/nixos/nixpkgs/archive/9482c3b0cffed8365f686c22c83df318b4473a3e.tar.gz";
    sha256 = "05rgyl1i09jzsvhwg3blvac7x9mayj3kqpp55h287qxsimsslh0x";
  }) {});
  ld_packages = [
    pkgs.file
    # for ctranslate2
    pkgs.stdenv.cc.cc.lib
  ];
  ourPython = pkgs.python311;

in
pkgs.mkShell {
  buildInputs = with pkgs; [
    overmind
    wait4x
    (pre-commit.override { python3Packages = ourPython.pkgs; })

    ourPython
    ourPython.pkgs.black
    (pdm.override { python3 = ourPython; })

    nodejs_20
    nodePackages.pnpm

    # nix tooling
    nixpkgs-fmt

    # required by whispercppy
    cmake

    # required by pre-commit
    git
    ourPython.pkgs.ruff

    ffmpeg

    # for automerge-py
    libiconv
    rustc
    cargo
    (maturin.override { python3 = ourPython; })

    # provides libmagic which is needed by python-magic in the worker
    file

    icu.dev

    # Our database
    postgresql_14

    # Our database2 ?
    redis

    openssl # needed for psycopg2
  ] ++

  # accelerates whisper.cpp on M{1,2} Macs
  (lib.optional stdenv.isDarwin darwin.apple_sdk.frameworks.Accelerate);

  # we need this hack to be able to build native python packages
  shellHook = ''
    # Some libraries are not found if not added directly to LD_LIBRARY_PATH / DYLD_LIBRARY_PATH (on darwin)
    # However just adding them there is not enough, because macOS purges the DYLD_* variables in some conditions
    # This means we have to set them again in some script (e.g. ./start_backend.sh) -> we need a "safe" env var to pass them to the script
    export TRANSCRIBEE_DYLD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath ld_packages}
    export LD_LIBRARY_PATH=$LD_SEARCH_PATH:$TRANSCRIBEE_DYLD_LIBRARY_PATH
  '' + pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
    export CPPFLAGS="-I${pkgs.libcxx.dev}/include/c++/v1"
    # `dyld` needs to find the libraries
    export DYLD_LIBRARY_PATH=$LD_LIBRARY_PATH:$DYLD_LIBRARY_PATH
  '';
}
