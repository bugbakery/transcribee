import { clsx, ClassValue } from 'clsx';
import { createElement, forwardRef, HTMLElementType, JSX } from 'react';

export function primitiveWithClassname<T extends HTMLElementType>(type: T, classValue: ClassValue) {
  const C = forwardRef((props: JSX.IntrinsicElements[T], ref) => {
    return createElement(type, {
      ...props,
      className: clsx(classValue, props.className),
      ref,
    });
  });

  C.displayName = type + 'WithClassname';
  return C;
}
