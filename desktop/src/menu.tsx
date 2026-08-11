import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { useOnClickOutside } from 'transcribee-ui-common/utils/use_on_click_outside';
import { useFloating } from '@floating-ui/react-dom';
import { platform } from '@tauri-apps/plugin-os';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export type MenuItemDef = {
  text: string;
  /**
   * Attach to a window specfic macOS menu item to enable it and specify the action in JS.
   */
  macOsMenuItemId?: string;
  action: () => void;
  accelerator?: string;
};

export type MenuDef = {
  title: string;
  items: MenuItemDef[];
};

export function MenuBar({ hidden, menus }: { hidden?: boolean; menus: MenuDef[] }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const enableMenuBar = platform() != 'macos' || Boolean(localStorage.getItem('DEBUG_MENUBAR'));

  useEffect(() => {
    if (!enableMenuBar) return;

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

      menus.forEach((menu) => {
        menu.items.forEach((item) => {
          if (!item.accelerator || !item.action) {
            return;
          }

          const keys = item.accelerator.split('+');

          if (keys.every((key) => isPressed(key))) {
            item.action();
          }
        });
      });
    };

    window.addEventListener('keydown', listener);

    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, [menus]);

  useEffect(() => {
    if (platform() != 'macos') return;

    // tell global macOS menu what menu items should be activated when this window is focused
    const availableMenuItems = menus.flatMap((menu) =>
      menu.items.map((item) => item.macOsMenuItemId).filter((x) => x != undefined),
    );
    invoke('set_available_menu_items', { items: availableMenuItems });

    // handle window specific items from global macOS menu
    const unlistenPromise = listen('macos_menu_clicked', (e) => {
      menus.forEach((menu) => {
        menu.items.forEach((item) => {
          if (item.action && e.payload == item.macOsMenuItemId) {
            item.action();
          }
        });
      });
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [menus]);

  if (hidden || !enableMenuBar) {
    return null;
  }

  return (
    <>
      <div className="flex gap-2 h-10 px-4 items-center fixed top-0 right-0 left-0 z-50 bg-[rgb(252_252_252)] dark:bg-[rgb(28_28_28)] border-b border-b-[rgb(240_240_240)] dark:border-b-neutral-800">
        {menus.map((menu) => (
          <Menu
            key={menu.title}
            title={menu.title}
            open={openMenu == menu.title}
            onClick={() => {
              if (openMenu == menu.title) {
                setOpenMenu(null);
              } else {
                setOpenMenu(menu.title);
              }
            }}
            onMouseEnter={() => {
              // immitate native menus, which switch menus on hover when any menu is active
              if (openMenu) {
                setOpenMenu(menu.title);
              }
            }}
            onClose={() => {
              setOpenMenu(null);
            }}
          >
            {menu.items.map((item) => (
              <MenuItem key={item.text} onClick={item.action} accelerator={item.accelerator}>
                {item.text}
              </MenuItem>
            ))}
          </Menu>
        ))}
      </div>
      <div className="h-10" /> {/* spacer */}
    </>
  );
}

function Menu({
  children,
  title,
  open,
  onClick,
  onClose,
  onMouseEnter,
}: {
  children: React.ReactNode;
  title: string;
  open: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onClose: () => void;
}) {
  const { refs, floatingStyles } = useFloating<HTMLButtonElement>({
    open,
    placement: 'bottom-start',
  });

  useOnClickOutside(refs.reference.current, (e) => {
    e.preventDefault();
    if (open) {
      onClose();
    }
  });

  return (
    <div>
      <button
        ref={refs.setReference}
        className={clsx(
          'text-sm hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-md px-2 py-1',
          open && 'bg-gray-100 dark:bg-neutral-800',
        )}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
      >
        {title}
      </button>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={clsx(
          'bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-600 rounded-md py-2 px-2 shadow-lg grid-cols-[auto_auto] grid',
          !open && 'hidden',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function MenuItem({
  children,
  accelerator,
  onClick,
}: {
  children: React.ReactNode;
  accelerator?: string;
  onClick?: () => void;
}) {
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
