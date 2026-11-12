/**
 * The Claim_Landing_Route — `/claim/:code`: where a guest-claim link opens
 * (ADR 0003). Like the Invite_Landing_Route it sits outside the Route_Guard and
 * the App_Shell frame, so a signed-out player is sent to log in or sign up and
 * brought straight back, the secret still in the path.
 *
 * | State | Rendered beneath the `h1` |
 * | --- | --- |
 * | the path carries no readable secret | {@link CLAIM_LINK_INCOMPLETE} and the way to the Squads_Home |
 * | signed out | the instruction, and the sign-up and log-in controls |
 * | reading the link, or accepting | the busy indication alone |
 * | ready | the guest and squad the link is for, what accepting does, and Accept |
 * | accepted | the statement that an admin will confirm it, and the way to the Squads_Home |
 * | unusable | {@link CLAIM_UNUSABLE} and the way to the Squads_Home |
 * | failed | the generic failure, a retry, and the way to the Squads_Home |
 *
 * The secret is read from the rendered path by the same rules as an invite's,
 * sent only in request bodies, and never rendered: not in a message, an
 * attribute, or anywhere but the redirect value, which is the path it was
 * already part of.
 */

import { useId, useMemo, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { Icon, Logo, buttonClasses } from '../../../ui';
import { HOME_ROUTE } from '../../app-shell';
import { LOG_IN_ROUTE, REDIRECT_PARAM_NAME, SIGN_UP_ROUTE, useAuth } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import { FailureNotice } from '../components/FailureNotice';
import { LoadingIndication } from '../components/LoadingIndication';
import { extractClaimSecretFromPath } from '../lib/inviteSecret';
import {
  ACCEPT_CLAIM_LABEL,
  CLAIM_ACCEPTED_STATEMENT,
  CLAIM_ACCEPTING_LABEL,
  CLAIM_LANDING_HEADING,
  CLAIM_LINK_INCOMPLETE,
  CLAIM_LOG_IN_LABEL,
  CLAIM_PREVIEW_EXPLANATION,
  CLAIM_PREVIEW_GUEST_LABEL,
  CLAIM_PREVIEW_SQUAD_LABEL,
  CLAIM_PREVIEWING_LABEL,
  CLAIM_SIGN_IN_INSTRUCTION,
  CLAIM_SIGN_UP_LABEL,
  CLAIM_UNUSABLE,
  INVITE_REDEEM_RETRY_LABEL,
  SQUADS_HOME_CONTROL_LABEL,
} from '../lib/messages';
import { useClaimAcceptance } from '../state/useClaimAcceptance';

import '../styles/squadsTokens.css';
import './InviteLandingScreen.css';
import './ClaimLandingScreen.css';

export const CLAIM_LANDING_SELECTOR = '[data-squads-claim-landing="true"]';

/** An Auth_Feature route carrying the path to come back to, encoded as the invite landing does. */
function handoverTarget(route: string, requestedPath: string): string {
  const query = new URLSearchParams();
  query.set(REDIRECT_PARAM_NAME, requestedPath);
  return `${route}?${query.toString()}`;
}

export interface ClaimLandingScreenProps {
  readonly api: SquadsApi;
}

/** The body for a readable secret, driven by the acceptance machine. */
function ClaimLandingBody({
  api,
  secret,
  requestedPath,
}: {
  readonly api: SquadsApi;
  readonly secret: string;
  readonly requestedPath: string;
}): ReactElement {
  const { state: authState } = useAuth();
  const machine = useClaimAcceptance(api, secret, authState);

  const home = (
    <Link className={`squads-invite-landing__home ${buttonClasses({ variant: 'secondary', block: true })}`} to={HOME_ROUTE}>
      <Icon name="home" size={18} />
      {SQUADS_HOME_CONTROL_LABEL}
    </Link>
  );

  switch (machine.phase) {
    case 'signed-out':
      return (
        <div className="squads-invite-landing__handover">
          <p className="squads-invite-landing__message">{CLAIM_SIGN_IN_INSTRUCTION}</p>
          <div className="squads-invite-landing__controls">
            <Link className={`squads-invite-landing__control ${buttonClasses({ size: 'lg', block: true })}`} to={handoverTarget(SIGN_UP_ROUTE, requestedPath)}>
              {CLAIM_SIGN_UP_LABEL}
            </Link>
            <Link className={`squads-invite-landing__control ${buttonClasses({ variant: 'secondary', size: 'lg', block: true })}`} to={handoverTarget(LOG_IN_ROUTE, requestedPath)}>
              {CLAIM_LOG_IN_LABEL}
            </Link>
          </div>
        </div>
      );

    case 'previewing':
      return <LoadingIndication label={CLAIM_PREVIEWING_LABEL} />;

    case 'accepting':
      return <LoadingIndication label={CLAIM_ACCEPTING_LABEL} />;

    case 'ready':
      return (
        <div className="squads-invite-landing__handover" data-squads-claim-preview="true">
          <dl className="squads-claim-landing__preview">
            <dt>{CLAIM_PREVIEW_GUEST_LABEL}</dt>
            <dd>{machine.preview?.guestDisplayName}</dd>
            <dt>{CLAIM_PREVIEW_SQUAD_LABEL}</dt>
            <dd>{machine.preview?.squadName}</dd>
          </dl>
          <p className="squads-invite-landing__message">{CLAIM_PREVIEW_EXPLANATION}</p>
          <div className="squads-invite-landing__controls">
            <button
              type="button"
              className={`squads-invite-landing__control ${buttonClasses({ size: 'lg', block: true })}`}
              data-squads-claim-accept="true"
              onClick={machine.accept}
            >
              <Icon name="check" size={18} />
              {ACCEPT_CLAIM_LABEL}
            </button>
          </div>
        </div>
      );

    case 'accepted':
      return (
        <div className="squads-invite-landing__outcome">
          <p className="squads-invite-landing__message" role="status">
            {CLAIM_ACCEPTED_STATEMENT}
          </p>
          {home}
        </div>
      );

    case 'unusable':
      return (
        <div className="squads-invite-landing__outcome">
          <p className="squads-invite-landing__message" role="status">
            {CLAIM_UNUSABLE}
          </p>
          {home}
        </div>
      );

    case 'failed':
      return (
        <FailureNotice retryLabel={INVITE_REDEEM_RETRY_LABEL} onRetry={machine.retry}>
          {home}
        </FailureNotice>
      );
  }
}

export function ClaimLandingScreen({ api }: ClaimLandingScreenProps): ReactElement {
  const location = useLocation();
  const headingId = useId();
  const requestedPath = location.pathname;
  const extraction = useMemo(() => extractClaimSecretFromPath(requestedPath), [requestedPath]);

  return (
    <div className="squads-invite-landing" data-squads-claim-landing="true">
      <Logo size={34} />
      <section className="squads-invite-landing__surface" aria-labelledby={headingId}>
        <span className="squads-invite-landing__art" aria-hidden="true">
          <Icon name="guest" size={44} strokeWidth={1.8} />
        </span>
        <h1 id={headingId} className="squads-invite-landing__heading">
          {CLAIM_LANDING_HEADING}
        </h1>
        {extraction.ok ? (
          <ClaimLandingBody
            key={extraction.secret}
            api={api}
            secret={extraction.secret}
            requestedPath={requestedPath}
          />
        ) : (
          <div className="squads-invite-landing__outcome">
            <p className="squads-invite-landing__message">{CLAIM_LINK_INCOMPLETE}</p>
            <Link className={`squads-invite-landing__home ${buttonClasses({ variant: 'secondary', block: true })}`} to={HOME_ROUTE}>
              <Icon name="home" size={18} />
              {SQUADS_HOME_CONTROL_LABEL}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

export default ClaimLandingScreen;
