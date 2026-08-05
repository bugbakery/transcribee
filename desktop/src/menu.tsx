import { clsx } from 'clsx';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useOnClickOutside } from 'transcribee-ui-common/utils/use_on_click_outside';
import { useFloating } from '@floating-ui/react-dom';
import { platform } from '@tauri-apps/plugin-os';

const MenuBarContext = createContext<{
  openMenu: symbol | null;
  setOpenMenu: (menuId: symbol | null) => void;
  macOsMode: boolean;
}>({
  openMenu: null,
  setOpenMenu: () => {},
  macOsMode: false,
});

export function MenuBar({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) {
  const [openMenu, setOpenMenu] = useState<symbol | null>(null);
  const macOsMode = Boolean(platform() == 'macos' && !localStorage.getItem('DEBUG_MENUBAR'));

  return (
    <MenuBarContext.Provider
      value={{
        openMenu,
        setOpenMenu,
        macOsMode,
      }}
    >
      <div
        className={clsx(
          'flex gap-1 px-2 fixed top-0 right-0 left-0 z-50 bg-white dark:bg-neutral-900',
          hidden && 'hidden',
        )}
      >
        {children}
      </div>
    </MenuBarContext.Provider>
  );
}

export function SubMenu({ children, title }: { children: React.ReactNode; title: string }) {
  const ctx = useContext(MenuBarContext);
  const menuIdentity = useRef(Symbol());
  const isOpen = ctx.openMenu == menuIdentity.current;

  const { refs, floatingStyles } = useFloating<HTMLButtonElement>({
    open: isOpen,
    placement: 'bottom-start',
  });

  useOnClickOutside(refs.reference.current, (e) => {
    e.preventDefault();
    if (ctx.openMenu == menuIdentity.current) {
      ctx.setOpenMenu(null);
    }
  });

  return (
    <div className={clsx(ctx.macOsMode && 'hidden')}>
      <button
        ref={refs.setReference}
        className={clsx(
          'text-sm hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-md px-2 py-1',
          isOpen && 'bg-gray-100 dark:bg-neutral-800',
        )}
        onClick={() => {
          ctx.setOpenMenu(ctx.openMenu == menuIdentity.current ? null : menuIdentity.current);
        }}
        onMouseEnter={() => {
          if (ctx.openMenu != null) {
            ctx.setOpenMenu(menuIdentity.current);
          }
        }}
      >
        {title}
      </button>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={clsx(
          'bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-600 rounded-md py-2 px-2 shadow-lg grid-cols-[auto_auto] grid',
          !isOpen && 'hidden',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function useAccelerator(combination: string | undefined, callback?: () => void) {
  useEffect(() => {
    const keys = combination?.split('+');
    if (!keys || !callback) {
      return;
    }

    const listener = (e: KeyboardEvent) => {
      const isPressed = (key: string) => {
        if (key == 'Ctrl') {
          return e.ctrlKey;
        }

        if (key == 'Alt') {
          return e.altKey;
        }

        if (key == 'Shift') {
          return e.shiftKey;
        }

        return e.key == key.toLowerCase();
      };

      if (keys.every((key) => isPressed(key))) {
        callback();
      }
    };

    window.addEventListener('keydown', listener);

    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, [combination, callback]);
}

export function MenuItem({
  children,
  accelerator,
  onClick,
}: {
  children: React.ReactNode;
  accelerator?: string;
  onClick?: () => void;
}) {
  const ctx = useContext(MenuBarContext);

  // macOS accelerators are managed by the macOS menu bar
  useAccelerator(!ctx.macOsMode && onClick ? accelerator : undefined, onClick);

  return (
    <div
      className="contents group cursor-pointer select-none"
      onClick={() => {
        if (onClick) {
          onClick();
        }
      }}
    >
      <div className="text-sm whitespace-nowrap group-hover:bg-gray-100 dark:group-hover:bg-neutral-800 rounded-l pl-2 py-1">
        {children}
      </div>
      <div className="pl-6 text-black/40 dark:text-white/50 text-xs group-hover:bg-gray-100 dark:group-hover:bg-neutral-800 rounded-r pr-2 py-1 flex items-center">
        <div className="ml-auto">{accelerator}</div>
      </div>
    </div>
  );
}
