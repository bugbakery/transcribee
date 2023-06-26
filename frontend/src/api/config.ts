import { defaultConfig } from 'swr/_internal';
import { fetcher, makeSwrHook } from '../api';
import { SWRConfiguration } from 'swr';

export const getConfig = fetcher.path('/api/v1/config/').method('get').create();

const useGetConfigWithRetry = makeSwrHook('getConfig', getConfig);

export const useGetConfig = (
  params: Parameters<typeof useGetConfigWithRetry>[0],
  options?: Partial<SWRConfiguration>,
) =>
  useGetConfigWithRetry(params, {
    onErrorRetry: (err, key, config, revalidate, opts) => {
      if (err.status === 422) return;
      else defaultConfig.onErrorRetry(err, key, config, revalidate, opts);
    },
    ...options,
  });
