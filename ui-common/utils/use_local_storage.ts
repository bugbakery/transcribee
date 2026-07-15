import { Dispatch, SetStateAction, useState } from 'react';

/**
 * A hook that functions like useState, but persists the value to localStorage.
 *
 * The value is serialized as JSON.
 *
 * @param key a unique key for localStorage
 * @param initialValue the initial value or a function that returns the initial value
 * @returns a tuple of [value, setValue]
 */
export function useLocalStorage<S>(
  key: string,
  initialValue: S | (() => S),
): [S, Dispatch<SetStateAction<S>>] {
  const getInitialValue = () => {
    return initialValue instanceof Function ? initialValue() : initialValue;
  };

  const [storedValue, setStoredValue] = useState<S>(() => {
    if (typeof window === 'undefined') {
      return getInitialValue();
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : getInitialValue();
    } catch (error) {
      console.log(error);
      return getInitialValue();
    }
  });

  const setValue = (value: S | ((oldValue: S) => S)) => {
    try {
      // allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.log(error);
    }
  };

  return [storedValue, setValue];
}
