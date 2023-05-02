import { defaultConfig } from 'swr/_internal';
import { fetcher, makeSwrHook } from '../api';
import { SWRConfiguration } from 'swr';

export const login = fetcher
  .path('/api/v1/users/login/')
  .method('post', 'application/json')
  .create();
export const getMe = fetcher.path('/api/v1/users/me/').method('get').create();

const useGetMeWithRetry = makeSwrHook('getMe', getMe);

export const useGetMe = (
  params: Parameters<typeof useGetMeWithRetry>[0],
  options?: Partial<SWRConfiguration>,
) =>
  useGetMeWithRetry(params, {
    onErrorRetry: (err, key, config, revalidate, opts) => {
      if (err.status === 422) return;
      else defaultConfig.onErrorRetry(err, key, config, revalidate, opts);
    },
    ...options,
  });
