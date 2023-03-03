{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    python310
    pdm

    nodePackages.pnpm
  ];
}
