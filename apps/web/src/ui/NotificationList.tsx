import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './NotificationList.css';

export interface NotificationListProps {
  className?: string;
  /** `li` elements, each holding a NotificationItem. */
  children: ReactNode;
}

/** The divided list of notifications, in a panel or on its own page. */
export function NotificationList({ className, children }: NotificationListProps) {
  return <ul className={cx('pm-notifs', className)}>{children}</ul>;
}

/** What a NotificationItem hands to the element that renders it. */
export interface NotificationItemRenderProps {
  className: string;
  children: ReactNode;
}

export interface NotificationItemProps {
  icon: IconName;
  /** Fills the icon in green, for the notification that asks something of you. */
  accent?: boolean;
  /**
   * Tints the row and shows a dot. The dot is decorative: the caller also puts the
   * word "Unread" in the row, so the state is never colour alone.
   */
  unread?: boolean;
  /** Printed under the text, for example "2 min ago". */
  time?: ReactNode;
  children: ReactNode;
  /** Renders the row's interactive element (a button or a link), spreading the props it is given. */
  render: (props: NotificationItemRenderProps) => ReactElement;
}

export function NotificationItem({ icon, accent, unread, time, children, render }: NotificationItemProps) {
  return render({
    className: cx('pm-notif', unread && 'is-unread'),
    children: (
      <>
        {unread && <span className="pm-notif__dot" aria-hidden="true" />}
        <span className={cx('pm-notif__icon', accent && 'pm-notif__icon--accent')} aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
        <span className="pm-notif__body">
          {children}
          {time !== undefined && <span className="pm-notif__time">{time}</span>}
        </span>
      </>
    ),
  });
}
