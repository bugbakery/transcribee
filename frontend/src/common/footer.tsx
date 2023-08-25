import { Tooltip } from '../components/tooltip';
import './footer';
// eslint-disable-next-line import/no-unresolved
import version, { Commit } from 'virtual:git-version';
import { IoMdOpen } from 'react-icons/io';
import clsx from 'clsx';
import { Link } from 'wouter';
import { useGetPages } from '../api/pages';
import { primitiveWithClassname } from '../styled';

function formatDate(date?: string): string {
  return date
    ? new Date(date).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : 'UNKNOWN DATE';
}

export function CommitPopup({ commit, text }: { commit: Commit; text: string }) {
  return (
    <Tooltip
      className="inline-block underline decoration-dashed"
      placements="top"
      tooltipText={
        <>
          Last commit{' '}
          <a
            href={`https://github.com/bugbakery/transcribee/commit/${commit.hash}`}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline dark:text-blue-500 hover:no-underline"
            title="View commit on GitHub"
          >
            {commit?.hash?.substring(0, 10)} <IoMdOpen className="inline" />
          </a>{' '}
          on {formatDate(commit.date)}.
        </>
      }
    >
      {text}
    </Tooltip>
  );
}

export function ShortVersion() {
  const lastCommit = version?.lastCommit;

  return (
    <>
      Version:{' '}
      {lastCommit?.hash && (
        <a
          href={`https://github.com/bugbakery/transcribee/commit/${lastCommit.hash}`}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dashed"
          title="View commit on GitHub"
        >
          {lastCommit.hash.substring(0, 10)} <IoMdOpen className="inline" />
        </a>
      )}{' '}
      ({lastCommit?.countSinceStart || 'unknown'})
    </>
  );
}

export function LongVersion() {
  return (
    <>
      Frontend built on {formatDate(version?.date)}.
      {version?.lastCommitOnMain?.countSinceStart ? (
        <>
          {' '}
          <CommitPopup
            commit={version.lastCommitOnMain}
            text={`${version.lastCommitOnMain.countSinceStart} commits on main`}
          />
          {version?.branch != 'main' &&
            version.lastCommit &&
            version.lastCommit?.countSinceStart &&
            version.lastCommitOnMain?.countSinceStart && (
              <>
                {' '}
                +{' '}
                <CommitPopup
                  commit={version.lastCommit}
                  text={`${
                    version.lastCommit?.countSinceStart - version.lastCommitOnMain?.countSinceStart
                  } commits on ${version.branch}`}
                />
              </>
            )}
          {version.diffShort && <> + {version.diffShort}</>}
        </>
      ) : (
        version?.lastCommit?.hash && (
          <>
            {' '}
            Last commit{' '}
            {version.lastCommit?.hash && (
              <a
                href={`https://github.com/bugbakery/transcribee/commit/${version.lastCommit.hash}`}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dashed"
                title="View commit on GitHub"
              >
                {version.lastCommit.hash.substring(0, 10)} <IoMdOpen className="inline" />
              </a>
            )}{' '}
            on {formatDate(version.lastCommit?.date)}.
          </>
        )
      )}
    </>
  );
}

function useFooterPages() {
  const { data: pages } = useGetPages({});
  if (pages === undefined) {
    return [];
  }
  return Object.entries(pages)
    .map(([k, v]) => ({ id: k, ...v }))
    .filter(
      (x): x is typeof x & { footer_position: number } =>
        x.footer_position !== null && x.footer_position !== undefined,
    )
    .sort((a, b) => {
      if (a.footer_position > b.footer_position) return 1;
      if (a.footer_position < b.footer_position) return -1;
      return 0;
    });
}

export function FooterPages() {
  const pages = useFooterPages();

  return (
    <>
      {pages.map((x) => (
        <PipeListItem key={x.id}>
          <Link
            href={`/page/${x.id}`}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dashed"
          >
            {x.name}
          </Link>
        </PipeListItem>
      ))}
    </>
  );
}

const PipeListItem = primitiveWithClassname('li', [
  'inline py-0 px-2 border-l-[1px] border-inherit',
  'first:border-l-0',
]);

export function Footer({ className = '' }: { className?: string }) {
  return (
    <div className={clsx('mt-5')}>
      <ul className={clsx('text-xs', 'opacity-70 ', 'w-full text-center', className)}>
        <PipeListItem>
          <ShortVersion />
        </PipeListItem>
        <PipeListItem>
          <Link
            href={'/about'}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dashed"
          >
            About
          </Link>
        </PipeListItem>
        <FooterPages />
      </ul>
    </div>
  );
}
