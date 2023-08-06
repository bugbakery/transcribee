import clsx from 'clsx';
import { Version } from '../common/version';

export function AppContainer({
  children,
  className,
  versionClassName = '',
  ...props
}: JSX.IntrinsicElements['div'] & { versionClassName?: string }) {
  return (
    <div
      {...props}
      className={clsx('min-h-screen max-w-screen-xl p-6 mx-auto flex flex-col', className)}
    >
      <div className="flex-1">{children}</div>
      <Version className={versionClassName} />
    </div>
  );
}

export function AppCenter({
  children,
  className,
  versionClassName = '',
  ...props
}: JSX.IntrinsicElements['div'] & { versionClassName?: string }) {
  return (
    <div
      {...props}
      className={clsx(
        'min-h-screen h-min p-6 flex flex-col items-center justify-center ',
        className,
      )}
    >
      <div className="flex-1 flex items-center align-middle justify-center">{children}</div>
      <Version className={versionClassName} />
    </div>
  );
}
