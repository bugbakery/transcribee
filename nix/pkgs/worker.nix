{
  pkgs,
  lib,
  python,
  uv2nix,
  pyproject-nix,
  pyproject-build-systems,
  system,
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

    pyicu = prev.pyicu.overrideAttrs (old: {
      nativeBuildInputs = old.nativeBuildInputs ++ [
        pkgs.icu.dev
        (final.resolveBuildSystem {})
      ];
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

in pythonSet.mkVirtualEnv "transcribee-worker-env" workspace.deps.default
