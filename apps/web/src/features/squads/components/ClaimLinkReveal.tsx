/**
 * The one-time reveal of a guest-claim link: the link, when it expires, a copy
 * control and a dismiss control, with the statement that it is shown once.
 *
 * It follows the `InviteReveal` rules: focus moves into the surface when it
 * opens and back to the control that opened it when it closes; the link is
 * ordinary selectable text, so copying by hand still works when the clipboard
 * doesn't; the copy outcome is announced in place; and the only state held here
 * is that fixed outcome message, never the link, which the claim machine drops
 * when this is dismissed.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactElement, type RefObject } from 'react';

import { LiveRegion } from '../../auth';
import { writeToClipboard } from './clipboard';
import { useSurfaceFocus, type SurfaceHeadingLevel } from './surfaceFocus';
import { formatInviteInstant, inviteInstantAttribute } from '../lib/inviteInstant';
import {
  CLAIM_LINK_COPIED,
  CLAIM_LINK_EXPIRES_LABEL,
  CLAIM_LINK_LABEL,
  CLAIM_REVEAL_HEADING,
  CLAIM_SHOWN_ONCE,
  COPY_CLAIM_LINK_LABEL,
  DISMISS_INVITE_REVEAL_LABEL,
  INVITE_LINK_COPY_FAILED,
} from '../lib/messages';
import type { IssuedClaimLink } from '../lib/parse/guestClaim';

import '../styles/squadsTokens.css';
import './surfaces.css';
import './InviteReveal.css';

export const CLAIM_LINK_REVEAL_SELECTOR = '[data-squads-claim-reveal="true"]';

export interface ClaimLinkRevealProps {
  readonly link: IssuedClaimLink;
  /** The control that opened the reveal, which gets focus back when it closes. */
  readonly openerRef: RefObject<HTMLElement | null>;
  readonly onDismiss: () => void;
  readonly headingLevel?: SurfaceHeadingLevel;
}

export function ClaimLinkReveal({
  link,
  openerRef,
  onDismiss,
  headingLevel = 5,
}: ClaimLinkRevealProps): ReactElement {
  const surfaceRef = useSurfaceFocus(openerRef);
  const headingId = useId();
  const linkLabelId = useId();
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4' | 'h5';
  const [copyOutcome, setCopyOutcome] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleCopy = useCallback((): void => {
    setCopyOutcome(null);
    void writeToClipboard(link.redeemableLink).then((copied) => {
      if (mountedRef.current) {
        setCopyOutcome(copied ? CLAIM_LINK_COPIED : INVITE_LINK_COPY_FAILED);
      }
    });
  }, [link.redeemableLink]);

  return (
    <div
      ref={surfaceRef}
      className="squads-surface squads-invite-reveal"
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-squads-claim-reveal="true"
    >
      <Heading id={headingId} className="squads-surface__heading">
        {CLAIM_REVEAL_HEADING}
      </Heading>

      <div className="squads-surface__body">
        <p className="squads-surface__statement">{CLAIM_SHOWN_ONCE}</p>

        <div className="squads-invite-reveal__values">
          <div className="squads-invite-reveal__value">
            <span id={linkLabelId} className="squads-invite-reveal__label">
              {CLAIM_LINK_LABEL}
            </span>
            <a
              className="squads-invite-reveal__link"
              href={link.redeemableLink}
              aria-describedby={linkLabelId}
              data-squads-claim-link="true"
            >
              {link.redeemableLink}
            </a>
          </div>
          <p className="squads-surface__statement">
            {CLAIM_LINK_EXPIRES_LABEL}{' '}
            <time dateTime={inviteInstantAttribute(link.expiresAtMs)}>
              {formatInviteInstant(link.expiresAtMs)}
            </time>
          </p>
        </div>

        <div className="squads-surface__actions">
          <button
            type="button"
            className="squads-surface__action squads-surface__action--primary"
            onClick={handleCopy}
            data-squads-claim-copy="true"
          >
            {COPY_CLAIM_LINK_LABEL}
          </button>
          <button
            type="button"
            className="squads-surface__action"
            onClick={onDismiss}
            data-squads-claim-dismiss="true"
          >
            {DISMISS_INVITE_REVEAL_LABEL}
          </button>
        </div>

        <LiveRegion message={copyOutcome} />
      </div>
    </div>
  );
}

export default ClaimLinkReveal;
