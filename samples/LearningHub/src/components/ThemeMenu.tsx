import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CheckmarkRegular } from '@fluentui/react-icons/headless/svg/checkmark';
import { DesktopRegular } from '@fluentui/react-icons/headless/svg/desktop';
import { WeatherMoonRegular } from '@fluentui/react-icons/headless/svg/weather-moon';
import { WeatherSunnyRegular } from '@fluentui/react-icons/headless/svg/weather-sunny';
import type { ThemeChoice } from '../lib/preferences';

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof DesktopRegular }[] = [
  { value: 'system', label: 'System', Icon: DesktopRegular },
  { value: 'light', label: 'Light', Icon: WeatherSunnyRegular },
  { value: 'dark', label: 'Dark', Icon: WeatherMoonRegular },
];

export function ThemeMenu({ theme, onChange }: { theme: ThemeChoice; onChange: (theme: ThemeChoice) => void }) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[0];

  useEffect(() => {
    if (open) itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openMenu = (index?: number) => {
    setFocusIndex(index ?? Math.max(0, OPTIONS.findIndex((o) => o.value === theme)));
    setOpen(true);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const choose = (value: ThemeChoice) => {
    if (value !== theme) onChange(value);
    close(true);
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowUp' ? OPTIONS.length - 1 : undefined);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = OPTIONS.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setFocusIndex((i) => (i >= last ? 0 : i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusIndex((i) => (i <= 0 ? last : i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setFocusIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setFocusIndex(last);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <div className="menu-anchor">
      <button
        ref={buttonRef}
        type="button"
        className="icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Theme: ${current.label}`}
        title={`Theme: ${current.label}`}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onButtonKeyDown}
      >
        <current.Icon />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} className="menu" role="menu" aria-label="Theme" onKeyDown={onMenuKeyDown}>
          {OPTIONS.map((option, index) => (
            <button
              key={option.value}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === theme}
              tabIndex={index === focusIndex ? 0 : -1}
              className="menu__item"
              onClick={() => choose(option.value)}
            >
              <option.Icon className="menu__icon" />
              <span>{option.label}</span>
              {option.value === theme && <CheckmarkRegular className="menu__check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
