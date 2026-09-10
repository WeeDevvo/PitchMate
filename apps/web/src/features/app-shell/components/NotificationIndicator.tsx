/**
 * The Notification_Indicator — the Shell_Header control that reports the
 * Unread_Count and discloses the Notification_Panel.
 *
 * It is a real `<button>` and nothing else, so Enter, Space, and a pointer all
 * activate it with no key handling of its own, and it renders as the root element
 * of what the caller passes to {@link Disclosure} as its trigger — which is what
 * lets `Disclosure` find it in the DOM to return focus to on Escape.
 *
 * ### Two carriers of one count
 *
 * The Unread_Badge is a number in the corner of a control; it conveys the count
 * only to someone who can see where it sits. So the count is reported **twice**,
 * from one reading, by the two pure functions in `lib/unreadBadge.ts`
 * (Requirements 4.2–4.5, 7.6):
 *
 * | Carrier | Source | Reports |
 * | --- | --- | --- |
 * | Unread_Badge | {@link unreadBadgeText} | `1`..`99`, `99+`, or no badge at all |
 * | accessible name | {@link notificationIndicatorLabel} | the same count, and whether it covers one squad |
 *
 * Neither piece of formatting is decided here. That matters beyond tidiness: the
 * two carriers agreeing is Property 15, asserted over the pure functions, and it
 * holds for this component because it does no arithmetic and no comparison of its
 * own — it renders what those two functions return for the same `unreadCount`.
 *
 * The badge is `aria-hidden`, since the name already carries the count and an
 * announcement of "Notifications, 3 unread, 3" reports it twice. The count is
 * therefore never *only* on the badge (Requirement 4.5), and never only in the
 * accessible name either — the badge is the visible carrier.
 *
 * The visible word "Notifications" is the start of the accessible name too, so a
 * speech-input user saying "click Notifications" reaches the control (WCAG 2.5.3
 * label in name).
 *
 * ### Operable before the first accepted count (Requirement 4.12)
 *
 * The control is never disabled and never conditional on a count having arrived.
 * The notification centre holds `unreadCount` at 0 until it accepts one
 * (Requirement 4.8), so before the first accepted value — and after a failed one
 * — this renders with no badge, a name stating that nothing is unread, and a
 * working activation that opens the Notification_Panel. There is no loading state
 * here at all, deliberately: a spinner in place of the trigger would make the
 * panel unreachable for as long as the network took.
 *
 * ### Where the values come from
 *
 * Both are read from the one notification state machine through
 * {@link useNotificationCentreContext}, rather than passed in. The frame runs
 * exactly one machine (Requirements 4.1, 4.7), and reading it here means the
 * displayed count cannot be a stale copy threaded through the header's slots. The
 * Squad_Scope is taken from the *centre* rather than from `useSquadScope`
 * directly, because what the name must describe is the scope the count was
 * fetched for — the centre echoes the scope its own calls carry (Requirement 7.6).
 *
 * All presentation comes from `styles/shell.css` via `.shell-badge` and
 * `.shell-notification-indicator`, which resolve `--badge-bg`/`--badge-text` from
 * the theme token table; no colour is written here (Requirements 12.8, 13.4).
 *
 * Requirements: 4.2, 4.3, 4.4, 4.5, 4.12, 7.6
 */
import { type ReactElement } from 'react';

import {
  NOTIFICATIONS_SUBJECT,
  notificationIndicatorLabel,
  unreadBadgeText,
} from '../lib/unreadBadge';
import { useNotificationCentreContext } from '../state/NotificationCentreContext';
import type { DisclosureTriggerProps } from './Disclosure';

/**
 * The props {@link Disclosure} supplies to its trigger, and nothing more.
 *
 * Aliased from `Disclosure`'s own type rather than restated, so the indicator and
 * the primitive that drives it cannot drift apart. Every one of the three is
 * spread onto the `<button>`: `aria-expanded` and `aria-controls` report the
 * panel's state and name the surface programmatically (Requirement 5.1), and
 * `onClick` is the toggle.
 */
export type NotificationIndicatorProps = DisclosureTriggerProps;

/**
 * Render the Notification_Indicator.
 *
 * Requirements: 4.2, 4.3, 4.4, 4.5, 4.12, 7.6
 */
export function NotificationIndicator(
  triggerProps: NotificationIndicatorProps,
): ReactElement {
  // 4.12: 0 until the machine accepts a count, so this renders and operates
  // identically before the first accepted value and after a failed call.
  const { unreadCount, squadScope } = useNotificationCentreContext();

  // 4.2, 4.3, 4.4: the badge's text, or `null` for no badge at all.
  const badge = unreadBadgeText(unreadCount);
  // 4.5, 7.6: the same count, plus its coverage while a Squad_Scope is active.
  const label = notificationIndicatorLabel(unreadCount, squadScope !== null);

  return (
    <button
      type="button"
      className="shell-notification-indicator"
      // 4.5: the name carries the count, so it is perceivable without the badge's
      // visual position. Stated before the spread so a trigger prop is never
      // silently overridden by it — and `DisclosureTriggerProps` carries no name,
      // so nothing here competes.
      aria-label={label}
      {...triggerProps}
    >
      {/* Visible, and the opening words of the accessible name (WCAG 2.5.3). */}
      <span className="shell-notification-indicator__label">
        {NOTIFICATIONS_SUBJECT}
      </span>
      {/*
       * 4.4: no element at all for a count of 0 — not an empty badge.
       * `aria-hidden` because the accessible name already reports this count.
       */}
      {badge === null ? null : (
        <span className="shell-badge" data-unread-badge="true" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
}

export default NotificationIndicator;
