/**
 * The Player_Stats_Screen's one failure surface.
 *
 * Every `GetPlayerProfile` call that fails at the transport layer, reaches the
 * Profile_Call_Timeout, or returns a body the Response_Parser rejects collapses
 * to the same two things: the single {@link GENERIC_PROFILE_FAILURE} statement
 * and a manual retry control (Requirements 4.1, 4.2). This component is that
 * pair, so no surface restates the message and none can quietly add a
 * cause-specific sentence beside it.
 *
 * ### The message is fixed, and there is no seam for a variable one
 *
 * There is no `message` prop, no `reason` prop, and no `status` prop. The copy
 * comes straight from `lib/messages.ts`, which is what makes Requirements 3.7
 * and 4.2 structural rather than editorial: a caller holding a rejected
 * response's status, headers, or body has nowhere to put any of it. A transport
 * failure, a lapsed timeout, and an unreadable body are therefore
 * indistinguishable on screen — deliberately, because telling them apart would
 * tell a stranger which squads and players exist.
 *
 * Note what is *not* here: the Not_Found_Treatment. A not-found outcome renders
 * that treatment and never this notice, and no other outcome renders the
 * treatment (Requirement 4.3). The two are separate components precisely so the
 * screen's condition selection has to choose, rather than one component deciding
 * from a flag.
 *
 * ### Announced without moving focus
 *
 * The statement sits in a `role="status"` live region, so it is announced where
 * it appears and keyboard focus stays where the person left it (Requirement
 * 4.6). The retry control is *outside* that region: a live region announces its
 * own content, and a control's label is not an outcome. Where focus was on a
 * control that this notice has replaced, `surfaceFocus.ts` puts it back inside
 * the main content region (Requirement 16.5) — that is a separate mechanism, and
 * it moves focus only when it would otherwise have been dropped.
 *
 * ### Retry is a person's act, and it is single-flight
 *
 * `onRetry` is called once per activation and nothing here schedules a further
 * call, so no failure produces a repeated call without a person asking
 * (Requirement 2.6). While a retry awaits a response the caller passes
 * `retryBusy`, which presents the control as unavailable for further activation
 * and makes activation a no-op (Requirement 4.5). That is `aria-disabled` rather
 * than `disabled`, so the control stays reachable in the keyboard order and a
 * person who has just activated it is not thrown off it (Requirement 16.4). The
 * load machine already treats a second `retry()` as a no-op; this guard means a
 * caller without that discipline cannot issue a second call either.
 *
 * The `children` slot carries any *additional* control the surface needs beside
 * the retry — on this screen, the control back to the squad, which Requirement
 * 4.1's companion in task 11.1 renders in every condition. It is a slot rather
 * than a built-in because this component is handed no squad identity and should
 * not be: the path belongs to the route, and the Not_Found_Treatment is the one
 * boundary surface that owns its own way out.
 *
 * Requirements: 2.6, 4.1, 4.2, 4.4, 4.5, 4.6
 */
import { useCallback, type ReactElement, type ReactNode } from 'react';

import { EmptyState, Icon } from '../../../ui';
import { GENERIC_PROFILE_FAILURE, RETRY_LABEL } from '../lib/messages';
import '../styles/playerStatsTokens.css';
import './surfaces.css';

/**
 * The selector of the failure surface, so a test can assert its whole subtree
 * without confusing its live region with the loading indication's.
 */
export const FAILURE_NOTICE_SELECTOR = '[data-player-stats-failure="true"]';

export interface FailureNoticeProps {
  /**
   * Issue exactly one further `GetPlayerProfile` call for the route's current
   * subject. Called once per activation, and never by this component of its own
   * accord (Requirements 2.6, 2.8).
   */
  readonly onRetry: () => void;
  /**
   * True while a retry awaits a response. Presents the control as unavailable
   * for further activation and blocks a second call, without removing it from
   * the keyboard order (Requirements 4.5, 16.4).
   */
  readonly retryBusy?: boolean;
  /**
   * Any further control the surface offers beside the retry — on this screen,
   * the control back to the squad.
   */
  readonly children?: ReactNode;
}

/**
 * Render the generic profile failure in a live region, with one keyboard-operable
 * retry control beside it.
 *
 * Requirements: 4.1, 4.2, 4.4, 4.5, 4.6
 */
export function FailureNotice({
  onRetry,
  retryBusy = false,
  children,
}: FailureNoticeProps): ReactElement {
  const handleRetry = useCallback((): void => {
    // 4.5, 2.9: one call per activation by a person, and none while one awaits a
    // response.
    if (retryBusy) {
      return;
    }
    onRetry();
  }, [onRetry, retryBusy]);

  return (
    // The design system's error state, with no heading of its own: the screen
    // carries the heading above it.
    <EmptyState
      className="player-stats-failure"
      data-player-stats-failure="true"
      tone="error"
      icon="cloudOff"
      // 4.6: announced in place, with keyboard focus left where it was.
      bodyProps={{
        className: 'player-stats-failure__message',
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': true,
      }}
      action={
        <div className="player-stats-failure__actions">
          {/* 4.4: exactly one retry control, named by its own label, keyboard
              reachable and keyboard operable because it is a real button. */}
          {/* 4.5: presented as unavailable while a retry awaits a response, and
              `aria-disabled` rather than `disabled` so it keeps its place in the
              keyboard order. */}
          <button
            type="button"
            className="player-stats-failure__retry"
            aria-disabled={retryBusy ? true : undefined}
            aria-busy={retryBusy ? true : undefined}
            onClick={handleRetry}
          >
            <Icon name="sync" size={18} />
            {RETRY_LABEL}
          </button>
          {children}
        </div>
      }
    >
      {/* 4.1, 4.2: the one fixed statement, carrying nothing of the response. */}
      {GENERIC_PROFILE_FAILURE}
    </EmptyState>
  );
}

export default FailureNotice;
