import { Tooltip } from '../components/tooltip';
import './version';
// eslint-disable-next-line import/no-unresolved
import version, { Commit } from 'virtual:git-version';
import { IoMdOpen } from 'react-icons/io';
import clsx from 'clsx';

function formatDate(date: string): string {
  return new Date(date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
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
            href={`https://github.com/transcribee/transcribee/commit/${commit.hash}`}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline dark:text-blue-500 hover:no-underline"
            title="View commit on GitHub"
          >
            {commit.hash.substring(0, 10)} <IoMdOpen className="inline" />
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
  const { lastCommitOnMain, branch, lastCommit, diffShort } = version;

  return (
    <div className={clsx('mb-10')}>
      <div
        className={clsx(
          'absolute bottom-0 ',
          'h-10 text-xs',
          'opacity-50 hover:opacity-100 duration-400 transition-all',
          'w-full text-center',
          'left-1/2 -translate-x-1/2',
          className,
        )}
      >
        Frontend built on {formatDate(version.date)}.{' '}
        <CommitPopup
          commit={lastCommitOnMain}
          text={`${lastCommitOnMain.countSinceStart} commits on main`}
        />
        {branch != 'main' && (
          <>
            {' '}
            +{' '}
            <CommitPopup
              commit={lastCommit}
              text={`${
                lastCommit.countSinceStart - lastCommitOnMain.countSinceStart
              } commits on ${branch}`}
            />
          </>
        )}
        {diffShort && <> + {diffShort}</>}
      </div>
    </div>
  );
}
