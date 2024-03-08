{pkgs ? import <nixpkgs> {}}:
let
  pkgs = import
    (fetchTarball {
      name = "nixpkgs-stable-2024-03-08";
      url = "https://github.com/NixOS/nixpkgs/archive/880992dcc006a5e00dd0591446fdf723e6a51a64.tar.gz"; # keep in sync with .github/workflows/lint.yml
    })
    { };
  ld_packages = [
    pkgs.file
    # for ctranslate2
    pkgs.stdenv.cc.cc.lib
  ];

in
pkgs.mkShell {
  buildInputs = with pkgs; [
    overmind
    wait4x
    pre-commit

    python310
    python310Packages.black
    pdm

    nodejs_20
    nodePackages.pnpm

    # nix tooling
    nixpkgs-fmt

    # required by whispercppy
    cmake

    # required by pre-commit
    git
    ruff

    ffmpeg

    # for automerge-py
    libiconv
    rustc
    cargo
    maturin

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
