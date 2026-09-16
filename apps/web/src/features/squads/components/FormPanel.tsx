/**
 * The Form_Panel — the one surface every form of the Squads_Feature renders
 * inside.
 *
 * The create-squad form, the join-code form, the guest form in both its create
 * and edit modes, and the invite generator all render their fields as this
 * component's children, so the behaviour Requirements 19.7 and 19.8 ask for is
 * written once (design.md → FormPanel and ConfirmDialog):
 *
 *  - **Focus enters on open.** The first focusable element of the surface takes
 *    focus — in practice the form's first field, because the fields are rendered
 *    before the action row.
 *  - **Focus returns on close or dismissal.** Whatever closed the panel: the
 *    cancel control, Escape, or the caller itself after a successful submission.
 *  - **Escape closes without submitting.** No submit handler runs, so no call is
 *    issued on that path.
 *
 * All three come from {@link useSurfaceFocus}, which explains the mechanism and
 * the guards. What this component adds is the markup: a named group, a heading at
 * the level the caller states, the caller's fields, and an action row.
 *
 * ### What it owns, and what the caller keeps
 *
 * | Concern | Owned by |
 * | --- | --- |
 * | Open state | the caller, so a failed submission can keep the panel open with every entered value retained |
 * | Focus entry and return, Escape | this component |
 * | Field markup, labels, validation messages | the caller's form (Requirement 19.9) |
 * | Validation, command building, call issuance | the caller's screen and state hook |
 * | Outcome messages | the caller, rendered as `children` in its own live region (Requirement 17.2) |
 *
 * The panel therefore issues no call, holds no field value, and contains no copy
 * beyond {@link CANCEL_LABEL} — the submit label is the caller's, because only the
 * caller knows what the form does.
 *
 * ### Why a group rather than a form landmark
 *
 * The heading and the `<form>` sit inside a `role="group"` named by the heading,
 * and the `<form>` itself carries no accessible name. A named `<form>` is exposed
 * as a `form` landmark, which would add one landmark per open panel to a screen
 * whose landmark set belongs to the App_Shell frame around it. A named group
 * conveys the same association without joining that set.
 *
 * Requirements: 19.7, 19.8
 */
import { useCallback, useId, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react';

import { CANCEL_LABEL } from '../lib/messages';
import {
  useSurfaceFocus,
  type SurfaceCloseReason,
  type SurfaceHeadingLevel,
} from './surfaceFocus';
import '../styles/squadsTokens.css';
import './surfaces.css';

export interface FormPanelProps {
  /** Whether the panel is open. Owned by the caller, never by this component. */
  readonly open: boolean;
  /**
   * A ref to the control that opened the panel, which receives focus back when
   * the panel closes (Requirement 19.7).
   *
   * A ref rather than a DOM search, because a squads form is opened from
   * somewhere else on the screen — a row action, a section control — and there is
   * no structural relationship from which the opener could be inferred. Must be a
   * stable ref object.
   */
  readonly openerRef: RefObject<HTMLElement | null>;
  /** The heading naming what the form does, rendered as visible text. */
  readonly heading: string;
  /**
   * The heading's level. Defaults to `2`; a panel opened from within a section
   * that already has an `h2` states the next level down, so no screen skips a
   * heading level (Requirements 19.1, 19.2).
   */
  readonly headingLevel?: SurfaceHeadingLevel;
  /** The visible label of the submit control. */
  readonly submitLabel: string;
  /**
   * Called when the form is submitted. Receives no event: the default action is
   * already prevented, so a caller cannot accidentally reload the document.
   */
  readonly onSubmit: () => void;
  /**
   * Called when the panel should close, carrying why (Requirements 19.7, 19.8).
   *
   * Neither reason carries a submission. Because the caller owns `open`, a call it
   * chooses to ignore simply leaves the panel open — and leaves focus inside it.
   */
  readonly onClose: (reason: SurfaceCloseReason) => void;
  /** The form's fields, and any outcome message the caller renders with them. */
  readonly children: ReactNode;
  /**
   * Whether a submission is awaiting a response.
   *
   * Marks the submit control `aria-disabled` and `aria-busy` rather than
   * `disabled`: a genuinely disabled control would drop the keyboard focus of the
   * person who just activated it, and single-flight submission is enforced in the
   * state hook regardless (Requirement 3.5 and its siblings).
   */
  readonly pending?: boolean;
  /** Optional id for the surface element, for a caller's `aria-controls`. */
  readonly id?: string;
  /** Optional extra class for the surface element. */
  readonly className?: string;
}

/** The class every surface of the feature shares; see `surfaces.css`. */
const SURFACE_CLASS = 'squads-surface squads-form-panel';

/**
 * The open panel.
 *
 * Split out so that opening the panel *is* mounting this component: the focus
 * effect in {@link useSurfaceFocus} is then a mount effect and its cleanup is the
 * close, with no `open` dependency to keep the two halves in step.
 */
function OpenFormPanel({
  openerRef,
  heading,
  headingLevel = 2,
  submitLabel,
  onSubmit,
  onClose,
  children,
  pending = false,
  id,
  className,
}: Omit<FormPanelProps, 'open'>): ReactElement {
  const surfaceRef = useSurfaceFocus(openerRef);
  const headingId = useId();
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4' | 'h5';

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== 'Escape') {
        return;
      }

      // 19.8: closes without submitting. Nothing here calls `onSubmit`, and the
      // default action is prevented so a browser-level cancel behaviour cannot
      // reset the fields the caller is retaining. Propagation stops so a panel
      // nested inside another surface closes one surface per keypress.
      event.preventDefault();
      event.stopPropagation();
      onClose('escape');
    },
    [onClose],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      // Always prevented: a squads form submits through the Squads_Api, never
      // through a document navigation.
      event.preventDefault();
      if (pending) {
        // Stated here as well as in the state hook, so the `aria-disabled` the
        // submit control reports is truthful.
        return;
      }
      onSubmit();
    },
    [onSubmit, pending],
  );

  return (
    <div
      ref={surfaceRef}
      id={id}
      className={className === undefined ? SURFACE_CLASS : `${SURFACE_CLASS} ${className}`}
      role="group"
      aria-labelledby={headingId}
      // The fallback focus target for a panel with no focusable control at all;
      // excluded from the focusable selector, so it is never chosen over a field.
      tabIndex={-1}
      data-squads-surface="form-panel"
      onKeyDown={handleKeyDown}
    >
      <Heading id={headingId} className="squads-surface__heading">
        {heading}
      </Heading>
      <form className="squads-surface__body" noValidate onSubmit={handleSubmit}>
        <div className="squads-surface__fields">{children}</div>
        <div className="squads-surface__actions">
          <button
            type="submit"
            className="squads-surface__action squads-surface__action--primary"
            aria-disabled={pending ? true : undefined}
            aria-busy={pending ? true : undefined}
            data-pending={pending ? 'true' : 'false'}
          >
            {submitLabel}
          </button>
          <button
            type="button"
            className="squads-surface__action"
            // 19.7: the same close path as Escape, so dismissal returns focus to
            // the opener too.
            onClick={() => onClose('dismiss')}
          >
            {CANCEL_LABEL}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Render a form inside the feature's shared panel surface.
 *
 * A closed panel renders nothing at all rather than rendering hidden, so its
 * fields are absent from the accessibility tree and from the focus order while it
 * is closed.
 *
 * Requirements: 19.7, 19.8
 */
export function FormPanel({ open, ...rest }: FormPanelProps): ReactElement | null {
  if (!open) {
    return null;
  }

  return <OpenFormPanel {...rest} />;
}

export default FormPanel;
