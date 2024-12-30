{ pkgs, lib, ... }:
with lib;
let
  python3Packages = pkgs.python312.pkgs;
  pyprojectInfo = builtins.fromTOML (builtins.readFile ../../worker/pyproject.toml);
  pdmFixedPkgs = (import (builtins.fetchTarball {
    name = "nixos-unstable-with-fixed-pdm";
    url = "https://github.com/nixos/nixpkgs/archive/9482c3b0cffed8365f686c22c83df318b4473a3e.tar.gz";
    sha256 = "05rgyl1i09jzsvhwg3blvac7x9mayj3kqpp55h287qxsimsslh0x";
  }) {});
in
python3Packages.buildPythonApplication rec {
  pname = pyprojectInfo.project.name;
  version = pyprojectInfo.project.version;
  src = ../..;

  pyproject = true;

  # expose this because we want to use the same version when using `pdm run` externally to run this package
  pdm = pdmFixedPkgs.pdm;

  nativeBuildInputs = [
    pdmFixedPkgs.pdm
    pdmFixedPkgs.python3.pkgs.pdm-pep517
    pkgs.git
    pkgs.cacert
    pkgs.maturin
    pkgs.cargo
    pkgs.rustc
    pkgs.ffmpeg
    pkgs.pkg-config
    pkgs.icu
    pkgs.icu.dev
  ];

  buildInputs = with pkgs;[
    libiconv

    # for automerge-py
    rustc
    cargo
    maturin
    clangStdenv

    icu.dev

    # provides libmagic
    file
  ] ++
  # accelerates whisper.cpp on M{1,2} Macs
  (lib.optional stdenv.isDarwin darwin.apple_sdk.frameworks.Accelerate);


  propagatedBuildInputs = with pkgs;
    [
      ffmpeg
    ];


  doCheck = false;
  dontCheckRuntimeDeps = true;

  configurePhase = ''
    cd worker/
  '';

  installPhase = pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
    export PYICU_CFLAGS="-I${pkgs.libcxx.dev}/include/c++/v1"
  ''
  + ''
    export PDM_TMP=$(mktemp -d)
    export PDM_CONFIG_FILE=$PDM_TMP/config
    export CARGO_HOME=$(mktemp -d)

    pdm config cache_dir $PDM_TMP/cache
    TERM=dumb pdm install --no-lock --check --prod

    mkdir -p $out
    cp -r * .* $out/
  '';
}
