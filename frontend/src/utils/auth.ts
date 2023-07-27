import { getShareToken } from '../api';
import { useGetMe } from '../api/user';

export function useAuthData(): {
  isLoading: boolean;
  isLoggedIn: boolean;
  hasShareToken: boolean;
  username: string | null;
} {
  const { data, isLoading } = useGetMe({});
  const isLoggedIn = data?.username !== undefined;
  const hasShareToken = getShareToken() !== null;

  return { isLoading, isLoggedIn, hasShareToken, username: data?.username || null };
}
