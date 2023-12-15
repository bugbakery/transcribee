{ pkgs, stdenv }:
let
  common = import ../common.nix;
  package = builtins.fromJSON (builtins.readFile ../../frontend/package.json);
in
stdenv.mkDerivation {
  pname = package.name;
  version = package.version;
  src = ../..;

  nativeBuildInputs = [
    pkgs.nodePackages.pnpm
  ];

  configurePhase = ''
    cd frontend/
  '';

  installPhase = ''
    pnpm install --frozen-lockfile
    pnpm build

    mkdir -p $out
    cp -r dist/* dist/.* $out/
  '';
}
