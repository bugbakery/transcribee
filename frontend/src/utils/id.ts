const map = new WeakMap();
let currentId = 0;

export function id(object: any): number {
  if (!map.has(object)) {
    map.set(object, ++currentId);
  }

  return map.get(object);
}
