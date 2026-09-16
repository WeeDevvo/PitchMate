/**
 * The Squads_Feature's one failure surface.
 *
 * Every Squads_Api call that fails at the transport layer, reaches the
 * Squad_Call_Timeout, or returns a body the Response_Parser rejects collapses to
 * the same two things: the single {@link GENERIC_SQUADS_FAILURE} message and a
 * manual retry control (Requirements 2.5, 5.13, 6.7, 17.1, 17.4). This component
 * is that pair, so the message is not restated per surface and no surface can
 * quietly add a cause-specific sentence beside it.
 *
 * ### The message is fixed, and the component has no seam for a variable one
 *
 * There is no `message` prop. The copy comes straight from `lib/messages.ts`,
 * which is what makes Requirements 17.1 and 17.2 structural rather than
 * editorial: a caller holding a ProblemDetails body, a status code, or a squad
 * name has nowhere to put it. A transport failure, a lapsed timeout, and an
 * unreadable body are therefore indistinguishable on screen — deliberately, since
 * telling them apart would tell a stranger which squads exist.
 *
 * ### Announced without moving focus
 *
 * The message sits in a `role="status"` live region so it is announced where it
 * appears, leaving keyboard focus where the person left it (Requirement 17.3).
 * The retry control is *outside* that region: a live region announces its own
 * content, and a control's label is not an outcome.
 *
 * ### Retry is a person's act, and it is single-flight
 *
 * `onRetry` is called once per activation and nothing here schedules a further
 * call, so no failure produces repeated calls without a person asking
 * (Requirement 17.4). While a retry is awaiting a response the caller passes
 * `retryBusy`, which marks the control `aria-disabled` and makes activation a
 * no-op — `aria-disabled` rather than `disabled` so the control stays reachable in
 * the keyboard order (Requirement 19.4). The state hooks already treat a second
 * `retry()` as a no-op; this guard means a surface without that discipline cannot
 * issue a second call either.
 *
 * The `children` slot carries any *additional* control the surface needs beside
 * the retry — the Invite_Landing_Route's control to the Squads_Home, for instance
 * (Requirement 5.13). It is a slot rather than a built-in so the Squads_Home,
 * which is already at that destination, does not render a control to itself.
 *
 * Requirements: 2.5, 2.6, 5.13, 6.7, 17.1, 17.2, 17.3, 17.4
 */
import { useCallback, type ReactElement, type ReactNode } from 'react';

import { GENERIC_SQUADS_FAILURE } from '../lib/messages';
import './FailureNotice.css';

/**
 * The selector of the failure region, so a screen test finds this message without
 * confusing it with the loading indication's own `role="status"` region.
 */
export const FAILURE_NOTICE_SELECTOR = '[data-squads-failure="true"]';

export interface FailureNoticeProps {
  /**
   * The visible label of the retry control, supplied by the surface because what
   * is being re-attempted differs per call ("Try again" reads the same, but the
   * accessible name is better for naming the thing retried).
   */
  readonly retryLabel: string;
  /**
   * Issue exactly one further call of the operation that failed. Called once per
   * activation, and never by this component of its own accord.
   */
  readonly onRetry: () => void;
  /**
   * True while a retry is awaiting a response. Marks the control busy and blocks
   * a second activation, without removing it from the keyboard order.
   */
  readonly retryBusy?: boolean;
  /**
   * Any further control the surface offers beside the retry — for example a
   * control to the Squads_Home on the Invite_Landing_Route.
   */
  readonly children?: ReactNode;
}

/**
 * Render the generic failure message in a live region, with a manual retry
 * control beside it.
 *
 * Requirements: 2.5, 2.6, 5.13, 6.7, 17.1, 17.3, 17.4
 */
export function FailureNotice({
  retryLabel,
  onRetry,
  retryBusy = false,
  children,
}: FailureNoticeProps): ReactElement {
  const handleRetry = useCallback((): void => {
    // 17.4: one call per activation by a person, and none while one awaits a
    // response.
    if (retryBusy) {
      return;
    }
    onRetry();
  }, [onRetry, retryBusy]);

  return (
    <div className="squads-failure" data-squads-failure="true">
      {/* 17.1, 17.2: the one fixed message, carrying nothing of the response. */}
      {/* 17.3: announced in place, with keyboard focus left where it was. */}
      <p
        className="squads-failure__message"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {GENERIC_SQUADS_FAILURE}
      </p>

      <div className="squads-failure__actions">
        {/* 2.6, 5.13, 17.4: the manual retry — the only thing that re-issues. */}
        <button
          type="button"
          className="squads-failure__retry"
          aria-disabled={retryBusy ? true : undefined}
          aria-busy={retryBusy ? true : undefined}
          onClick={handleRetry}
        >
          {retryLabel}
        </button>
        {children}
      </div>
    </div>
  );
}

export default FailureNotice;
