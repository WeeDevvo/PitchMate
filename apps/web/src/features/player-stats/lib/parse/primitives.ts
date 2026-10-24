/**
 * The reading primitives every Response_Parser in `lib/parse/` is built from.
 *
 * The general readers are declared once for every feature in the shared
 * `src/wire` module and re-exported here, beside the one reader that belongs to
 * this feature, so `playerProfile.ts` takes all of its readers from one place.
 * See `src/wire/primitives.ts` for the rules they hold.
 *
 * Requirements: 13.1, 13.10
 */
import { type ValueReader } from '../../../../wire';
import { readDurationMs as readTransmittedDuration } from '../duration';

export * from '../../../../wire';

/**
 * A value read as a duration in milliseconds — the Keeper_Time reader, declared
 * in `lib/duration.ts` and re-exported here so that a parser takes **all** of its
 * readers from one module.
 *
 * The reader itself lives beside the duration printer and the duration formatter,
 * because the three are one subject: the accepted .NET `TimeSpan` wire form, the
 * canonical form printed back, and the `'1h 05m'` form a person reads.
 *
 * The annotation on this binding is the **pinning between the two result
 * shapes**. `lib/duration.ts` declares its own structurally identical
 * `ParseResult`/`ValueReader` mirror, so that it stays free of imports. Assigning
 * it to the shared {@link ValueReader} here means a change to either declaration
 * fails `tsc -b` at this line rather than passing as two types that have quietly
 * stopped agreeing.
 *
 * Requirements: 13.1, 13.10
 */
export const readDurationMs: ValueReader<number> = readTransmittedDuration;
