{ config, pkgs, lib, ... }:
with lib;
let
  python3Packages = pkgs.python3.pkgs;
  pyproject = builtins.fromTOML (builtins.readFile ../../worker/pyproject.toml);
in
python3Packages.buildPythonApplication rec {
  pname = pyproject.project.name;
  version = pyproject.project.version;
  src = ../..;

  format = "pyproject";

  nativeBuildInputs = [
    pkgs.pdm
    python3Packages.pdm-pep517
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

  configurePhase = ''
    cd worker/
  '';

  installPhase = pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
    export PYICU_CFLAGS="-I${pkgs.libcxx.dev}/include/c++/v1"
  ''
  + ''
    export PDM_TMP=$(mktemp -d)
    export PDM_CONFIG_FILE=$PDM_TMP/config

    pdm config cache_dir $PDM_TMP/cache
    TERM=dumb pdm install --no-lock --check --prod

    mkdir -p $out
    cp -r * .* $out/
  '';
}
