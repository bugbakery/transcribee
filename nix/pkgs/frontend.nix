{
  pkgs,
  lib,
  system,
  versionInfo ? { },
  npmDepsHash,
  ...
}:
pkgs.buildNpmPackage rec {
  inherit npmDepsHash;

  pname = "transcribee-frontend";
  version = "0.1.0";

  src = ../../frontend;

  buildInputs = [
    pkgs.vips
  ];

  nativeBuildInputs = [
    pkgs.git
    pkgs.openssh
  ];

  forceGitDeps = true;
  makeCacheWritable = true;

  buildPhase =
    let
      versionExports = ([ ]
        ++ (lib.optional (versionInfo ? "commitHash") "export COMMIT_HASH=\"${versionInfo.commitHash}\"")
        ++ (lib.optional (versionInfo ? "commitDate") "export COMMIT_DATE=\"${versionInfo.commitDate}\"")
        ++ (lib.optional (versionInfo ? "commitUrl") "export COMMIT_URL=\"${versionInfo.commitUrl}\"")
      );
    in
    ''
      runHook preBuild

      ${lib.concatStringsSep "\n" versionExports}
      npm run build

      runHook postBuild
    '';

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';
}
