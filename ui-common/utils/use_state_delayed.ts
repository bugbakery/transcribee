import { useRef, useState } from 'react';

/*
 * this is a utility that can be used in popups / dropdowns / ... if one wants to use transitions
 * and unmount hidden parts from the dom. For this it generates 3 versions of the state variable:
 * - `now` is changed imidiate. It would be equivalent to just using useState
 * - the rising edge of `late` is delayed by `config.late` milliseconds. The falling edge in sync
 *   with `now`. Do your css show / hide with transitions based on this.
 * - the rising edge of `prolonged` is in sync with `now`. The falling edge is delayed by
 *   `config.prolong` milliseconds. Mount / unmount your dom elements based on this.
 *
 * now:       _____-------------_____________
 * late:      _______-----------_____________
 * prolonged: _____-------------------_______
 *                |--|         |------|
 *            config.late   config.prolong
 */
export function useStateDelayed(
  initial: boolean,
  config = { late: 25, prolong: 200 },
): [{ now: boolean; prolonged: boolean; late: boolean }, (next: boolean) => void] {
  const [now, setNow] = useState(initial);
  const [prolonged, setProlonged] = useState(initial);
  const [late, setLate] = useState(initial);
  const timeout = useRef<number | null>(null);

  const set = (next: boolean) => {
    if (next) {
      setNow(true);
      setProlonged(true);
      if (timeout.current != null) clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => setLate(true), config.late);
    } else {
      setNow(false);
      setLate(false);
      if (timeout.current != null) clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => setProlonged(false), config.prolong);
    }
  };

  return [{ now, prolonged, late }, set];
}
