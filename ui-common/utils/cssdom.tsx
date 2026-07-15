import { useEffect, useRef } from 'react';

export function CssRule({ css }: { css: string }) {
  const sheetRef = useRef<CSSStyleSheet | null>(null);
  useEffect(() => {
    const style = document.createElement('style');
    document.head.appendChild(style);
    sheetRef.current = style.sheet;

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    sheetRef.current?.insertRule(css, 0);

    return () => {
      sheetRef.current?.deleteRule(0);
    };
  }, [css]);

  return <></>;
}
