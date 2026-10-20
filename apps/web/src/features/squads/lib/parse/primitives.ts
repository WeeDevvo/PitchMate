/**
 * The reading primitives every Response_Parser in `lib/parse/` is built from.
 *
 * They are declared once for every feature in the shared `src/wire` module and
 * re-exported here, so this feature's parsers keep taking every reader from one
 * local module. See `src/wire/primitives.ts` for the rules they hold.
 */
export * from '../../../../wire';
