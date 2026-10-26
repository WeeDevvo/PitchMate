import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './Dialog.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  title: string;
  /** Escape, a click on the scrim, and any dismiss action call this. */
  onClose: () => void;
  icon?: IconName;
  /** `danger` tints the icon for destructive confirmations. */
  tone?: 'neutral' | 'danger';
  /** Put the safe action first and the destructive one last. */
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * A modal dialog. While open it holds focus inside itself (Tab and Shift+Tab
 * wrap), closes on Escape, and hands focus back to whatever had it on close.
 */
export function Dialog({ open, title, onClose, icon, tone = 'neutral', actions, children }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="pm-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="pm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {icon && (
          <span className={cx('pm-dialog__icon', `pm-dialog__icon--${tone}`)}>
            <Icon name={icon} size={24} />
          </span>
        )}
        <h2 id={titleId} className="pm-dialog__title">
          {title}
        </h2>
        {children}
        {actions && <div className="pm-dialog__actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}
