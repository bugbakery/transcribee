{ pkgs
, stdenv
, lib
, versionInfo ? { }
}:
let
  common = import ../common.nix;
  package = builtins.fromJSON (builtins.readFile ../../frontend/package.json);
in
stdenv.mkDerivation {
  pname = package.name;
  version = package.version;
  src = ../..;

  nativeBuildInputs = [
    pkgs.nodePackages.pnpm
  ];

  configurePhase = ''
    cd frontend/
  '';

  installPhase =
    let
      versionExports = ([ ]
        ++ (lib.optional (versionInfo ? "commitHash") "export COMMIT_HASH=\"${versionInfo.commitHash}\"")
        ++ (lib.optional (versionInfo ? "commitDate") "export COMMIT_DATE=\"${versionInfo.commitDate}\"")
        ++ (lib.optional (versionInfo ? "commitUrl") "export COMMIT_URL=\"${versionInfo.commitUrl}\"")
      );
    in
    ''
      # npm is used by some packages
      export NPM_CONFIG_CACHE="$(mktemp -d)"
      export NODE_EXTRA_CA_CERTS="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"

      echo "store-dir = $(mktemp -d)" > .npmrc

      pnpm install --frozen-lockfile

      ${lib.concatStringsSep "\n" versionExports}
      pnpm build

      mkdir -p $out
      cp -r dist/* dist/.* $out/
    '';
}
