/**
 * The Invite_Reveal — the one surface that ever presents an Invite_Secret, and it
 * presents it once.
 *
 * `GenerateInvite` is the only response in the feature carrying a redeemable
 * value: the backend stores a one-way hash, so the Invite_Link and Invite_Code it
 * returns cannot be read again by anybody, including the admin who generated
 * them. This component is therefore deliberately **transient** (design.md →
 * InviteManager and InviteReveal): it is mounted *because* `useInviteManager`
 * holds a reveal, receives both values as props, and is unmounted the moment that
 * reveal state is cleared — on dismissal, on the next generate activation, and on
 * unmount of the Squad_Route.
 *
 * ### What makes the values unrecoverable (Requirement 11.7)
 *
 * The mechanism is an absence, stated in four parts, all of which are visible in
 * this file:
 *
 * 1. **No storage.** Nothing here touches `localStorage`, `sessionStorage`, a
 *    cookie, `IndexedDB`, or the URL. A source scan of this module finds no
 *    storage call at all, which is what Property 29 asserts.
 * 2. **No retained copy.** Neither value is put into state, a ref, or a memo.
 *    Every use reads the prop directly, so when the props go, so do the values —
 *    the only place they live is `useInviteManager`'s reveal state, and that hook
 *    clears it.
 * 3. **No log.** No `console` call anywhere, including on the copy-failure path,
 *    where the temptation to log the value is greatest.
 * 4. **No message carries them.** The copy outcomes come from `lib/messages.ts`
 *    and take no interpolation parameter, so neither the announcement nor any
 *    failure text can echo a secret back (Requirement 17.2).
 *
 * ### The shareable address is the backend's, unmodified (Requirement 11.8)
 *
 * The backend returns `redeemableLink` already shaped as `/join/{token}` — the
 * feature's own Invite_Landing_Route — so this component neither builds nor
 * rewrites an address. It presents that exact string as the link's text *and* its
 * `href`, and the copy control copies that same string, which is what makes
 * "opening it resolves to the Invite_Landing_Route" a property of the value rather
 * than of a construction performed here.
 *
 * ### Focus, and why it borrows the surfaces' focus module
 *
 * The reveal appears in response to a person activating a control, and its whole
 * purpose is to be acted on — copied — so focus enters it on mount and returns to
 * the control that produced it on unmount, through the same
 * {@link useSurfaceFocus} the Form_Panel and Confirm_Dialog use. It confines no
 * focus and claims no modality, exactly as they do not.
 *
 * The copy control is rendered before the dismiss control, so the first focusable
 * element is the act the surface exists for — the opposite ordering to the
 * Confirm_Dialog, whose first focusable element is deliberately the way out.
 *
 * Requirements: 11.6, 11.7, 11.8
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';

import { LiveRegion } from '../../auth';
import {
  COPY_INVITE_LINK_LABEL,
  DISMISS_INVITE_REVEAL_LABEL,
  INVITE_CODE_LABEL,
  INVITE_LINK_COPIED,
  INVITE_LINK_COPY_FAILED,
  INVITE_LINK_LABEL,
  INVITE_REVEAL_HEADING,
  INVITE_SHOWN_ONCE,
} from '../lib/messages';
import { useSurfaceFocus, type SurfaceHeadingLevel } from './surfaceFocus';
import '../styles/squadsTokens.css';
import './surfaces.css';
import './InviteReveal.css';

/**
 * The selector of the reveal surface, so a test can assert its presence — and,
 * more importantly, its absence after dismissal — without depending on copy.
 */
export const INVITE_REVEAL_SELECTOR = '[data-squads-invite-reveal="true"]';

/** The selector of the presented shareable address (Requirements 11.6, 11.8). */
export const INVITE_REVEAL_LINK_SELECTOR = '[data-squads-invite-link="true"]';

/** The selector of the presented Invite_Code (Requirement 11.6). */
export const INVITE_REVEAL_CODE_SELECTOR = '[data-squads-invite-code="true"]';

/** The selector of the control that copies the Invite_Link (Requirement 11.6). */
export const INVITE_REVEAL_COPY_SELECTOR = '[data-squads-invite-copy="true"]';

/** The selector of the control that dismisses the reveal (Requirement 11.7). */
export const INVITE_REVEAL_DISMISS_SELECTOR = '[data-squads-invite-dismiss="true"]';

/** The id of the copy outcome live region, so a caller can reference it. */
export const INVITE_REVEAL_OUTCOME_REGION_ID = 'squads-invite-reveal-outcome';

export interface InviteRevealProps {
  /**
   * The backend's `redeemableLink`, presented and copied exactly as returned
   * (Requirement 11.8). Never rewritten, re-based, or re-encoded here.
   */
  readonly redeemableLink: string;
  /** The Invite_Code, presented beside the link (Requirement 11.6). */
  readonly code: string;
  /**
   * The control that produced this reveal — the invite generator's submit or
   * opener control — which receives focus back when the reveal is dismissed
   * (Requirement 19.7).
   */
  readonly openerRef: RefObject<HTMLElement | null>;
  /**
   * Discard the reveal (Requirement 11.7).
   *
   * Wired to `useInviteManager`'s `dismissReveal`, which clears the one place
   * either value is held. This component keeps nothing of its own to clear.
   */
  readonly onDismiss: () => void;
  /**
   * The heading's level. Defaults to `4`: the reveal renders inside the
   * Admin_Section's invites subsection, which is introduced by an `h3`, so no
   * level is skipped (Requirements 19.1, 19.2).
   */
  readonly headingLevel?: SurfaceHeadingLevel;
}

/** The class every surface of the feature shares; see `surfaces.css`. */
const SURFACE_CLASS = 'squads-surface squads-invite-reveal';

/**
 * Put a string on the clipboard, reporting only whether it got there.
 *
 * Returns a promise that never rejects, so the caller has one settled answer
 * rather than two paths. The value is passed straight through and appears in no
 * message either way (Requirement 11.7).
 *
 * A clipboard is absent in more situations than a failure: an insecure context, a
 * permission the person declined, an older engine, and a test environment without
 * the API. All of them arrive here as the same `false`, and the failure copy tells
 * the person to select the link by hand — which is possible because the link is
 * rendered as ordinary selectable text.
 */
async function writeToClipboard(value: string): Promise<boolean> {
  try {
    const clipboard: Clipboard | undefined = navigator.clipboard;

    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      return false;
    }

    await clipboard.writeText(value);
    return true;
  } catch {
    // Deliberately swallowed rather than logged: a rejection reason here could
    // carry the value that was being written (Requirement 11.7).
    return false;
  }
}

/**
 * Render the Invite_Reveal: the generated link and code, a control that copies the
 * link, the statement that the values are shown once, and a dismiss control.
 *
 * Requirements: 11.6, 11.7, 11.8
 */
export function InviteReveal({
  redeemableLink,
  code,
  openerRef,
  onDismiss,
  headingLevel = 4,
}: InviteRevealProps): ReactElement {
  const surfaceRef = useSurfaceFocus(openerRef);
  const headingId = useId();
  const linkLabelId = useId();
  const codeLabelId = useId();
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4' | 'h5';

  /**
   * The outcome of the last copy activation — one of two fixed messages, or `null`
   * before any activation.
   *
   * The *only* state this component holds, and it holds neither secret: both
   * messages are constants from `lib/messages.ts`.
   */
  const [copyOutcome, setCopyOutcome] = useState<string | null>(null);

  /** Closed on unmount, so a clipboard promise settling late applies nothing. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleCopy = useCallback((): void => {
    // A fresh activation clears the previous outcome, so a stale "copied" cannot
    // sit beside a failed attempt.
    setCopyOutcome(null);

    void writeToClipboard(redeemableLink).then((copied) => {
      if (!mountedRef.current) {
        return;
      }

      setCopyOutcome(copied ? INVITE_LINK_COPIED : INVITE_LINK_COPY_FAILED);
    });
  }, [redeemableLink]);

  return (
    <div
      ref={surfaceRef}
      className={SURFACE_CLASS}
      role="group"
      aria-labelledby={headingId}
      // The fallback focus target, excluded from the focusable selector so a
      // control is always preferred.
      tabIndex={-1}
      data-squads-invite-reveal="true"
    >
      <Heading id={headingId} className="squads-surface__heading">
        {INVITE_REVEAL_HEADING}
      </Heading>

      <div className="squads-surface__body">
        {/* 11.6: the statement in text that the values are shown once. Rendered
            above them, so it is read before the values are acted on. */}
        <p className="squads-surface__statement">{INVITE_SHOWN_ONCE}</p>

        <div className="squads-invite-reveal__values">
          <div className="squads-invite-reveal__value">
            {/* 11.6: a persistently visible label, associated with the value it
                names rather than merely sitting above it. */}
            <span id={linkLabelId} className="squads-invite-reveal__label">
              {INVITE_LINK_LABEL}
            </span>
            {/* 11.8: the backend's `redeemableLink` as returned, presented as both
                the text and the address — so opening it resolves to the
                Invite_Landing_Route for this invite. */}
            <a
              className="squads-invite-reveal__link"
              href={redeemableLink}
              aria-describedby={linkLabelId}
              data-squads-invite-link="true"
            >
              {redeemableLink}
            </a>
          </div>

          <div className="squads-invite-reveal__value">
            <span id={codeLabelId} className="squads-invite-reveal__label">
              {INVITE_CODE_LABEL}
            </span>
            <code
              className="squads-invite-reveal__code"
              aria-describedby={codeLabelId}
              data-squads-invite-code="true"
            >
              {code}
            </code>
          </div>
        </div>

        <div className="squads-surface__actions">
          {/* 11.6: the copy control. First in document order, so focus lands on
              the act this surface exists for. */}
          <button
            type="button"
            className="squads-surface__action squads-surface__action--primary"
            onClick={handleCopy}
            data-squads-invite-copy="true"
          >
            {COPY_INVITE_LINK_LABEL}
          </button>

          {/* 11.7: dismissal. The values are discarded by the hook that holds
              them; this component unmounts and retains nothing. */}
          <button
            type="button"
            className="squads-surface__action"
            onClick={onDismiss}
            data-squads-invite-dismiss="true"
          >
            {DISMISS_INVITE_REVEAL_LABEL}
          </button>
        </div>

        {/* The copy outcome, announced where it appears without moving focus.
            Always present, so a message inserted later is announced. */}
        <LiveRegion id={INVITE_REVEAL_OUTCOME_REGION_ID} message={copyOutcome} />
      </div>
    </div>
  );
}

export default InviteReveal;
