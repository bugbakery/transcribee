{
  pkgs,
  lib,
  versionInfo,
  ...
}:
pkgs.buildNpmPackage (lib.fix (self: {
  pname = "transcribee-frontend";
  version = "0.1.0";
  src = ../../frontend;

  nativeBuildInputs = [ pkgs.git ];

  npmDeps = pkgs.importNpmLock {
    npmRoot = self.src;
    packageSourceOverrides = let
      gitDeps = (lib.attrsets.filterAttrs (name: pkgInfo:
        (lib.hasPrefix "node_modules/" name)
        && (lib.hasPrefix "git" (pkgInfo.resolved or "")))
        (lib.importJSON (self.src + "/package-lock.json")).packages);
    in lib.attrsets.mapAttrs (name: pkgInfo:
      let
        src = builtins.fetchGit {
          url = "https" + lib.removePrefix "git+ssh" pkgInfo.resolved;
          rev = lib.last (lib.splitString "#" pkgInfo.resolved);
          allRefs = true;
        };
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
      in "${thePkg}/package.tgz") gitDeps;
  };

  preBuild = let
    versionExports = ([ ]
      ++ (lib.optional (versionInfo ? commitHash) ''export COMMIT_HASH="${versionInfo.commitHash}"'')
      ++ (lib.optional (versionInfo ? commitDate) ''export COMMIT_DATE="$(date -d @${builtins.toString versionInfo.commitDate} --iso-8601=s)"'')
    );
  in ''
    ${lib.concatStringsSep "\n" versionExports}
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';

  npmBuildScript = "build";

  npmConfigHook = pkgs.importNpmLock.npmConfigHook;
}))
