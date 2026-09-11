/**
 * One displayed Notification_Record, rendered as exactly one control.
 *
 * Requirement 6.11 fixes the shape of this component precisely: the activation
 * target of each displayed Notification_Record is **exactly one** keyboard-operable
 * control, reachable by keyboard alone, carrying an accessible name that contains
 * that record's title, and activated by Enter, by Space, and by a pointer. A
 * native `<button>` is that control, and it is the component's root element — so
 * "exactly one control per record" holds structurally rather than by a reviewer
 * counting nested interactive elements. Enter and Space come from the button
 * element itself; no key handler is written here, because a hand-rolled one is how
 * a control ends up honouring one key and not the other.
 *
 * The row renders no list wrapper. The `<ul>`/`<li>` structure belongs to the
 * Notification_Panel (task 11.3) and the Notifications_Destination content (task
 * 11.5), which is what lets both surfaces present the same row inside their own
 * markup, and keeps this component free of any decision about how many records
 * exist around it.
 *
 * ### Every displayed value comes from a pure function
 *
 * Nothing about the text is decided here (Requirements 5.5, 5.10, 5.13):
 *
 *  - `lib/recordDisplay.ts` supplies the title, the body, the type label, and the
 *    two truncation flags — so the 120- and 500-character limits, the type-name
 *    fallback for a blank title, the omission of a blank body, and the neutral
 *    label for an unrecognised Notification_Type are all decided in one tested
 *    place rather than re-derived in JSX.
 *  - `lib/relativeTime.ts` supplies the relative time label from the record's
 *    creation instant and the **injected** current instant, which arrives as a
 *    prop precisely so the rendered label is deterministic (Requirement 5.11).
 *    This component never reads the ambient clock.
 *
 * What the row does own is the *presentation* of the truncation indication, which
 * `recordDisplay` deliberately leaves to the presentation layer: a visible
 * ellipsis after the shortened value, plus the untruncated value in a `title`
 * attribute so nothing supplied is unreachable (Requirement 5.5).
 *
 * ### The unread cue is never colour alone
 *
 * `data-unread` drives the filled dot declared in `styles/shell.css`, which is a
 * shape as much as a colour, and the word "Unread" is carried inside the control
 * so it lands in the accessible name. A person who perceives no colour still sees
 * the dot, a person using a screen reader still hears the state, and a person with
 * author colours overridden still gets both (Requirements 5.6, 13.8).
 *
 * ### This row issues no backend call
 *
 * Activation calls the supplied handler and nothing else. The row holds no
 * reference to the Notifications_Api and none to the notification centre, so the
 * only two issuers of a Read_State change remain an explicit activation of a row
 * and an explicit activation of the Mark_All_Read_Control (Requirement 6.12).
 * Rendering, hovering, scrolling into view, and receiving keyboard focus call
 * nothing — there is no handler here for any of them to reach.
 *
 * Activating a record that is already `read` still calls the handler; the
 * notification centre is where that lands as "change nothing, call nothing"
 * (Requirement 6.3), because only it knows the record's live displayed state.
 * Suppressing the call here as well would put the same rule in two places.
 *
 * Requirements: 5.5, 5.6, 5.10, 5.13, 6.11, 6.12, 13.8
 */
import { useCallback, type ReactElement } from 'react';
import { UNREAD_STATE_LABEL } from '../lib/messages';
import type { NotificationRecord } from '../lib/notificationParsing';
import { recordDisplay } from '../lib/recordDisplay';
import { relativeTimeLabel } from '../lib/relativeTime';

/**
 * The visible indication that a displayed value was shortened (Requirement 5.5).
 *
 * A single horizontal-ellipsis character rather than three full stops, so it reads
 * as one glyph and cannot be mistaken for supplied punctuation. `recordDisplay`
 * spends none of the 120- and 500-character budget on it, which is why it is
 * appended here.
 */
export const TRUNCATION_INDICATION = '…';

/** What the Notification_Panel and the Notifications_Destination supply per row. */
export interface NotificationRowProps {
  /** The parsed Notification_Record to display, at its supplied lengths. */
  readonly record: NotificationRecord;
  /**
   * The injected current instant in epoch milliseconds, from which the relative
   * time label is derived (Requirement 5.11).
   */
  readonly nowMs: number;
  /**
   * Called with the record's identity when a person activates the row by Enter,
   * by Space, or by a pointer (Requirement 6.11).
   *
   * The caller decides what an activation means; this row performs no transport
   * (Requirement 6.12).
   */
  readonly onActivate: (notificationId: string) => void;
}

/**
 * Render one displayed value with its truncation indication.
 *
 * The ellipsis sits inside the same element as the text so the two never wrap
 * apart, and the untruncated value goes in `title`. That attribute contributes
 * nothing to the accessible name: name-from-content reads this element's text, and
 * `title` is only a fallback for an element with no content.
 */
function TruncatableText({
  className,
  text,
  truncated,
  supplied,
}: {
  readonly className: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly supplied: string;
}): ReactElement {
  return (
    <span
      className={className}
      data-truncated={truncated ? 'true' : 'false'}
      title={truncated ? supplied : undefined}
    >
      {truncated ? `${text}${TRUNCATION_INDICATION}` : text}
    </span>
  );
}

/**
 * Render one displayed Notification_Record as a single keyboard-operable control.
 *
 * Requirements: 5.5, 5.6, 5.10, 5.13, 6.11, 6.12, 13.8
 */
export function NotificationRow({
  record,
  nowMs,
  onActivate,
}: NotificationRowProps): ReactElement {
  const display = recordDisplay(record);
  const timeLabel = relativeTimeLabel(record.createdAtMs, nowMs);
  const unread = record.readState === 'unread';

  /**
   * 5.13: where the supplied title was blank, `recordDisplay` has already put the
   * type label in its place, so rendering the type indication as well would say
   * the same thing twice — once visibly and once more to a screen reader. This
   * compares two values that function returned rather than re-deciding whether the
   * supplied title was blank, which stays its business.
   */
  const typeIndicationRedundant =
    !display.titleTruncated && display.title === display.typeLabel;

  const handleClick = useCallback((): void => {
    onActivate(record.notificationId);
  }, [onActivate, record.notificationId]);

  return (
    <button
      type="button"
      className="shell-notification-row"
      // 5.6, 13.8: drives the filled dot in `styles/shell.css`, and is the same
      // fact in a form a test can read without measuring a pseudo-element.
      data-unread={unread ? 'true' : 'false'}
      data-notification-id={record.notificationId}
      // 5.10: whether the type was catalogued, for the panel's styling and tests.
      data-type-recognised={display.typeIsRecognised ? 'true' : 'false'}
      onClick={handleClick}
    >
      {/* 5.6, 13.8: the state as a word, so the dot is never the only carrier. */}
      {unread ? (
        <span className="shell-notification-row__state">{UNREAD_STATE_LABEL}</span>
      ) : null}

      {/* The text column beside the dot the stylesheet paints in the row's
          leading gutter. */}
      <span className="shell-notification-row__content">
        {/* 6.11: the record's title, inside the control, so the accessible name
            contains it. */}
        <TruncatableText
          className="shell-notification-row__title"
          text={display.title}
          truncated={display.titleTruncated}
          supplied={record.title}
        />

        {/* 5.13: a blank body is omitted rather than rendered as an empty line. */}
        {display.body === null ? null : (
          <TruncatableText
            className="shell-notification-row__body"
            text={display.body}
            truncated={display.bodyTruncated}
            supplied={record.body}
          />
        )}

        <span className="shell-notification-row__meta">
          {/* 5.10: the type indication, neutral for an uncatalogued type. */}
          {typeIndicationRedundant ? null : (
            <span className="shell-notification-row__type">{display.typeLabel}</span>
          )}
          {/* 5.5, 5.13: always displayed, whatever the title, body, or type. */}
          <span className="shell-notification-row__time">{timeLabel}</span>
        </span>
      </span>
    </button>
  );
}

export default NotificationRow;
