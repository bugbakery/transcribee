import { useLocation } from 'wouter';
import { storeAuthToken } from '../api';
import { useGetMe } from '../api/user';
import PrimaryButton from '../components/PrimaryButton';
import { primitiveWithClassname } from '../styled';
import { Popup } from '../components/Popup';
import { BiUser } from 'react-icons/bi';
import { IconButton } from '../components/IconButton';

export const TopBar = primitiveWithClassname('div', 'mb-8 flex items-center gap-4 justify-between');
export const TopBarTitle = primitiveWithClassname('h2', 'text-xl font-bold');
export const TopBarPart = primitiveWithClassname('div', 'gap-4 flex items-center');

export function MeButton() {
  return (
    <Popup button={<IconButton icon={BiUser} />}>
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
        onClick={() => {
          storeAuthToken(undefined);
          mutate();
          navigate('/');
          window.location.reload();
        }}
      >
        Logout
      </PrimaryButton>
    </>
  );
}
