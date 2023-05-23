import { paths } from './openapi-schema';
import { ApiResponse, Fetcher, Middleware } from 'openapi-typescript-fetch';
import useSwr, { SWRConfiguration } from 'swr';

export function storeAuthToken(token: string | undefined) {
  if (token) {
    localStorage.setItem('auth', token);
  } else {
    localStorage.removeItem('auth');
  }
}

export function getDocumentAuth(): string | undefined {
  const shareToken = getShareToken();
  if (shareToken) {
    return `Share ${shareToken}`;
  }
  const authToken = localStorage.getItem('auth');
  if (authToken) {
    return `Token ${authToken}`;
  }
}

export function getShareToken(): string | null {
  return new URL(location.href).searchParams.get('share_token');
}

const authMiddleware: Middleware = async (url, init, next) => {
  const headers = new Headers(init.headers);
  const auth = getDocumentAuth();
  if (auth) {
    headers.set('Authorization', auth);
  }

  return next(url, { ...init, headers: headers });
};

export const fetcher = Fetcher.for<paths>();
fetcher.configure({
  baseUrl: '',
  use: [authMiddleware],
});

export function makeSwrHook<P, R>(
  id: string,
  fn: (params: P, req?: RequestInit | undefined) => Promise<ApiResponse<R>>,
) {
  return (params: P, options?: Partial<SWRConfiguration>) =>
    useSwr(
      [id, params],
      async () => {
        const response = await fn(params);
        return response.data;
      },
      options,
    );
}
