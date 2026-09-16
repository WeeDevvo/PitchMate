/**
 * The Not_Found_Treatment — the feature's one non-disclosing surface.
 *
 * `GetSquad` reporting not-found (which folds the backend's `403` deliberately),
 * and a `squadId` path segment that is not a syntactically valid identifier — for
 * which no call is issued at all — both render this. Requirement 6.5 asks for one
 * treatment whose rendered content is *identical* whether the squad does not
 * exist, is not accessible to the caller, or holds a membership that is not
 * active, and Requirement 6.4 asks for no Squad_Name, no Player_List, no
 * Admin_Section, and no statement that the squad exists, does not exist, or is
 * inaccessible for a particular reason.
 *
 * ### The component takes no props, and that is the mechanism
 *
 * With no input there is nothing a caller could vary: no cause, no identifier, no
 * reason code, no squad name. "The content does not vary with cause" is therefore
 * a property of the component's shape rather than of every call site remembering
 * to pass the same thing (Requirements 6.4, 6.5, 17.7). The copy comes from
 * `lib/messages.ts`, which states both possibilities in one sentence — a person
 * who is not a member reads exactly what a person who mistyped an identifier
 * reads.
 *
 * ### It carries the route's level-one heading
 *
 * On a successful load the Squad_Screen's `h1` is the parsed Squad_Name
 * (Requirement 6.3). There is no name here, so this surface contributes the single
 * `h1` of the route instead — which keeps the heading outline well-formed in the
 * not-found state (Requirements 19.1, 19.2) without a name reaching the screen.
 *
 * ### Not an error
 *
 * A squad that cannot be reached is an outcome, not a fault, so there is no
 * `role="alert"`, no live region, and no {@link GENERIC_SQUADS_FAILURE}: a failed
 * `GetSquad` renders the `FailureNotice` and this treatment stays absent
 * (Requirement 6.7). The only control is the way onward to the Squads_Home, which
 * targets the App_Shell's exported `HOME_ROUTE` rather than a path literal, so it
 * cannot drift from where the Squads_Home is registered.
 *
 * Requirements: 6.4, 6.5, 17.7, 19.1
 */
import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import {
  NOT_FOUND_TREATMENT_BODY,
  NOT_FOUND_TREATMENT_HEADING,
  NOT_FOUND_TREATMENT_HOME_LABEL,
} from '../lib/messages';
import './NotFoundTreatment.css';

/** The selector of the treatment, so a screen test can assert its whole subtree. */
export const NOT_FOUND_TREATMENT_SELECTOR = '[data-squads-not-found="true"]';

/**
 * Render the Not_Found_Treatment: one level-one heading, the fixed statement, and
 * a control to the Squads_Home.
 *
 * Requirements: 6.4, 6.5, 17.7, 19.1
 */
export function NotFoundTreatment(): ReactElement {
  return (
    <div className="squads-not-found" data-squads-not-found="true">
      {/* 6.4, 19.1: the route's single level-one heading, carrying no squad name. */}
      <h1>{NOT_FOUND_TREATMENT_HEADING}</h1>
      {/* 6.5, 17.7: both possibilities in one sentence, so neither is disclosed. */}
      <p className="squads-not-found__body">{NOT_FOUND_TREATMENT_BODY}</p>
      {/* 6.4: the way onward, client-side, to where the Squads_Home is registered. */}
      <Link className="squads-not-found__home" to={HOME_ROUTE}>
        {NOT_FOUND_TREATMENT_HOME_LABEL}
      </Link>
    </div>
  );
}

export default NotFoundTreatment;
