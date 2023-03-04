{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    pre-commit

    python310
    python310Packages.black
    pdm

    nodePackages.pnpm

  ] ++

  # we need these to build whisper-cpp (+ python bindings)
  [
    stdenv
  ] ++ (if !stdenv.isDarwin then [ ] else [
    darwin.apple_sdk.frameworks.Accelerate
  ]);

  shellHook = ''
    export CFLAGS="-I ${pkgs.libcxx.dev}/include/c++/v1 -I${pkgs.openfst}/include $CFLAGS"
    export LDFLAGS="-L${pkgs.openfst}/lib $LDFLAGS"
  '';
}
