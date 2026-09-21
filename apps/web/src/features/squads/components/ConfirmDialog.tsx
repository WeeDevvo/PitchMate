/**
 * The Confirm_Dialog — the one surface every confirmation of the Squads_Feature
 * renders inside.
 *
 * Revoking an invite (Requirement 11.10) and promoting a member to admin
 * (Requirement 13.4) both ask before acting, and both ask through this component,
 * so the behaviour Requirements 19.7 and 19.8 describe is written once
 * (design.md → FormPanel and ConfirmDialog):
 *
 *  - **Focus enters on open**, on the first focusable element of the surface.
 *  - **Focus returns on close or dismissal**, to the control that opened it —
 *    which matters more here than anywhere else in the feature, because the opener
 *    is typically one revoke control among several that read identically, and
 *    landing anywhere else would lose the person's place in the list.
 *  - **Escape closes without confirming.** `onConfirm` is not called on that path,
 *    so no call is issued.
 *
 * All three come from {@link useSurfaceFocus}. What this component adds is the
 * markup and the ordering of the two controls.
 *
 * ### The dismiss control comes first
 *
 * Cancel is rendered before confirm, so "the first focusable element" of a
 * confirmation is the way *out* of it. Requirement 19.7 is satisfied by either
 * order; this one is chosen because a confirmation exists to slow down an action
 * that is awkward to undo, and a surface that opens with the destructive control
 * already focused hands an accidental Space or Enter straight through to it.
 *
 * ### `role="dialog"` without `aria-modal`
 *
 * The surface is named by its heading and described by its statement, so assistive
 * technology announces both on entry. It is deliberately *not* `aria-modal`: this
 * component confines no focus, and Tab leaves it exactly as it leaves the
 * App_Shell's disclosures. Claiming modality while allowing focus to wander would
 * misdescribe the surface, and a focus trap is not what 19.7 or 19.8 ask for.
 *
 * ### What it owns, and what the caller keeps
 *
 * The dialog issues no call, holds no state, and contains no copy beyond
 * {@link CANCEL_LABEL}. The statement — which names the player being promoted or
 * the invite being revoked — is the caller's `children`, because a fixed message
 * takes no interpolation parameter by design (`lib/messages.ts`), so naming a
 * player is a matter of composing nodes rather than formatting a string.
 *
 * Requirements: 19.7, 19.8
 */
import { useCallback, useId, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react';

import { CANCEL_LABEL } from '../lib/messages';
import {
  useSurfaceFocus,
  type SurfaceCloseReason,
  type SurfaceHeadingLevel,
} from './surfaceFocus';
import '../styles/squadsTokens.css';
import './surfaces.css';

export interface ConfirmDialogProps {
  /** Whether the dialog is open. Owned by the caller, never by this component. */
  readonly open: boolean;
  /**
   * A ref to the control that opened the dialog, which receives focus back when
   * the dialog closes (Requirement 19.7). Must be a stable ref object.
   */
  readonly openerRef: RefObject<HTMLElement | null>;
  /** The heading naming the decision being asked for. */
  readonly heading: string;
  /**
   * The heading's level. Defaults to `2`; a confirmation opened from inside a
   * section states the next level down so no screen skips a level (Requirements
   * 19.1, 19.2).
   */
  readonly headingLevel?: SurfaceHeadingLevel;
  /**
   * The statement of what will happen, naming the player or the invite concerned.
   * Associated with the dialog through `aria-describedby`, so it is announced on
   * entry rather than only read by a person who happens to look.
   */
  readonly children: ReactNode;
  /** The visible label of the control that proceeds with the action. */
  readonly confirmLabel: string;
  /** Called when the action is confirmed. Never called by the Escape path. */
  readonly onConfirm: () => void;
  /**
   * Called when the dialog should close, carrying why (Requirements 19.7, 19.8).
   * Neither reason confirms anything.
   */
  readonly onClose: (reason: SurfaceCloseReason) => void;
  /**
   * Whether the confirmed action is awaiting a response.
   *
   * Marks the confirm control `aria-disabled` and `aria-busy` rather than
   * `disabled`, so the focus of the person who just activated it is not dropped
   * mid-operation; single-flight is enforced in the state hook regardless.
   */
  readonly pending?: boolean;
  /** Optional id for the surface element, for a caller's `aria-controls`. */
  readonly id?: string;
  /** Optional extra class for the surface element. */
  readonly className?: string;
}

/** The class every surface of the feature shares; see `surfaces.css`. */
const SURFACE_CLASS = 'squads-surface squads-confirm-dialog';

/**
 * The open dialog.
 *
 * Split out for the same reason the Form_Panel's surface is: opening *is*
 * mounting, so focus entry is a mount effect and focus return is its cleanup.
 */
function OpenConfirmDialog({
  openerRef,
  heading,
  headingLevel = 2,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  pending = false,
  id,
  className,
}: Omit<ConfirmDialogProps, 'open'>): ReactElement {
  const surfaceRef = useSurfaceFocus(openerRef);
  const headingId = useId();
  const statementId = useId();
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4' | 'h5';

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== 'Escape') {
        return;
      }

      // 19.8: closes without confirming. Nothing here calls `onConfirm`.
      // Propagation stops so a dialog opened from inside a Form_Panel closes one
      // surface per keypress.
      event.preventDefault();
      event.stopPropagation();
      onClose('escape');
    },
    [onClose],
  );

  const handleConfirm = useCallback((): void => {
    if (pending) {
      // Keeps the `aria-disabled` the control reports truthful.
      return;
    }
    onConfirm();
  }, [onConfirm, pending]);

  return (
    <div
      ref={surfaceRef}
      id={id}
      className={className === undefined ? SURFACE_CLASS : `${SURFACE_CLASS} ${className}`}
      role="dialog"
      aria-labelledby={headingId}
      aria-describedby={statementId}
      // The fallback focus target for a dialog with no focusable control; excluded
      // from the focusable selector, so a control is always preferred.
      tabIndex={-1}
      data-squads-surface="confirm-dialog"
      onKeyDown={handleKeyDown}
    >
      <Heading id={headingId} className="squads-surface__heading">
        {heading}
      </Heading>
      <div className="squads-surface__body">
        <div id={statementId} className="squads-surface__statement">
          {children}
        </div>
        <div className="squads-surface__actions">
          <button
            type="button"
            className="squads-surface__action"
            // 19.7: the same close path as Escape, so dismissal returns focus to
            // the opener too. Rendered first, so the way out is what focus lands
            // on when the dialog opens.
            onClick={() => onClose('dismiss')}
          >
            {CANCEL_LABEL}
          </button>
          <button
            type="button"
            className="squads-surface__action squads-surface__action--primary"
            aria-disabled={pending ? true : undefined}
            aria-busy={pending ? true : undefined}
            data-pending={pending ? 'true' : 'false'}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Render a confirmation inside the feature's shared dialog surface.
 *
 * A closed dialog renders nothing at all rather than rendering hidden, so neither
 * of its controls is reachable — or announced — while it is closed.
 *
 * Requirements: 19.7, 19.8
 */
export function ConfirmDialog({ open, ...rest }: ConfirmDialogProps): ReactElement | null {
  if (!open) {
    return null;
  }

  return <OpenConfirmDialog {...rest} />;
}

export default ConfirmDialog;
