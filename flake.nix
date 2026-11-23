{
  description = "transcribee monorepo";

  inputs = {
    nixpkgs.url = "https://channels.nixos.org/nixos-unstable/nixexprs.tar.zst";
    flake-utils.url = "github:numtide/flake-utils";
    nixgl = {
      url = "github:nix-community/nixGL";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      nixgl,
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
          overlays = [ nixgl.overlay ];
        };
        python = pkgs."${pythonPkgName}";

        ld_packages = [
          pkgs.file # provides libmagic

          # for ctranslate2
          pkgs.stdenv.cc.cc.lib

          # for openvino NPU
          pkgs.intel-compute-runtime
          pkgs.level-zero
          pkgs.intel-npu-driver
        ];
      in
      {
        formatter = pkgs.nixfmt-rfc-style;

        devShells.default = pkgs.mkShellNoCC {
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
            pkgs.clippy

            # Our database
            pkgs.postgresql_18
            pkgs.postgresql_18.pg_config

            # Our database2 ?
            pkgs.redis

            pkgs.glibcLocales

            # new rust worker
            pkgs.bzip2
            pkgs.lame
            pkgs.libz
            pkgs.onnxruntime
            pkgs.intel-compute-runtime
            pkgs.intel-npu-driver
            pkgs.intel-gmmlib
            pkgs.gcc
            pkgs.nasm
            pkgs.libclang
          ] ++ pkgs.lib.optionals (!pkgs.stdenv.isDarwin) [
            # required by desktop
            pkgs.libsoup_3
            pkgs.webkitgtk_4_1
            pkgs.pkg-config
            pkgs.gst_all_1.gstreamer
            pkgs.gst_all_1.gst-plugins-base
            pkgs.gst_all_1.gst-plugins-good
            pkgs.gst_all_1.gst-plugins-bad
          ];

          RUST_SRC_PATH = "${pkgs.rust.packages.stable.rustPlatform.rustLibSrc}";

          shellHook =
            ''
              unset PYTHONPATH
              export UV_PYTHON_DOWNLOADS=never

              export TRANSCRIBEE_DYLD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath ld_packages}
              export LD_LIBRARY_PATH=$LD_SEARCH_PATH:$TRANSCRIBEE_DYLD_LIBRARY_PATH
              export LIBCLANG_PATH=${pkgs.libclang.lib}/lib
            ''
            + pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
              export CPPFLAGS="-I${pkgs.libcxx.dev}/include/c++/v1"
              # `dyld` needs to find the libraries
              export DYLD_LIBRARY_PATH=$LD_LIBRARY_PATH:$DYLD_LIBRARY_PATH

              # use external xcode
              export SDK_ROOT=/Applications/Xcode.app/Contents/Developer

              # macOS 11 is the first macOS that supports arm, thus we target that
              export CXXFLAGS="-mmacosx-version-min=14.0"
              export MACOSX_DEPLOYMENT_TARGET=14.0
            ''
            + pkgs.lib.optionalString pkgs.stdenv.isLinux ''
              # setup nix mesa on non-nixos env variables
              # wrap in a function, to make the $@ that niGLIntel
              # passes to exec empty
              _doit () {
                  source ${pkgs.nixgl.nixGLIntel}/bin/nixGLIntel
              }
              _doit
              export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
              export GST_PLUGIN_SYSTEM_PATH_1_0="${pkgs.gst_all_1.gst-plugins-base}/lib/gstreamer-1.0/:${pkgs.gst_all_1.gst-plugins-good}/lib/gstreamer-1.0/:${pkgs.gst_all_1.gst-plugins-bad}/lib/gstreamer-1.0/:${pkgs.gst_all_1.gstreamer.out}/lib/gstreamer-1.0/"
              export ORT_DYLIB_PATH="${pkgs.onnxruntime}/lib/libonnxruntime.so"
              export OCL_ICD_VENDORS="${pkgs.intel-compute-runtime}/etc/OpenCL/vendors"
            '';
        };
      }
    ));
}
