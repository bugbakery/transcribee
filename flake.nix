{
  description = "transcribee monorepo";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    pyproject-build-systems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.uv2nix.follows = "uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      uv2nix,
      pyproject-nix,
      pyproject-build-systems,
      flake-utils,
      ...
    }:
    (flake-utils.lib.eachDefaultSystem
      (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          lib = nixpkgs.lib;
          python = pkgs.python311;

          ld_packages = [
            pkgs.file # provides libmagic

            # for ctranslate2
            pkgs.stdenv.cc.cc.lib
          ];
        in
        {
          packages = rec {
            worker = (import ./nix/pkgs/worker.nix { inherit pkgs lib python uv2nix pyproject-nix pyproject-build-systems system; });
            backend = (import ./nix/pkgs/backend.nix { inherit pkgs lib python uv2nix pyproject-nix pyproject-build-systems system; });
          };

          devShells.default = pkgs.mkShell {
            packages = [
              python
              pkgs.uv
              python.pkgs.black
              pkgs.poethepoet

              pkgs.overmind
              pkgs.wait4x
              pkgs.pre-commit

              pkgs.nodejs_20

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

              # for automerge-py
              pkgs.libiconv
              pkgs.rustc
              pkgs.cargo

              pkgs.icu.dev
              pkgs.file # libmagic

              # Our database
              pkgs.postgresql_14

              # Our database2 ?
              pkgs.redis
            ];

            shellHook = ''
              unset PYTHONPATH
              export UV_PYTHON_DOWNLOADS=never

              export TRANSCRIBEE_DYLD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath ld_packages}
              export LD_LIBRARY_PATH=$LD_SEARCH_PATH:$TRANSCRIBEE_DYLD_LIBRARY_PATH
            '' + pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
              export CPPFLAGS="-I${pkgs.libcxx.dev}/include/c++/v1"
              # `dyld` needs to find the libraries
              export DYLD_LIBRARY_PATH=$LD_LIBRARY_PATH:$DYLD_LIBRARY_PATH
            '';
          };
        }
      )) // {
        lib = {
          # the frontend uses a fixed output hash for its npm dependencies
          # maybe we can get rid of the hash in the future by using a tool like dream2nix or use importNpmLock
          # but this seems to be a bit more complicated since we use git dependencies
          buildFrontendPackage = { system, npmDepsHash, versionInfo ? { } }:
            let
              pkgs = nixpkgs.legacyPackages.${system};
              lib = nixpkgs.lib;
            in
            (import ./nix/pkgs/frontend.nix { inherit pkgs lib system npmDepsHash versionInfo; });
        };
      };
}
