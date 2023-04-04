import { fetcher, makeSwrHook } from '../api';

export const listDocuments = fetcher.path('/api/v1/documents/').method('get').create();
export const createDocument = fetcher
  .path('/api/v1/documents/')
  .method('post', 'multipart/form-data')
  .create();
export const getDocument = fetcher.path('/api/v1/documents/{id}/').method('get').create();
export const getDocumentTasks = fetcher
  .path('/api/v1/documents/{id}/tasks/')
  .method('get')
  .create();

export const useListDocuments = makeSwrHook('listDocuments', listDocuments);
export const useGetDocument = makeSwrHook('getDocument', getDocument);
export const useGetDocumentTasks = makeSwrHook('getDocumentTasks', getDocumentTasks);
