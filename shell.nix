let
  # We use a fixed version of nixpkgs here, so we get a recent enough version of
  # pdm (2.4.6 at the time of writing). The version shipped in current (as of 12-03-23)
  # nixpkgs-stable does not support dependencies with relative paths
  pkgs = import
    (fetchTarball {
      name = "nixpkgs-unstable-new-enough-pdm";
      url = "https://github.com/NixOS/nixpkgs/archive/43862987c3cf2554a542c6dd81f5f37435eb1423.tar.gz";
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

in
pkgs.mkShell {
  buildInputs = with pkgs; [
    overmind
    pre-commit

    python310
    python310Packages.black
    pdm

    nodePackages.pnpm

    # required by whispercppy
    cmake

    # required by pre-commit
    git

    # required by librosa to open audio files
    ffmpeg

    # for automerge-py
    libiconv
    rustc
    cargo
  ] ++

  # accelerates whisper.cpp on M{1,2} Macs
  (if !stdenv.isDarwin then [ ] else [
    darwin.apple_sdk.frameworks.Accelerate
  ]);

  # use the system bazel (necessary on NixOS and Guix, as the downloaded bazel binary cannot run on these)
  shellHook = ''
    export DISABLE_BAZEL_WRAPPER=1
  '' + (
    pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
      # Use accellerate framework on darwin
      export BAZEL_LINKOPTS="-F ${pkgs.darwin.apple_sdk.frameworks.Accelerate}/Library/Frameworks"
    ''
  );

}
