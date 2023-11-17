import { paths } from './openapi-schema';
import { ApiResponse, Fetcher, Middleware } from 'openapi-typescript-fetch';
import useSwr, { SWRConfiguration, SWRResponse } from 'swr';
import { defaultConfig } from 'swr/_internal';

export function getShareToken(): string | null {
  return new URL(location.href).searchParams.get('share_token');
}

export function getAuthToken(): string | null {
  return localStorage.getItem('auth');
}

export function storeAuthToken(token: string | undefined) {
  if (token) {
    localStorage.setItem('auth', token);
  } else {
    localStorage.removeItem('auth');
  }
}

const authMiddleware: Middleware = async (url, init, next) => {
  const headers = new Headers(init.headers);

  const authToken = getAuthToken();
  if (authToken) {
    headers.set('Authorization', `Token ${authToken}`);
  }

  const shareToken = getShareToken();
  if (shareToken) {
    headers.set('Share-Token', shareToken);
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

export function makeRetrySwrHook<P, R>(
  id: string,
  fn: (params: P, req?: RequestInit | undefined) => Promise<ApiResponse<R>>,
) {
  const swrHook = makeSwrHook(id, fn);
  return (params: Parameters<typeof swrHook>[0], options?: Partial<SWRConfiguration>) =>
    swrHook(params, {
      onErrorRetry: (err, key, config, revalidate, opts) => {
        if (err.status === 422) return;
        else defaultConfig.onErrorRetry(err, key, config, revalidate, opts);
      },
      ...options,
    });
}

export type RequestDataType<T extends (...args: never) => SWRResponse> = Exclude<
  ReturnType<T>['data'],
  undefined
>;
