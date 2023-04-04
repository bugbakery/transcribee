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

const authMiddleware: Middleware = async (url, init, next) => {
  const headers = new Headers(init.headers);

  const authToken = localStorage.getItem('auth');
  if (authToken) {
    headers.set('Authorization', `Token ${authToken}`);
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
