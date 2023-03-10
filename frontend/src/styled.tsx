import clsx, { ClassValue } from 'clsx';
import { ComponentType, createElement, forwardRef, ReactHTML } from 'react';

export function withClassname<P extends { className?: string }>(
  Component: ComponentType<P>,
  classValue: ClassValue,
) {
  const C = forwardRef((props: JSX.IntrinsicAttributes & P, ref) => {
    return <Component {...props} className={clsx(classValue, props.className)} ref={ref} />;
  });

  C.displayName = (Component.displayName || 'Anonymous') + 'WithClassname';
  return C;
}

export function primitiveWithClassname<T extends keyof ReactHTML>(type: T, classValue: ClassValue) {
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
