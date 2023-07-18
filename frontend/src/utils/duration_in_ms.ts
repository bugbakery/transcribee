export function hoursInMs(hours: number) {
  return minutesInMs(hours * 60);
}

export function minutesInMs(minutes: number) {
  return secondsInMs(minutes * 60);
}

export function secondsInMs(seconds: number) {
  return seconds * 1000;
}
