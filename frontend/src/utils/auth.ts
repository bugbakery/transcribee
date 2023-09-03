import { getAuthToken, getShareToken } from '../api';
import { useGetMe } from '../api/user';

export function getDocumentWsUrl(documentId: string) {
  const url = new URL(`/api/v1/documents/sync/${documentId}/`, window.location.href);
  url.protocol = url.protocol.replace('http', 'ws');

  const authToken = getAuthToken();
  if (authToken) {
    url.searchParams.append('authorization', `Token ${authToken}`);
  }

  const shareToken = getShareToken();
  if (shareToken) {
    url.searchParams.append('share_token', shareToken);
  }
  return url.toString();
}

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
