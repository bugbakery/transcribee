{ pkgs, stdenv }:
let
  common = import ../common.nix;
in
stdenv.mkDerivation {
  pname = "${common.name}-frontend";
  version = common.version;
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
