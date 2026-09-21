/**
 * The Feature_Flag body shape, shared by two operations.
 *
 * `GetFeatureFlags` returns `[{ feature: int, isEnabled: bool }]` and the
 * `features` property of `GetSquad` carries the *same* element shape
 * (`SquadFeatureView` in the backend). Parsing both through one module is what
 * keeps the Squad_Screen's initial toggle state and the state it holds after a
 * refresh from disagreeing — there is one reading of a feature flag in the
 * feature, not two.
 *
 * A feature the Enum_Code_Map does not name fails the body carrying it
 * (Requirement 16.6). That is deliberate rather than lenient: an unnamed feature
 * has no label, so rendering it would mean an unnamed toggle a person could
 * switch, and dropping it would silently shorten the administration surface. A
 * failure surfaces as the one Generic_Squads_Failure with a retry, which is
 * honest about the fact that the flags could not be read.
 *
 * `isEnabled` is read as a strict boolean, never defaulted — a toggle rendered
 * off because nobody sent a value would misstate the squad's configuration.
 *
 * Requirements: 16.4, 16.5, 16.6, 16.9, 16.10
 */

import {
  codeFromSquadFeature,
  squadFeatureFromCode,
  type SquadFeatureValue,
} from '../enumCodes';
import {
  fail,
  ok,
  readArray,
  readBoolean,
  readObject,
  readProperty,
  type ParseResult,
  type ValueReader,
} from './primitives';

/** One optional squad capability together with its current state. */
export interface FeatureFlag {
  readonly feature: SquadFeatureValue;
  readonly isEnabled: boolean;
}

/**
 * A present Feature_Flag code read as its named value, failing when the
 * Enum_Code_Map names no such code (Requirement 16.6).
 */
const readSquadFeatureValue: ValueReader<SquadFeatureValue> = (value, label) => {
  const feature = squadFeatureFromCode(value);

  if (feature === undefined) {
    return fail(`${label} names no feature`);
  }

  return ok(feature);
};

/**
 * One Feature_Flag parsed from an element of either operation's body.
 *
 * Total over every input and free of exceptions; the result is built last, from
 * two validated readings (Requirement 16.4).
 *
 * Requirements: 16.4, 16.6, 16.9
 */
export function parseFeatureFlag(body: unknown): ParseResult<FeatureFlag> {
  const source = readObject(body, 'feature flag');

  if (!source.ok) {
    return source;
  }

  const feature = readSquadFeatureValue(
    readProperty(source.value, 'feature'),
    'feature flag feature',
  );

  if (!feature.ok) {
    return feature;
  }

  const isEnabled = readBoolean(
    readProperty(source.value, 'isEnabled'),
    'feature flag isEnabled',
  );

  if (!isEnabled.ok) {
    return isEnabled;
  }

  return ok({ feature: feature.value, isEnabled: isEnabled.value });
}

/**
 * A whole feature-flag collection: the `GetFeatureFlags` body, and the value the
 * Squad_Detail parser reads out of `features`.
 *
 * One bad element fails the collection. A duplicated feature is **not** a failure
 * here: unlike a leaderboard, where two entries for one membership make a
 * person's rating ambiguous (Requirement 8.11), a repeated flag decides nothing
 * about anybody — the toggle surface renders what the collection carries.
 *
 * Requirements: 16.4
 */
export function parseFeatureFlags(
  body: unknown,
): ParseResult<readonly FeatureFlag[]> {
  const elements = readArray(body, 'feature flag list');

  if (!elements.ok) {
    return elements;
  }

  const flags: FeatureFlag[] = [];

  for (const element of elements.value) {
    const flag = parseFeatureFlag(element);

    if (!flag.ok) {
      return flag;
    }

    flags.push(flag.value);
  }

  return ok(flags);
}

/**
 * A Feature_Flag rendered back into the wire shape {@link parseFeatureFlag}
 * accepts: the feature as its code, the state as a boolean.
 *
 * Requirements: 16.5
 */
export function printFeatureFlag(flag: FeatureFlag): unknown {
  return {
    feature: codeFromSquadFeature(flag.feature),
    isEnabled: flag.isEnabled,
  };
}

/**
 * A feature-flag collection rendered back into the wire shape
 * {@link parseFeatureFlags} accepts.
 *
 * Requirements: 16.5
 */
export function printFeatureFlags(flags: readonly FeatureFlag[]): unknown {
  return flags.map(printFeatureFlag);
}
