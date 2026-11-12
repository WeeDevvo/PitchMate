import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';
import './ActionsMenu.css';

export interface ActionsMenuProps {
  /** The trigger's accessible name, naming what the actions are for: "Actions for Player 1". */
  label: string;
  /** The actions: the caller's own controls, each with its own confirmation if it needs one. */
  children: ReactNode;
  className?: string;
}

/**
 * A row's "…" menu: a disclosure whose panel holds the caller's action controls.
 *
 * Deliberately a disclosure rather than an ARIA menu — the panel is a plain group
 * of buttons in the Tab order — so a control inside can open its own inline
 * confirmation and get focus back afterwards, which a menu that closes on
 * activation could not offer. Escape closes the panel and returns focus to the
 * trigger, unless something inside (an open confirmation) handled it first; a
 * pointer press outside closes it too.
 */
export function ActionsMenu({ label, children, className }: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [open]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !open) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    },
    [open],
  );

  return (
    <div ref={rootRef} className={cx('pm-actions', className)} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="pm-iconbtn pm-actions__trigger"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <Icon name="more" size={22} />
      </button>
      {open && (
        <div id={panelId} className="pm-actions__panel" role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
