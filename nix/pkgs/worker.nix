{
  pkgs,
  lib,
  python,
  uv2nix,
  pyproject-nix,
  pyproject-build-systems,
  ...
}:
let
  workspace = uv2nix.lib.workspace.loadWorkspace { workspaceRoot = ../../worker; };

  overlay = workspace.mkPyprojectOverlay {
    sourcePreference = "wheel";
  };

  pyprojectOverrides = final: prev: {
    automerge = prev.automerge.overrideAttrs (old: {
      nativeBuildInputs = old.nativeBuildInputs ++ [
        pkgs.rustPlatform.cargoSetupHook
        pkgs.rustPlatform.maturinBuildHook
      ];

      cargoDeps = pkgs.rustPlatform.importCargoLock {
        lockFile = "${old.src}/Cargo.lock";
      };
    });

    torchaudio = prev.torchaudio.overrideAttrs (old: {
      autoPatchelfIgnoreMissingDeps = true;
      preFixup = pkgs.lib.optionals (!pkgs.stdenv.isDarwin) ''
        addAutoPatchelfSearchPath "${final.torch}/${final.python.sitePackages}/torch/lib"
      '';
    });

    pyicu = prev.pyicu.overrideAttrs (old: {
      nativeBuildInputs = old.nativeBuildInputs ++ [
        pkgs.icu.dev
        (final.resolveBuildSystem { })
      ];
    });

    "decent-whisper" = prev."decent-whisper".overrideAttrs (old: {
      nativeBuildInputs = old.nativeBuildInputs ++ [
        (final.resolveBuildSystem { })
      ];
    });

    "mlx" = prev."mlx".overrideAttrs (old: {
      nativeBuildInputs = old.nativeBuildInputs ++ [
        (final.resolveBuildSystem { })
      ];
      preFixup = pkgs.lib.optionals (pkgs.stdenv.isDarwin) ''
        install_name_tool -change \
            @rpath/libmlx.dylib \
            "${final."mlx-metal"}/${final.python.sitePackages}/mlx/lib/libmlx.dylib" \
            "$out/${final.python.sitePackages}/mlx/core.cpython-311-darwin.so"
      '';
    });
  };

  pythonSet =
    (pkgs.callPackage pyproject-nix.build.packages {
      inherit python;
      stdenv = pkgs.stdenv.override {
        targetPlatform = pkgs.stdenv.targetPlatform // {
          darwinSdkVersion = "13.0";
        };
      };
    }).overrideScope
      (
        lib.composeManyExtensions [
          pyproject-build-systems.overlays.default
          overlay
          pyprojectOverrides
        ]
      );

in
pythonSet.mkVirtualEnv "transcribee-worker-env" workspace.deps.default
