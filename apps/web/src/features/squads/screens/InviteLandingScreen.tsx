/**
 * The Invite_Landing_Route — `/join/:code`: the one screen of this feature that a
 * visitor with no account, no session, and no idea what PitchMate is can land on.
 *
 * It sits outside the Route_Guard and outside the App_Shell frame (Requirement
 * 5.1): inside the guard it would bounce to the Log_In_Route and lose the
 * Invite_Secret, and inside the frame it would render authenticated chrome to a
 * stranger. So this screen carries its own `h1` and its own surface, and renders
 * no navigation, no notification surface, and nothing else of the application.
 *
 * Every decision about *which* call is owed, and when, belongs to
 * {@link useInviteRedemption}: the extraction of the Invite_Secret from the
 * rendered path, the one anonymous `PreviewInvite` while there is no session, the
 * at-most-one `RedeemInvite` per rendered path once there is one, and the
 * replacing navigation on success. This file holds no `AbortController`, no
 * timer, and no `api` call site — it composes five surfaces and builds two
 * targets.
 *
 * ### The five surfaces, and why exactly one of them shows
 *
 * | Machine state | Rendered beneath the `h1` |
 * | --- | --- |
 * | `incompleteLink` | {@link INVITE_LINK_INCOMPLETE} and the control to the Squads_Home (5.9) |
 * | `idle` / `previewing` / `handover` | the instruction plus the sign-up and log-in controls (5.2, 5.4, 5.6, 5.14) |
 * | `redeeming` | the busy indication **alone** — neither the instruction nor the controls (5.12) |
 * | `unusable` | {@link INVITE_UNUSABLE} and the control to the Squads_Home (5.10) |
 * | `failed` | the `FailureNotice`, its retry, and the control to the Squads_Home (5.13) |
 *
 * The branches read from the machine's own booleans rather than from its phase, so
 * a phase added later cannot land the screen in two surfaces at once — the machine
 * derives them from one phase and they are mutually exclusive by construction. The
 * `redeemed` phase renders none of the five: the navigation has already been
 * performed by the time it lands.
 *
 * ### Why the instruction is rendered before the preview settles
 *
 * `handover` covers `idle` and `previewing` as well as the settled phase, and
 * {@link InviteRedemptionState.instruction} is `null` throughout both — so the
 * fixed {@link INVITE_SIGN_IN_REQUIRED_INSTRUCTION} is what a visitor reads for
 * the moment the preview is in the air, and it is *replaced* by the preview's own
 * wording if that call succeeds (Requirement 5.2). A preview that fails leaves the
 * fixed sentence exactly where it was, which is what Requirement 5.6 asks for and
 * also means nothing on the surface moves when it fails. There is no busy
 * indication for the preview: Requirement 5.12 asks for one while *redeeming*, and
 * claiming a wait for a call whose failure changes nothing would be noise.
 *
 * ### The handover targets come from the Auth_Feature, all three parts of them
 *
 * Requirement 5.4 asks for exactly one control to the sign-up route and exactly
 * one to the log-in route, each carrying the requested Invite_Landing_Route path
 * as the Redirect_Capture query value; Requirement 5.5 insists the two route paths
 * *and the parameter name* are the Auth_Feature's own exports rather than copies.
 * So `SIGN_UP_ROUTE`, `LOG_IN_ROUTE`, and `REDIRECT_PARAM_NAME` are imported and
 * this file contains no `'/signup'`, no `'/login'`, and no `'redirect'` literal —
 * which is what makes "they cannot drift apart" structural rather than a promise.
 *
 * The value is percent-encoded by `URLSearchParams`, so the requested path
 * survives its own reserved characters and comes back character-for-character
 * from `redirectCandidateFromSearch` on the other side (Requirement 5.4). The
 * controls are real `Link`s, so the handover is reversible in the ordinary way: a
 * visitor can activate the browser back control and be exactly where they were,
 * with the invite path — and the secret in it — still theirs.
 *
 * ### Nothing about the squad reaches this screen
 *
 * Requirement 5.3 forbids a Squad_Name, a squad identity, a membership count, and
 * a Player_Display_Name here while there is no session. That is upheld by there
 * being nothing to render: the anonymous `PreviewInvite` body carries only
 * `requiresAuthentication` and a generic `message`, the parser discards every
 * unrecognised property, the machine carries only that one string, and every other
 * string on the screen comes from `lib/messages.ts` where no message takes an
 * interpolation parameter. The Invite_Secret is not rendered either: it reaches the
 * `RedeemInvite` body and nothing else — not a message, not an attribute, and not
 * the redirect value beyond the path it was already part of (Requirements 4.10,
 * 17.2).
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9, 5.10, 5.12, 5.13, 5.14, 19.1
 */
import { useCallback, useId, useMemo, type ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import {
  LOG_IN_ROUTE,
  REDIRECT_PARAM_NAME,
  SIGN_UP_ROUTE,
  useAuth,
} from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import { FailureNotice } from '../components/FailureNotice';
import { LoadingIndication } from '../components/LoadingIndication';
import {
  INVITE_LANDING_HEADING,
  INVITE_LINK_INCOMPLETE,
  INVITE_LOG_IN_LABEL,
  INVITE_REDEEM_RETRY_LABEL,
  INVITE_REDEEMING_LABEL,
  INVITE_SIGN_IN_REQUIRED_INSTRUCTION,
  INVITE_SIGN_UP_LABEL,
  INVITE_UNUSABLE,
  SQUADS_HOME_CONTROL_LABEL,
} from '../lib/messages';
import {
  useInviteRedemption,
  type InviteRedemptionNavigate,
} from '../state/useInviteRedemption';

// The feature token table, so this screen resolves its own custom properties
// standing on its own outside the App_Shell frame. No colour value is written in
// either file (Requirement 18.9).
import '../styles/squadsTokens.css';
import './InviteLandingScreen.css';

/**
 * The selector of the Invite_Landing_Route wrapper, so a test can scope a query to
 * the screen.
 */
export const INVITE_LANDING_SELECTOR = '[data-squads-invite-landing="true"]';

/**
 * The selector of the handover surface — the instruction and the two controls that
 * Requirement 5.12 takes away while a redemption awaits a response.
 */
export const INVITE_HANDOVER_SELECTOR = '[data-squads-invite-handover="true"]';

/**
 * The Auth_Feature route with the requested Invite_Landing_Route path carried as
 * the Redirect_Capture query value (Requirements 5.4, 5.5).
 *
 * Both parts are the Auth_Feature's: `route` is its own `SIGN_UP_ROUTE` or
 * `LOG_IN_ROUTE`, and the parameter is named by its `REDIRECT_PARAM_NAME`. The
 * encoding is `URLSearchParams`', which is the exact counterpart of the
 * `URLSearchParams` read `redirectCandidateFromSearch` performs — so a path
 * carrying `?`, `#`, `&`, `%`, or a non-ASCII character survives the round trip
 * character-for-character rather than being cut short at the first reserved one.
 *
 * @param route the Auth_Feature route path to reach
 * @param requestedPath the Invite_Landing_Route path to come back to
 */
function handoverTarget(route: string, requestedPath: string): string {
  const query = new URLSearchParams();
  query.set(REDIRECT_PARAM_NAME, requestedPath);

  return `${route}?${query.toString()}`;
}

export interface InviteLandingScreenProps {
  /**
   * The Squads_Api facade — the feature's only transport seam, constructed by the
   * application router and handed in as a prop (Requirement 16.2). The **same**
   * facade the authenticated screens use: `PreviewInvite` is anonymous and needs
   * no bearer, and `RedeemInvite` is only ever issued while authenticated, so no
   * second client exists to misuse.
   */
  readonly api: SquadsApi;
}

/**
 * Render the Invite_Landing_Route: one `h1`, then exactly one of the five
 * surfaces its machine calls for.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.9, 5.10, 5.12, 5.13, 5.14, 19.1
 */
export function InviteLandingScreen({
  api,
}: InviteLandingScreenProps): ReactElement {
  const { state: authState } = useAuth();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const headingId = useId();

  /**
   * The requested Invite_Landing_Route path — the value the Invite_Secret is
   * extracted from, the key the machine's `redeemAttempted` latch is held
   * against, and the destination the two handover controls carry back
   * (Requirements 5.4, 5.7, 5.11).
   *
   * The search string is kept because it is part of the path that was requested;
   * the extraction cuts it away itself, and `encodeURIComponent` encodes `?`, so
   * a query string can never be part of a secret. The fragment is dropped because
   * a fragment is never sent anywhere and the router reports it separately.
   */
  const requestedPath = `${location.pathname}${location.search}`;

  /**
   * The machine's navigation seam, matching `useNavigate`'s signature so the
   * replacing navigation of Requirement 5.8 passes straight through.
   */
  const navigate = useCallback<InviteRedemptionNavigate>(
    (to, options) => {
      routerNavigate(to, { replace: options.replace });
    },
    [routerNavigate],
  );

  const machine = useInviteRedemption({
    api,
    path: requestedPath,
    navigate,
    authState,
  });

  const signUpTarget = useMemo(
    () => handoverTarget(SIGN_UP_ROUTE, requestedPath),
    [requestedPath],
  );
  const logInTarget = useMemo(
    () => handoverTarget(LOG_IN_ROUTE, requestedPath),
    [requestedPath],
  );

  /**
   * The way onward to the Squads_Home, offered by the incomplete-link surface, the
   * unusable-invite surface, and the generic failure alike (Requirements 5.9,
   * 5.10, 5.13).
   *
   * It targets the App_Shell's exported `HOME_ROUTE` rather than a path literal,
   * so it cannot drift from where the Squads_Home is registered — the same
   * arrangement `NotFoundTreatment` uses. Behind the Route_Guard, so a visitor
   * with no session is handed to the Log_In_Route by the guard rather than by a
   * second decision made here.
   */
  const homeControl = (
    <Link className="squads-invite-landing__home" to={HOME_ROUTE}>
      {SQUADS_HOME_CONTROL_LABEL}
    </Link>
  );

  return (
    <div className="squads-invite-landing" data-squads-invite-landing="true">
      <section
        className="squads-invite-landing__surface"
        aria-labelledby={headingId}
      >
        {/* 5.2, 19.1: the route's single level-one heading, naming joining a
            squad and naming no squad. */}
        <h1 id={headingId} className="squads-invite-landing__heading">
          {INVITE_LANDING_HEADING}
        </h1>

        {/* 5.9: the secret could not be read from the path, so neither call was
            issued. One fixed message about the address, and the way onward. */}
        {machine.incompleteLink ? (
          <div className="squads-invite-landing__outcome">
            <p className="squads-invite-landing__message">
              {INVITE_LINK_INCOMPLETE}
            </p>
            {homeControl}
          </div>
        ) : null}

        {/* 5.12: while the redemption awaits a response — the busy indication,
            and neither the instruction nor the handover controls. */}
        {machine.redeeming ? (
          <LoadingIndication label={INVITE_REDEEMING_LABEL} />
        ) : null}

        {/* 5.2, 5.4, 5.6, 5.14: the handover surface. The preview's own
            instruction once it has one, the fixed sentence until and unless it
            does, and exactly one control to each of the two Auth_Feature routes,
            each carrying this path back. */}
        {machine.handover ? (
          <div
            className="squads-invite-landing__handover"
            data-squads-invite-handover="true"
          >
            <p className="squads-invite-landing__message">
              {machine.instruction ?? INVITE_SIGN_IN_REQUIRED_INSTRUCTION}
            </p>
            <div className="squads-invite-landing__controls">
              <Link
                className="squads-invite-landing__control"
                to={signUpTarget}
              >
                {INVITE_SIGN_UP_LABEL}
              </Link>
              <Link className="squads-invite-landing__control" to={logInTarget}>
                {INVITE_LOG_IN_LABEL}
              </Link>
            </div>
          </div>
        ) : null}

        {/* 5.10: matches no invite, revoked, or expired — one message for all
            three, naming nothing, and the way onward. */}
        {machine.unusable ? (
          <div className="squads-invite-landing__outcome">
            <p className="squads-invite-landing__message" role="status">
              {INVITE_UNUSABLE}
            </p>
            {homeControl}
          </div>
        ) : null}

        {/* 5.13: the generic failure, a retry issuing exactly one further
            `RedeemInvite`, and the way onward beside it. Nothing re-issues
            itself. */}
        {machine.failed ? (
          <FailureNotice
            retryLabel={INVITE_REDEEM_RETRY_LABEL}
            onRetry={machine.retry}
            retryBusy={machine.redeeming}
          >
            {homeControl}
          </FailureNotice>
        ) : null}
      </section>
    </div>
  );
}

export default InviteLandingScreen;
