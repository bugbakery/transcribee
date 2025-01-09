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
  workspace = uv2nix.lib.workspace.loadWorkspace { workspaceRoot = ../../backend; };

  overlay = workspace.mkPyprojectOverlay {
    sourcePreference = "wheel";
  };

  pyprojectOverrides = final: prev: {
    psycopg2 = prev.psycopg2.overrideAttrs (old: {
      nativeBuildInputs = old.nativeBuildInputs ++ [
        final.setuptools
        pkgs.postgresql_14
      ];

      buildInputs = (old.buildInputs or []) ++ [
        pkgs.openssl
      ];
    });
  };

  pythonSet =
    (pkgs.callPackage pyproject-nix.build.packages {
      inherit python;
    }).overrideScope
      (
        lib.composeManyExtensions [
          pyproject-build-systems.overlays.default
          overlay
          pyprojectOverrides
        ]
      );

in pythonSet.mkVirtualEnv "transcribee-backend-env" workspace.deps.default
