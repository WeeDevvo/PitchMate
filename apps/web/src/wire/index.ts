/**
 * The shared wire-reading module: the reading primitives every feature's
 * Response_Parser is built from. A feature reaches it through this barrel only,
 * the same way it reaches the shared `src/theme` module.
 */
export {
  MAX_INSTANT_MS,
  fail,
  ok,
  printInstant,
  readArray,
  readBoolean,
  readCount,
  readInstantMs,
  readNumber,
  readObject,
  readOptional,
  readPercentage,
  readProperty,
  readString,
  readUuid,
  readWireEnumName,
  type ParseResult,
  type StringBounds,
  type ValueReader,
  type WireEnumNamePredicate,
  type WireObject,
} from './primitives';
