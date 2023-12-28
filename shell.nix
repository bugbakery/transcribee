let
  # We use a fixed version of nixpkgs here, so we get a recent enough version of
  # pdm (2.4.6 at the time of writing). The version shipped in current (as of 12-03-23)
  # nixpkgs-stable does not support dependencies with relative paths
  pkgs = import
    (fetchTarball {
      name = "nixpkgs-unstable-new-enough-pdm";
      url = "https://github.com/NixOS/nixpkgs/archive/43862987c3cf2554a542c6dd81f5f37435eb1423.tar.gz"; # keep in sync with .github/workflows/lint.yml

    })
    { };
  pdm = pkgs.pdm.overridePythonAttrs (old: rec {
    version = "2.4.9";
    pname = old.pname;
    src = pkgs.fetchPypi {
      inherit pname version;
      sha256 = "28b/sZXzmrJLS8tQf+mXiaYaMhWdi/In8xF7lPMn8vI=";
    };
    doCheck = false;
  });
  ld_packages = [
    pkgs.file
    # for ctranslate2
    pkgs.stdenv.cc.cc.lib
  ];

in
pkgs.mkShell {
  buildInputs = with pkgs; [
    overmind
    pre-commit

    python310
    python310Packages.black
    pdm

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
    postgresql

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
