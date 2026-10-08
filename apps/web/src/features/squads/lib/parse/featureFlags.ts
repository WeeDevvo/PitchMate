/**
 * The Feature_Flag body shape, shared by two operations.
 *
 * `GetFeatureFlags` returns `[{ feature: "LiveMatchTracking", isEnabled: bool }]`
 * and the `features` property of `GetSquad` carries the *same* element shape
 * (`SquadFeatureView` in the backend). Parsing both through one module is what
 * keeps the Squad_Screen's initial toggle state and the state it holds after a
 * refresh from disagreeing — there is one reading of a feature flag in the
 * feature, not two.
 *
 * The feature is read **by name**, validated against the Generated_Enum_Union
 * `isSquadFeature` tests, in place of reading a number and mapping it
 * (Requirement 12.8). The vocabulary is therefore the contract's own: a code
 * table that disagreed with the backend's declaration order used to map a flag to
 * the wrong valid feature silently, where a name either is in the generated union
 * or is not.
 *
 * A value naming no member of that union fails the body carrying it
 * (Requirements 12.7, 16.6). That is deliberate rather than lenient: an unnamed
 * feature has no label, so rendering it would mean an unnamed toggle a person
 * could switch, and dropping it would silently shorten the administration
 * surface. A failure surfaces as the one Generic_Squads_Failure with a retry,
 * which is honest about the fact that the flags could not be read.
 *
 * `isEnabled` is read as a strict boolean, never defaulted — a toggle rendered
 * off because nobody sent a value would misstate the squad's configuration.
 *
 * Requirements: 12.5, 12.7, 12.8, 16.4, 16.5, 16.6, 16.9, 16.10
 */

import { isSquadFeature, type SquadFeature } from '../wireEnums';
import {
  ok,
  readArray,
  readBoolean,
  readObject,
  readProperty,
  readWireEnumName,
  type ParseResult,
} from './primitives';

/** One optional squad capability together with its current state. */
export interface FeatureFlag {
  readonly feature: SquadFeature;
  readonly isEnabled: boolean;
}

/**
 * One Feature_Flag parsed from an element of either operation's body.
 *
 * Total over every input and free of exceptions; the result is built last, from
 * two validated readings (Requirement 16.4).
 *
 * Requirements: 12.7, 12.8, 16.4, 16.6, 16.9
 */
export function parseFeatureFlag(body: unknown): ParseResult<FeatureFlag> {
  const source = readObject(body, 'feature flag');

  if (!source.ok) {
    return source;
  }

  const feature = readWireEnumName(
    readProperty(source.value, 'feature'),
    'feature flag feature',
    isSquadFeature,
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
 * Requirements: 12.7, 16.4
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
 * accepts: the feature as its member name, the state as a boolean.
 *
 * Requirements: 12.11, 16.5
 */
export function printFeatureFlag(flag: FeatureFlag): unknown {
  return {
    feature: flag.feature,
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
