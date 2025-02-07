{
  pkgs,
  lib,
  versionInfo,
  packageLockUtils ? import ../../nix/package-lock-utils.nix { inherit lib; },
  ...
}:
pkgs.buildNpmPackage (
  lib.fix (self: {
    pname = "transcribee-frontend";
    version = "0.1.0";
    src = ../../frontend;

    nativeBuildInputs = [ pkgs.git ];

    npmDeps = pkgs.importNpmLock {
      npmRoot = self.src;
      packageSourceOverrides =
        let
          packageLock = lib.importJSON (self.src + "/package-lock.json");
          gitDeps = lib.attrsets.filterAttrs packageLockUtils.isGitDependency packageLock.packages;
        in
        lib.attrsets.mapAttrs (
          name: pkgInfo:
          let
            src = packageLockUtils.fetchGitDependency pkgInfo;
            pname = lib.removePrefix "node_modules/" name;
            thePkg = pkgs.buildNpmPackage {
              inherit src pname;
              version = pkgInfo.version;
              npmDeps = pkgs.importNpmLock { npmRoot = src; };
              npmConfigHook = pkgs.importNpmLock.npmConfigHook;
              installPhase = ''
                mkdir $out
                npm pack --pack-destination=$out
                mv $out/*.tgz $out/package.tgz
              '';
            };
          in
          "${thePkg}/package.tgz"
        ) gitDeps;
    };

    preBuild =
      let
        versionExports = (
          [ ]
          ++ (lib.optional (versionInfo ? commitHash) ''export COMMIT_HASH="${versionInfo.commitHash}"'')
          ++ (lib.optional (
            versionInfo ? commitDate
          ) ''export COMMIT_DATE="$(date -d @${builtins.toString versionInfo.commitDate} --iso-8601=s)"'')
        );
      in
      ''
        ${lib.concatStringsSep "\n" versionExports}
      '';

    installPhase = ''
      runHook preInstall
      cp -r dist $out
      runHook postInstall
    '';

    npmBuildScript = "build";

    npmConfigHook = pkgs.importNpmLock.npmConfigHook;
  })
)
