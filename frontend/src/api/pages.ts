import { fetcher, makeRetrySwrHook } from '../api';

export const getPages = fetcher.path('/api/v1/page/').method('get').create();
export const getPage = fetcher.path('/api/v1/page/{page_id}').method('get').create();

export const useGetPages = makeRetrySwrHook('getPages', getPages);
export const useGetPage = makeRetrySwrHook('getPage', getPage);
