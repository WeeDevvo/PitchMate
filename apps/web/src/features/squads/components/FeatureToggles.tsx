/**
 * The Feature_Toggle set of the Admin_Section: one switch per parsed
 * Feature_Flag, each stating in words which feature it is and whether that
 * feature is on.
 *
 * ### The rendered state is the backend's, and there is nowhere else for it to
 * ### come from
 *
 * Requirement 14.7 asks that every rendered toggle state be derived solely from a
 * backend-supplied Feature_Flag and that no optimistic state outlive its
 * `SetFeatureFlag` call. This component holds **no toggle state at all**: the
 * switches render from {@link FeatureTogglesProps.flags} — the `features`
 * collection of the parsed Squad_Detail the Squad_Screen already holds — or, where
 * no Squad_Detail re-read stands behind them, from the collection the machine's
 * fallback `GetFeatureFlags` supplied. Both are values the backend sent. A change
 * therefore moves nothing on screen until the backend has been asked again, which
 * is deliberately visible: the switch shows what the squad's configuration *is*,
 * not what somebody just asked it to become. A toggle cannot contradict the
 * backend because there is no second value for it to contradict it with.
 *
 * `machine.flags ?? flags` is the whole of that rule. On the Squad_Screen the
 * `onSquadChanged` seam is always supplied, so no `GetFeatureFlags` call is issued
 * and `machine.flags` stays `null` forever — the prop is what renders
 * (Requirement 14.2). Rendered without that seam, the fallback read's collection
 * takes over once it arrives. Neither branch is an optimistic guess.
 *
 * ### Every state is a word before it is a hue
 *
 * Requirements 10.6 and 19.3 fix that a Feature_Flag's state is conveyed in text
 * *in addition to* the control's own state. Each row therefore renders three
 * carriers of the same fact: the `Enabled` / `Disabled` word beside the switch, the
 * switch's `aria-checked`, and the position of its knob. The accent on a checked
 * switch is emphasis over a statement that survives a greyscale rendering. Every
 * string comes from `lib/messages.ts`, and the feature's label is looked up through
 * a total map over the named Squad_Features, so no toggle can render unnamed.
 *
 * ### Single-flight, announced, and still reachable
 *
 * While a flag's call awaits a response its switch is `aria-disabled` and
 * `aria-busy` and its activation is a no-op (Requirement 14.4) — `aria-disabled`
 * rather than `disabled` so the control keeps the keyboard focus of whoever just
 * activated it and stays in the tab order (Requirement 19.4). The guard is
 * per flag, so a second feature can be changed while the first is in flight and
 * neither blocks the other; `useFeatureToggles` enforces the same rule at the
 * call site, so a caller cannot route around it.
 *
 * A settled call is announced in one live region beneath the list, so the outcome
 * reaches a screen reader without keyboard focus moving (Requirement 17.3). A
 * success names the feature and the state the backend accepted for it
 * (Requirement 14.5); every failure — a rejection, a not-found, a lapsed
 * Squad_Call_Timeout, an unreadable body — is the one
 * {@link GENERIC_SQUADS_FAILURE}, carrying no status code and no backend wording,
 * with the switch left on the last state the backend supplied and available for a
 * further change (Requirements 14.6, 17.1, 17.2, 17.4).
 *
 * ### An empty collection is a coherent state, not a fault
 *
 * A squad carrying no Feature_Flag renders {@link NO_OPTIONAL_FEATURES_STATEMENT}
 * and no toggle and no error indication (Requirement 14.8). Squads opt in to
 * optional capabilities, so having none is something to state plainly.
 *
 * The `h3` introducing this surface belongs to the Admin_Section, which is also
 * what decides that this component is rendered at all: no Feature_Toggle exists
 * for a caller without Admin_Authority, and no `SetFeatureFlag` call can be issued
 * from a session that never renders one (Requirements 10.3, 10.4). No colour value
 * appears in this file or in `FeatureToggles.css`; both read the feature token
 * table (Requirement 18.9).
 *
 * Requirements: 10.6, 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 19.3
 */
import { useId, type ReactElement } from 'react';

import { LiveRegion, type AuthState } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import type { SquadFeatureValue } from '../lib/enumCodes';
import {
  FEATURE_DISABLED_LABEL,
  FEATURE_ENABLED_LABEL,
  FEATURE_NOW_DISABLED_STATEMENT,
  FEATURE_NOW_ENABLED_STATEMENT,
  GENERIC_SQUADS_FAILURE,
  LIVE_MATCH_TRACKING_FEATURE_LABEL,
  NO_OPTIONAL_FEATURES_STATEMENT,
} from '../lib/messages';
import type { FeatureFlag } from '../lib/parse/featureFlags';
import {
  useFeatureToggles,
  type FeatureToggleOutcome,
} from '../state/useFeatureToggles';

// The feature token table, so a toggle rendered outside the App_Shell frame still
// resolves every custom property `FeatureToggles.css` reads (Requirement 18.9).
import '../styles/squadsTokens.css';
import './FeatureToggles.css';

/** The selector of the Feature_Toggle set as a whole. */
export const FEATURE_TOGGLES_SELECTOR = '[data-squads-feature-toggles="true"]';

/**
 * The selector of one Feature_Toggle, so a test can count the toggles and read
 * their features without depending on any rendered copy.
 */
export const FEATURE_TOGGLE_SELECTOR = '[data-squads-feature-toggle="true"]';

/** The attribute carrying which Squad_Feature a toggle is for. */
export const FEATURE_TOGGLE_FEATURE_ATTRIBUTE = 'data-feature';

/** The selector of a toggle's switch control (Requirements 14.3, 14.4). */
export const FEATURE_TOGGLE_SWITCH_SELECTOR =
  '[data-squads-feature-switch="true"]';

/**
 * The selector of a toggle's state word — the text label Requirements 10.6 and
 * 19.3 ask for beside the control's own state.
 */
export const FEATURE_TOGGLE_STATE_SELECTOR = '[data-squads-feature-state]';

/**
 * The selector of the no-optional-features statement, so a test can assert it is
 * rendered exactly when the flag collection is empty (Requirement 14.8).
 */
export const NO_OPTIONAL_FEATURES_SELECTOR =
  '[data-squads-no-optional-features="true"]';

/** The id of the set's one outcome live region (Requirements 14.5, 14.6, 17.3). */
export const FEATURE_TOGGLES_OUTCOME_REGION_ID = 'squads-feature-toggles-outcome';

/**
 * The persistently visible label of each named Squad_Feature — a total lookup, so
 * no named feature can reach a toggle without a label (Requirement 14.1).
 *
 * The Response_Parser fails a body carrying a feature the Enum_Code_Map does not
 * name, so this map covers every flag that can arrive.
 */
const FEATURE_LABELS: Readonly<Record<SquadFeatureValue, string>> = {
  'live-match-tracking': LIVE_MATCH_TRACKING_FEATURE_LABEL,
};

/**
 * The label naming one feature (Requirement 14.1).
 *
 * Pure and total over the named features, so a test can assert what a toggle
 * states without restating the map.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a toggle and the words it renders are one unit, so the pure lookups stay beside it
export function featureToggleLabel(feature: SquadFeatureValue): string {
  return FEATURE_LABELS[feature];
}

/**
 * The word stating whether a feature is on (Requirements 10.6, 14.1, 19.3).
 */
// eslint-disable-next-line react-refresh/only-export-components -- see featureToggleLabel
export function featureStateLabel(enabled: boolean): string {
  return enabled ? FEATURE_ENABLED_LABEL : FEATURE_DISABLED_LABEL;
}

/**
 * The announcement for one accepted change: the feature's own label and the state
 * the backend accepted for it (Requirement 14.5).
 *
 * Composed here rather than carried by a message, because no message in
 * `lib/messages.ts` takes an interpolation parameter — the same arrangement
 * `ratingBadgeAccessibleName` uses for a player's name.
 */
// eslint-disable-next-line react-refresh/only-export-components -- see featureToggleLabel
export function featureToggleAnnouncement(
  feature: SquadFeatureValue,
  enabled: boolean,
): string {
  const statement = enabled
    ? FEATURE_NOW_ENABLED_STATEMENT
    : FEATURE_NOW_DISABLED_STATEMENT;

  return `${featureToggleLabel(feature)} ${statement}`;
}

/**
 * The message the live region announces for a settled call, or `null` while
 * nothing has settled (Requirements 14.5, 14.6).
 *
 * Every failure arm collapses to the one generic message, so a rejection, a
 * not-found, a lapsed timeout, and an unreadable body are indistinguishable and
 * nothing of the backend's own wording can reach the interface
 * (Requirements 17.1, 17.2).
 */
function outcomeMessageOf(outcome: FeatureToggleOutcome | null): string | null {
  if (outcome === null) {
    return null;
  }

  if (outcome.kind === 'failed') {
    return GENERIC_SQUADS_FAILURE;
  }

  return featureToggleAnnouncement(outcome.feature, outcome.enabled);
}

export interface FeatureTogglesProps {
  /** The squad whose features these are, from the parsed Squad_Detail. */
  readonly squadId: string;

  /** The Squads_Api facade — the feature's only transport seam. */
  readonly api: SquadsApi;

  /**
   * The Feature_Flag collection carried by the parsed Squad_Detail — the value
   * every switch renders from (Requirements 14.2, 14.7).
   */
  readonly flags: readonly FeatureFlag[];

  /**
   * The post-change Squad_Detail re-read, whose `GetSquad` answer carries the
   * refreshed `features` collection (Requirements 14.2, 14.5).
   *
   * Supplied — as the Squad_Screen supplies it — no `GetFeatureFlags` call is ever
   * issued. Omitted, the machine falls back to one `GetFeatureFlags` per accepted
   * change, because there is then no `GetSquad` result to supply the refreshed
   * state (Requirement 14.7).
   */
  readonly onSquadChanged?: () => void;

  /**
   * The Auth_State, so an ended session aborts every call awaiting a response and
   * this surface stops holding feature state (Requirement 17.5). Defaults to
   * `authenticated`, as the machine does.
   */
  readonly authState?: AuthState;
}

/**
 * Render one switch per parsed Feature_Flag — or the no-optional-features
 * statement for a squad that carries none.
 *
 * Requirements: 10.6, 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 19.3
 */
export function FeatureToggles({
  squadId,
  api,
  flags,
  onSquadChanged,
  authState,
}: FeatureTogglesProps): ReactElement {
  const machine = useFeatureToggles({
    api,
    squadId,
    refresh: onSquadChanged,
    authState,
  });

  const labelIdPrefix = useId();

  // 14.2, 14.7: the last collection the backend supplied. `machine.flags` is
  // non-null only where no Squad_Detail re-read stands behind this surface, and
  // both branches are backend-supplied — neither is an optimistic value.
  const renderedFlags = machine.flags ?? flags;

  return (
    <div className="squads-feature-toggles" data-squads-feature-toggles="true">
      {/* 14.8: an absence, stated plainly, with no toggle and no error. */}
      {renderedFlags.length === 0 ? (
        <p
          className="squads-feature-toggles__statement"
          data-squads-no-optional-features="true"
        >
          {NO_OPTIONAL_FEATURES_STATEMENT}
        </p>
      ) : (
        <ul className="squads-feature-toggles__list">
          {renderedFlags.map((flag, index) => {
            const pending = machine.isPending(flag.feature);
            // A repeated feature is not a parse failure — the collection is
            // rendered as it arrived — so the key carries the position too.
            const key = `${flag.feature}-${String(index)}`;
            const labelId = `${labelIdPrefix}-${String(index)}`;

            return (
              <li
                key={key}
                className="squads-feature-toggles__item"
                data-squads-feature-toggle="true"
                data-feature={flag.feature}
              >
                {/* 14.1: the persistently visible label naming the feature, and
                    the switch's own accessible name through `aria-labelledby`, so
                    the two are the same node and cannot diverge. */}
                <span className="squads-feature-toggles__label" id={labelId}>
                  {featureToggleLabel(flag.feature)}
                </span>

                <button
                  type="button"
                  role="switch"
                  className="squads-feature-toggles__switch"
                  // 14.7: the state the backend supplied, and nothing else.
                  aria-checked={flag.isEnabled}
                  aria-labelledby={labelId}
                  // 14.4: disabled with a determinable busy state while this
                  // flag's call awaits a response, without leaving the tab order.
                  aria-disabled={pending ? true : undefined}
                  aria-busy={pending ? true : undefined}
                  data-squads-feature-switch="true"
                  onClick={() => {
                    // 14.4: one call per change, and none while one is in flight.
                    if (pending) {
                      return;
                    }
                    // 14.3: exactly one `SetFeatureFlag`, carrying this flag and
                    // the requested state — the opposite of the backend's.
                    machine.setEnabled(flag.feature, !flag.isEnabled);
                  }}
                >
                  {/* The knob: a position cue that pairs with the word beside it,
                      decorative to assistive technology because `aria-checked`
                      already carries the state (Requirement 19.3). */}
                  <span
                    className="squads-feature-toggles__track"
                    aria-hidden="true"
                  />
                </button>

                {/* 10.6, 14.1, 19.3: the state in words, beside the control. */}
                <span
                  className="squads-feature-toggles__state"
                  data-squads-feature-state={
                    flag.isEnabled ? 'enabled' : 'disabled'
                  }
                >
                  {featureStateLabel(flag.isEnabled)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* 14.5, 14.6, 17.3: the one announcement surface, always present so a
          message inserted into it later is announced, and never moving focus. */}
      <LiveRegion
        id={FEATURE_TOGGLES_OUTCOME_REGION_ID}
        message={outcomeMessageOf(machine.outcome)}
      />
    </div>
  );
}

export default FeatureToggles;
