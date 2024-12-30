{ lib
, pkgs
, python3 ? pkgs.python311
, stdenv
}:
let
  common = import ../common.nix;
  pyprojectInfo = builtins.fromTOML (builtins.readFile ../../backend/pyproject.toml);
  pdmFixedPkgs = (import (builtins.fetchTarball {
    name = "nixos-unstable-with-fixed-pdm";
    url = "https://github.com/nixos/nixpkgs/archive/9482c3b0cffed8365f686c22c83df318b4473a3e.tar.gz";
    sha256 = "05rgyl1i09jzsvhwg3blvac7x9mayj3kqpp55h287qxsimsslh0x";
  }) {});
in
python3.pkgs.buildPythonApplication rec {
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
    pkgs.postgresql
  ];

  propagatedBuildInputs = with pkgs; [
    # for automerge-py
    libiconv
    rustc
    cargo
    maturin

    # provides libmagic
    file

    openssl
  ];

  doCheck = false;

  configurePhase = ''
    cd backend/
  '';

  installPhase = ''
    export PDM_TMP=$(mktemp -d)
    export PDM_CONFIG_FILE=$PDM_TMP/config

    pdm config cache_dir $PDM_TMP/cache
    TERM=dumb pdm install --no-lock --check --prod

    for i in __pypackages__/*/lib/magic/loader.py; do
      substituteInPlace "$i" --replace "find_library('magic')" "'${pkgs.file}/lib/libmagic${stdenv.hostPlatform.extensions.sharedLibrary}'";
    done

    mkdir -p $out
    cp -r * .* $out/
  '';
}
