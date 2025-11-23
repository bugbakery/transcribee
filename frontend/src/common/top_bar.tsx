import clsx from 'clsx';
import { useLocation } from 'wouter';

import { storeAuthToken } from '../api';
import { logout } from '../api/user';
import { primitiveWithClassname } from '../styled';
import { BiUser } from 'react-icons/bi';
import { IconButton, PrimaryButton, SecondaryButton } from '../components/button';
import { Popup } from '../components/popup';
import { showModal } from '../components/modal';
import { ChangePasswordModal } from '../components/change_password';
import { useAuthData } from '../utils/auth';

const TopBarBg = primitiveWithClassname(
  'div',
  'fixed left-0 right-0 top-0 bg-black h-[52px] -z-10 bg-white dark:bg-neutral-900',
);

export function TopBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'sticky top-0 z-10',
        '-mx-6 px-6 -mt-6 mb-6 py-2',
        'flex items-center gap-4 justify-between',
        'bg-white dark:bg-neutral-900',
        className,
      )}
    >
      <TopBarBg />
      {children}
    </div>
  );
}
export const TopBarTitle = primitiveWithClassname(
  'h2',
  'text-xl font-bold text-nowrap text-ellipsis overflow-hidden',
);
export const TopBarPart = primitiveWithClassname('div', 'gap-4 flex items-center');

export function MeButton() {
  return (
    <Popup button={<IconButton icon={BiUser} label="user-menu" />}>
      <MeMenu />
    </Popup>
  );
}

export function MeMenu() {
  const { username } = useAuthData();
  const [_location, navigate] = useLocation();

  return (
    <>
      <div className="flex flex-col gap-y-4">
        <div>hello, {username}</div>
        <SecondaryButton
          onClick={() => {
            showModal(
              <ChangePasswordModal label="Change Password" onClose={() => showModal(null)} />,
            );
          }}
        >
          Change Password
        </SecondaryButton>
        <PrimaryButton
          onClick={async () => {
            try {
              await logout({});
            } catch (e) {
              /* empty */
            }
            storeAuthToken(undefined);
            navigate('/');
            window.location.reload();
          }}
        >
          Logout
        </PrimaryButton>
      </div>
    </>
  );
}
