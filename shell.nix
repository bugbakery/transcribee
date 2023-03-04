{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    pre-commit

    python310
    pdm

    nodePackages.pnpm
  ];
}
