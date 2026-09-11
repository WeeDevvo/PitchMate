/**
 * The application-level not-found indication — what a requested path shows when
 * it matches no registered route and does not begin with `/app`.
 *
 * Requirement 15.9 is specific about what this surface is, and about what it must
 * not do:
 *
 * - It carries **exactly one** level-one heading and a control that navigates to
 *   the marketing landing route.
 * - It renders **neither** the Shell_Frame **nor** an Auth_Feature screen, which
 *   is why it is a plain surface of its own rather than a reuse of the auth
 *   feature's layout: an unknown address is not an authentication surface, and
 *   showing one would tell the visitor to log in for a page that does not exist.
 * - It performs **no** navigation to the Log_In_Route and **no**
 *   Redirect_Capture. There is no `useAuth` here, no guard, and nothing that
 *   reads or writes a redirect parameter — a wrong address is not an
 *   authentication outcome.
 * - It performs **no full-document reload**: the control is a router `Link`.
 *
 * It is also deliberately not an error state — no `role="alert"`, no live region,
 * and no fault wording. A mistyped or stale address is an ordinary outcome.
 *
 * This is distinct from the App_Shell's own `/app/*` not-found
 * ({@link ShellNotFound}, Requirement 3.10), which keeps the person inside the
 * authenticated frame and offers the Home_Destination instead of the landing
 * page.
 *
 * Requirements: 15.9
 */
import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { LANDING_ROUTE } from './appRoutePaths';

/** The single level-one heading of the application not-found surface (Req 15.9). */
export const APP_NOT_FOUND_HEADING = 'Page not found';

/**
 * The body text shown beneath the heading (Req 15.9).
 *
 * Neutral and factual: it states the outcome without framing it as a failure and
 * without speculating about what the visitor did.
 */
export const APP_NOT_FOUND_BODY =
  'That address is not part of PitchMate. It may have changed.';

/**
 * The visible label of the control that navigates to the marketing landing route
 * (Req 15.9).
 *
 * It names where it goes rather than saying "back", because the visitor may have
 * arrived here directly from outside the application and have nothing to go back
 * to.
 */
export const APP_NOT_FOUND_CONTROL_LABEL = 'Go to the PitchMate home page';

/**
 * Render the application-level not-found indication: one level-one heading, a
 * neutral explanation, and a client-side control to the marketing landing route.
 *
 * Requirements: 15.9
 */
export function AppNotFound(): ReactElement {
  return (
    <main className="app-not-found">
      {/* 15.9: exactly one level-one heading. */}
      <h1>{APP_NOT_FOUND_HEADING}</h1>
      <p>{APP_NOT_FOUND_BODY}</p>
      {/* 15.9: a control to the marketing landing route, client-side — a `Link`
          navigates within the router and reloads no document. */}
      <Link to={LANDING_ROUTE}>{APP_NOT_FOUND_CONTROL_LABEL}</Link>
    </main>
  );
}

export default AppNotFound;
