import { Tooltip } from '../components/tooltip';
import './version';
// eslint-disable-next-line import/no-unresolved
import version, { Commit } from 'virtual:git-version';
import { IoMdOpen } from 'react-icons/io';
import clsx from 'clsx';

function formatDate(date?: string): string {
  return date
    ? new Date(date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
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

export function Version({ className = '' }: { className?: string }) {
  return (
    <div className={clsx('mt-5')}>
      <div
        className={clsx(
          'text-xs',
          'opacity-70 hover:opacity-100 duration-400 transition-all',
          'w-full text-center',
          className,
        )}
      >
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
                      version.lastCommit?.countSinceStart -
                      version.lastCommitOnMain?.countSinceStart
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
      </div>
    </div>
  );
}
