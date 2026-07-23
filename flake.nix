{
  description = "transcribee monorepo";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      self,
      ...
    }:
    let
      pythonPkgName = "python312";
    in
    (flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        python = pkgs."${pythonPkgName}";

        ld_packages = [
          pkgs.file # provides libmagic

          # for ctranslate2
          pkgs.stdenv.cc.cc.lib
        ];
      in
      {
        formatter = pkgs.nixfmt-rfc-style;

        devShells.default = pkgs.mkShell {
          packages = [
            python
            pkgs.uv
            python.pkgs.black
            pkgs.poethepoet

            pkgs.overmind
            pkgs.wait4x
            pkgs.pre-commit

            # keep in sync with gh actions workflows
            pkgs.nodejs_24

            # nix tooling
            pkgs.nixpkgs-fmt

            # required by whispercppy
            pkgs.cmake

            # required by pre-commit
            pkgs.git
            pkgs.ruff

            # required by psycopg2
            pkgs.openssl

            pkgs.ffmpeg
            pkgs.file

            # for automerge-py
            pkgs.libiconv
            pkgs.rustc
            pkgs.cargo

            # Our database
            pkgs.postgresql_18
            pkgs.postgresql_18.pg_config

            # Our database2 ?
            pkgs.redis

            pkgs.glibcLocales
          ];

          RUST_SRC_PATH = "${pkgs.rust.packages.stable.rustPlatform.rustLibSrc}";

          shellHook =
            ''
              unset PYTHONPATH
              export UV_PYTHON_DOWNLOADS=never

              export TRANSCRIBEE_DYLD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath ld_packages}
              export LD_LIBRARY_PATH=$LD_SEARCH_PATH:$TRANSCRIBEE_DYLD_LIBRARY_PATH
            ''
            + pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
              export CPPFLAGS="-I${pkgs.libcxx.dev}/include/c++/v1"
              # `dyld` needs to find the libraries
              export DYLD_LIBRARY_PATH=$LD_LIBRARY_PATH:$DYLD_LIBRARY_PATH
            '';
        };
      }
    ));
}
