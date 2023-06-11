import { fetcher, makeSwrHook } from '../api';

export const listDocuments = fetcher.path('/api/v1/documents/').method('get').create();
export const createDocument = fetcher
  .path('/api/v1/documents/')
  .method('post', 'multipart/form-data')
  .create();
export const getDocument = fetcher.path('/api/v1/documents/{document_id}/').method('get').create();
export const getDocumentTasks = fetcher
  .path('/api/v1/documents/{document_id}/tasks/')
  .method('get')
  .create();

export const useListDocuments = makeSwrHook('listDocuments', listDocuments);
export const useGetDocument = makeSwrHook('getDocument', getDocument);
export const useGetDocumentTasks = makeSwrHook('getDocumentTasks', getDocumentTasks);

export const deleteDocument = fetcher
  .path('/api/v1/documents/{document_id}/')
  .method('delete')
  .create();

export const updateDocument = fetcher
  .path('/api/v1/documents/{document_id}/')
  .method('patch', 'application/json')
  .create();

export const replaceChanges = fetcher
  .path('/api/v1/documents/{document_id}/replace_changes/')
  .method('post', 'multipart/form-data')
  .create();
