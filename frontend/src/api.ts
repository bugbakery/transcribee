export const BASE_URL = '/api/';

export function fetchApi(path: string, init: RequestInit) {
  const headers: HeadersInit = {};

  const authToken = localStorage.getItem('auth');
  if (authToken) {
    headers['Authorization'] = `Token ${authToken}`;
  }

  if (typeof init.body == 'string') {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(BASE_URL + path, {
    ...init,
    headers: {
      ...headers,
      ...init.headers,
    },
  });
}

export function storeAuthToken(token: string | undefined) {
  if (token) {
    localStorage.setItem('auth', token);
  } else {
    localStorage.removeItem('auth');
  }
}
