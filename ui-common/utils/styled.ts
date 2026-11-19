import { clsx, ClassValue } from 'clsx';
import { createElement, forwardRef, HTMLElementType, JSX } from 'react';
import { twMerge } from 'tailwind-merge';

export function primitiveWithClassname<T extends HTMLElementType>(type: T, classValue: ClassValue) {
  const C = forwardRef((props: JSX.IntrinsicElements[T], ref) => {
    return createElement(type, {
      ...props,
      className: cn(classValue, props.className),
      ref,
    });
  });

  C.displayName = type + 'WithClassname';
  return C;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
