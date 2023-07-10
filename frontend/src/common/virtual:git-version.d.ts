declare module 'virtual:git-version' {
  export interface Commit {
    countSinceStart?: number;
    date?: string;
    hash?: string;
  }

  export interface Version {
    branch?: string;
    diffShort?: string;
    lastCommit?: Commit;
    date?: string;
  }

  let version: Version | undefined;
  // eslint-disable-next-line import/no-default-export
  export default version;
}
