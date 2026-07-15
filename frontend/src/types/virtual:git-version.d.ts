declare module 'virtual:git-version' {
  export interface Commit {
    hash?: string;
    date?: string;
    url?: string;
  }

  export interface Version {
    name?: string;
    buildDate?: string;
    commit?: Commit;
  }

  let version: Version | undefined;
  // eslint-disable-next-line import/no-default-export
  export default version;
}
