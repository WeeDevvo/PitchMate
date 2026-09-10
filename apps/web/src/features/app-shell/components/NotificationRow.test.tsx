/**
 * Unit tests for one displayed Notification_Record.
 *
 * These cover what the row itself decides — which is deliberately little, because
 * every displayed value comes from a pure function tested beside its own module:
 *
 *   - exactly one keyboard-operable control per record, activated by Enter, by
 *     Space, and by a pointer, with an accessible name containing the record's
 *     title (Requirement 6.11),
 *   - the unread state carried by a word inside that control as well as by the
 *     `data-unread` cue the stylesheet paints as a dot, so colour is never the only
 *     signal (Requirements 5.6, 13.8),
 *   - the truncation indication the row renders from `recordDisplay`'s flags — the
 *     ellipsis and the untruncated value in `title` (Requirement 5.5),
 *   - the type-name fallback for a blank title, the omission of a blank body, and
 *     the neutral label for an uncatalogued Notification_Type, each still carrying
 *     the relative time label and the unread cue (Requirements 5.10, 5.13),
 *   - the relative time label derived from the injected current instant
 *     (Requirement 5.5),
 *   - and that rendering, hovering, and focusing a row issue no activation at all
 *     (Requirement 6.12).
 *
 * The truncation limits, the fallbacks, and the time bands themselves are the
 * property tests' business (`lib/recordDisplay.property.test.ts`,
 * `lib/relativeTime.property.test.ts`); these tests assert only that the row
 * displays what those functions returned rather than re-deriving anything.
 *
 * Feature: app-shell
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationRow, TRUNCATION_INDICATION } from './NotificationRow';
import { UNREAD_STATE_LABEL } from '../lib/messages';
import type { NotificationRecord } from '../lib/notificationParsing';
import {
  BODY_DISPLAY_MAX_LENGTH,
  NEUTRAL_NOTIFICATION_TYPE_LABEL,
  NOTIFICATION_TYPE_LABELS,
  TITLE_DISPLAY_MAX_LENGTH,
} from '../lib/recordDisplay';

/** The creation instant every record below carries: 12 March 2025, 18:00 UTC. */
const CREATED_AT_MS = Date.UTC(2025, 2, 12, 18, 0, 0);

/** Five minutes after the creation instant, so the label lands in the minutes band. */
const NOW_MS = CREATED_AT_MS + 5 * 60_000;

/** A well-formed record; each test overrides only the field it is about. */
function notification(
  overrides: Partial<NotificationRecord> = {},
): NotificationRecord {
  return {
    notificationId: '11111111-1111-4111-8111-111111111111',
    type: { kind: 'catalogued', value: 'match-confirmed' },
    squadId: '22222222-2222-4222-8222-222222222222',
    title: 'Thursday match confirmed',
    body: 'Kick-off 7pm at Goals Sheffield.',
    createdAtMs: CREATED_AT_MS,
    readState: 'unread',
    ...overrides,
  };
}

interface Rendered {
  readonly onActivate: ReturnType<typeof vi.fn>;
  readonly part: (name: string) => HTMLElement | null;
}

function renderRow(
  record: NotificationRecord = notification(),
  nowMs: number = NOW_MS,
): Rendered {
  const onActivate = vi.fn<(notificationId: string) => void>();
  const { container } = render(
    <NotificationRow record={record} nowMs={nowMs} onActivate={onActivate} />,
  );

  return {
    onActivate,
    part: (name) =>
      container.querySelector<HTMLElement>(`.shell-notification-row__${name}`),
  };
}

function control(): HTMLElement {
  return screen.getByRole('button');
}

describe('NotificationRow', () => {
  describe('the control (Requirement 6.11)', () => {
    it('renders exactly one control for one record', () => {
      renderRow();

      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('renders exactly one control per record when several are rendered', () => {
      render(
        <>
          <NotificationRow
            record={notification({
              notificationId: '33333333-3333-4333-8333-333333333333',
              title: 'Teams rolled',
            })}
            nowMs={NOW_MS}
            onActivate={vi.fn()}
          />
          <NotificationRow
            record={notification({ title: 'Thursday match confirmed' })}
            nowMs={NOW_MS}
            onActivate={vi.fn()}
          />
        </>,
      );

      expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it("carries the record's title in its accessible name", () => {
      renderRow();

      expect(
        screen.getByRole('button', { name: /Thursday match confirmed/ }),
      ).toBeInTheDocument();
    });
  });

  describe('the unread cue (Requirements 5.6, 13.8)', () => {
    it('names an unread record with the unread word as well as the dot cue', () => {
      renderRow(notification({ readState: 'unread' }));

      const row = screen.getByRole('button', {
        name: new RegExp(UNREAD_STATE_LABEL),
      });

      // The dot itself is a pseudo-element jsdom does not paint; the attribute it
      // is keyed on is the assertable fact.
      expect(row).toHaveAttribute('data-unread', 'true');
    });

    it('does not name a read record as unread', () => {
      renderRow(notification({ readState: 'read' }));

      expect(
        screen.queryByRole('button', {
          name: new RegExp(UNREAD_STATE_LABEL, 'i'),
        }),
      ).toBeNull();
      expect(control()).toHaveAttribute('data-unread', 'false');
      expect(
        screen.getByRole('button', { name: /Thursday match confirmed/ }),
      ).toBeInTheDocument();
    });
  });

  describe('truncation indications (Requirement 5.5)', () => {
    it('indicates a truncated title and keeps the supplied value reachable', () => {
      const suppliedTitle = 'a'.repeat(TITLE_DISPLAY_MAX_LENGTH + 40);
      const { part } = renderRow(notification({ title: suppliedTitle }));

      const title = part('title');
      expect(title).toHaveTextContent(
        `${'a'.repeat(TITLE_DISPLAY_MAX_LENGTH)}${TRUNCATION_INDICATION}`,
      );
      expect(title).toHaveAttribute('data-truncated', 'true');
      expect(title).toHaveAttribute('title', suppliedTitle);
    });

    it('indicates a truncated body and keeps the supplied value reachable', () => {
      const suppliedBody = 'b'.repeat(BODY_DISPLAY_MAX_LENGTH + 1);
      const { part } = renderRow(notification({ body: suppliedBody }));

      const body = part('body');
      expect(body).toHaveTextContent(
        `${'b'.repeat(BODY_DISPLAY_MAX_LENGTH)}${TRUNCATION_INDICATION}`,
      );
      expect(body).toHaveAttribute('data-truncated', 'true');
      expect(body).toHaveAttribute('title', suppliedBody);
    });

    it('indicates no truncation on values within the display limits', () => {
      const { part } = renderRow();

      expect(part('title')).toHaveAttribute('data-truncated', 'false');
      expect(part('title')).not.toHaveAttribute('title');
      expect(part('body')).toHaveAttribute('data-truncated', 'false');
      expect(part('title')).toHaveTextContent('Thursday match confirmed');
      expect(part('body')).toHaveTextContent('Kick-off 7pm at Goals Sheffield.');
    });
  });

  describe('blank and uncatalogued values (Requirements 5.10, 5.13)', () => {
    it('displays the type name once in place of a whitespace-only title', () => {
      const { part } = renderRow(notification({ title: '   \t\n  ' }));

      const typeName = NOTIFICATION_TYPE_LABELS['match-confirmed'];
      expect(part('title')).toHaveTextContent(typeName);
      // Said once, not twice: the separate type indication is redundant here.
      expect(part('type')).toBeNull();
      // 5.13: the time label and the unread cue are still displayed.
      expect(part('time')).toHaveTextContent('5 minutes ago');
      expect(control()).toHaveAttribute('data-unread', 'true');
    });

    it('omits the body of a whitespace-only body', () => {
      const { part } = renderRow(notification({ body: '     ' }));

      expect(part('body')).toBeNull();
      expect(part('title')).toHaveTextContent('Thursday match confirmed');
      expect(part('time')).toHaveTextContent('5 minutes ago');
    });

    it('omits the body of an empty body', () => {
      const { part } = renderRow(notification({ body: '' }));

      expect(part('body')).toBeNull();
    });

    it('displays a neutral label for an uncatalogued type, title and body unchanged', () => {
      const { part } = renderRow(
        notification({ type: { kind: 'unrecognised', code: 42 } }),
      );

      expect(part('type')).toHaveTextContent(NEUTRAL_NOTIFICATION_TYPE_LABEL);
      expect(control()).toHaveAttribute('data-type-recognised', 'false');
      expect(part('title')).toHaveTextContent('Thursday match confirmed');
      expect(part('body')).toHaveTextContent('Kick-off 7pm at Goals Sheffield.');
      // No integer code is disclosed anywhere in the row.
      expect(control().textContent).not.toContain('42');
    });

    it('displays the catalogued type name for a catalogued type', () => {
      const { part } = renderRow();

      expect(part('type')).toHaveTextContent(
        NOTIFICATION_TYPE_LABELS['match-confirmed'],
      );
      expect(control()).toHaveAttribute('data-type-recognised', 'true');
    });
  });

  describe('the relative time label (Requirement 5.5)', () => {
    it('displays the label for the injected current instant', () => {
      const { part } = renderRow(notification(), CREATED_AT_MS + 3 * 3_600_000);

      expect(part('time')).toHaveTextContent('3 hours ago');
    });

    it('displays the calendar date for a record a week or more old', () => {
      const { part } = renderRow(
        notification(),
        CREATED_AT_MS + 8 * 24 * 3_600_000,
      );

      expect(part('time')).toHaveTextContent('12 Mar 2025');
    });
  });

  describe('activation (Requirements 6.11, 6.12)', () => {
    it('reports one activation for a pointer activation', async () => {
      const user = userEvent.setup();
      const { onActivate } = renderRow();

      await user.click(control());

      expect(onActivate.mock.calls).toEqual([
        ['11111111-1111-4111-8111-111111111111'],
      ]);
    });

    it('reports one activation for the Enter key', async () => {
      const user = userEvent.setup();
      const { onActivate } = renderRow();

      control().focus();
      await user.keyboard('{Enter}');

      expect(onActivate.mock.calls).toEqual([
        ['11111111-1111-4111-8111-111111111111'],
      ]);
    });

    it('reports one activation for the Space key', async () => {
      const user = userEvent.setup();
      const { onActivate } = renderRow();

      control().focus();
      await user.keyboard('[Space]');

      expect(onActivate.mock.calls).toEqual([
        ['11111111-1111-4111-8111-111111111111'],
      ]);
    });

    it('is reachable by keyboard alone', async () => {
      const user = userEvent.setup();
      const { onActivate } = renderRow();

      await user.tab();
      expect(control()).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('reports an activation of an already-read record, deciding nothing itself', async () => {
      const user = userEvent.setup();
      const { onActivate } = renderRow(notification({ readState: 'read' }));

      await user.click(control());

      // 6.3 is the notification centre's rule, not the row's: the row reports the
      // activation and holds no view of the live displayed state.
      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('reports no activation from rendering, hovering, or focusing', async () => {
      const user = userEvent.setup();
      const { onActivate } = renderRow();

      expect(onActivate).not.toHaveBeenCalled();

      await user.hover(control());
      expect(onActivate).not.toHaveBeenCalled();

      await user.tab();
      expect(control()).toHaveFocus();
      expect(onActivate).not.toHaveBeenCalled();

      await user.unhover(control());
      control().blur();
      expect(onActivate).not.toHaveBeenCalled();
    });
  });
});
