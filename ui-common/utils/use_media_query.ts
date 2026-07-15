import { useEffect, useState } from 'react';

export function useMediaQuery(mediaQuery: string) {
  const [state, setState] = useState(window.matchMedia(mediaQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(mediaQuery);
    query.addEventListener('change', (q) => setState(q.matches));
  }, []);
  return state;
}
