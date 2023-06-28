import { useLocation } from 'wouter';
import { storeAuthToken } from '../api';
import { useGetMe, logout } from '../api/user';
import { primitiveWithClassname } from '../styled';
import { BiUser } from 'react-icons/bi';
import { IconButton, PrimaryButton } from '../components/button';
import { Popup } from '../components/popup';

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
  const { data, mutate } = useGetMe({});
  const [_location, navigate] = useLocation();

  return (
    <>
      <div className="pb-4">hello, {data?.username}</div>
      <PrimaryButton
        onClick={async () => {
          try {
            const response = await logout({});
          } catch (e) {}
          storeAuthToken(undefined);
//           mutate();  was need for debug
          navigate('/');
          window.location.reload();
        }}
      >
        Logout
      </PrimaryButton>
    </>
  );
}
