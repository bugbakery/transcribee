import { RequestDataType, fetcher, makeSwrHook } from '../api';

export const listDocuments = fetcher.path('/api/v1/documents/').method('get').create();
export const createDocument = fetcher
  .path('/api/v1/documents/')
  .method('post', 'multipart/form-data')
  .create();
export const importDocument = fetcher
  .path('/api/v1/documents/import/')
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

export type ApiDocument = RequestDataType<typeof useGetDocument>;

export const deleteDocument = fetcher
  .path('/api/v1/documents/{document_id}/')
  .method('delete')
  .create();

export const updateDocument = fetcher
  .path('/api/v1/documents/{document_id}/')
  .method('patch', 'application/json')
  .create();

export const shareDocument = fetcher
  .path('/api/v1/documents/{document_id}/share_tokens/')
  .method('post', 'application/json')
  .create();

export const listShareTokens = fetcher
  .path('/api/v1/documents/{document_id}/share_tokens/')
  .method('get')
  .create();

export const useListShareTokens = makeSwrHook('listShareTokens', listShareTokens);

export const deleteShareToken = fetcher
  .path('/api/v1/documents/{document_id}/share_tokens/{token_id}/')
  .method('delete')
  .create();
