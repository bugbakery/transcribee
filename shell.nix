{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    pre-commit

    python310
    python310Packages.black
    pdm

    nodePackages.pnpm

    # required by whispercpp
    bazel_6

    # required by pre-commit
    git

    # required by librosa to open audio files
    ffmpeg
  ] ++

  # accelerates whisper.cpp on M{1,2} Macs
  (if !stdenv.isDarwin then [ ] else [
    darwin.apple_sdk.frameworks.Accelerate
  ]);

  # use the system bazel (necessary on NixOS and Guix, as the downloaded bazel binary cannot run on these)
  shellHook = ''
    export DISABLE_BAZEL_WRAPPER=1
  '';
}
