{ lib }:
rec {
  /**
    Parses information from the resolved field of a git dependency.

    Supported format: git+ssh://git@example.com/some/repo#AAAAAAAA
  */
  parseGitString =
    resolvedStr:
    let
      parts = lib.splitString "#" resolvedStr;
    in
    {
      repoUrl = lib.head parts;
      rev = lib.last parts;
    };

  isGitDependency =
    name: pkgInfo:
    (lib.hasPrefix "node_modules/" name) && (lib.hasPrefix "git" (pkgInfo.resolved or ""));

  fetchGitDependency =
    pkgsInfo:
    let
      gitInfo = parseGitString pkgsInfo.resolved;

      # load via https, so we don't need to authenticate at github
      httpsUrl = "https" + lib.removePrefix "git+ssh" gitInfo.repoUrl;
    in
    builtins.fetchGit {
      url = httpsUrl;
      rev = gitInfo.rev;
      allRefs = true;
    };
}
