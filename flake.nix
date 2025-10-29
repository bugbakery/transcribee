{
  description = "transcribee monorepo";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";

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
      self,
      ...
    }:
    let
      pythonPkgName = "python311";
    in
    {
      overlays.default = (
        final: prev:
        let
          pkgs = import nixpkgs {
            system = final.system;
          };
          lib = nixpkgs.lib;
          python = pkgs."${pythonPkgName}";
        in
        {
          transcribee-worker = import ./nix/pkgs/worker.nix {
            inherit
              pkgs
              lib
              python
              uv2nix
              pyproject-nix
              pyproject-build-systems
              ;
          };

          transcribee-backend = import ./nix/pkgs/backend.nix {
            inherit
              pkgs
              lib
              python
              uv2nix
              pyproject-nix
              pyproject-build-systems
              ;
          };

          transcribee-frontend = import ./nix/pkgs/frontend.nix {
            inherit pkgs lib;

            versionInfo = {
              commitHash = if (self ? rev) then self.rev else self.dirtyRev;
              commitDate = self.lastModified;
            };
          };
        }
      );

      nixosModules.default = {
        nixpkgs.overlays = [ self.overlays.default ];
      };
    }
    // (flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ self.overlays.default ];
        };
        python = pkgs."${pythonPkgName}";

        ld_packages = [
          pkgs.file # provides libmagic

          # for ctranslate2
          pkgs.stdenv.cc.cc.lib
        ];
      in
      {
        packages = {
          backend = pkgs.transcribee-backend;
          worker = pkgs.transcribee-worker;
          frontend = pkgs.transcribee-frontend;
        };

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
            pkgs.file

            # for automerge-py
            pkgs.libiconv
            pkgs.rustc
            pkgs.cargo

            pkgs.icu.dev

            # Our database
            pkgs.postgresql_14

            # Our database2 ?
            pkgs.redis

            pkgs.glibcLocales
          ];

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
