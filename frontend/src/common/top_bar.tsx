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
export const TopBar = primitiveWithClassname('div', 'mb-8 flex items-center gap-4 justify-between');
export const TopBarTitle = primitiveWithClassname('h2', 'text-xl font-bold');
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
