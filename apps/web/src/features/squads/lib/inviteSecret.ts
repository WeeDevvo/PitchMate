/**
 * The Squads_Feature's two Invite_Secret derivations: one for a requested
 * Invite_Landing_Route path, one for whatever a person pastes into the
 * Join_Code_Form.
 *
 * The two exist because an invite reaches a person in two shapes and the backend
 * matches exactly one value. `GenerateInvite` returns an absolute
 * `redeemableLink` of the form `https://pitch-mate.co.uk/join/{token}` alongside
 * the short Invite_Code, and the token in that final segment *is* the value the
 * backend hashes. So:
 *
 * | Entry point                                        | Function | What it is given                                  |
 * | -------------------------------------------------- | -------- | ------------------------------------------------- |
 * | the Invite_Landing_Route `/join/:code` (5.7, 5.11) | {@link extractInviteSecretFromPath} | the requested path |
 * | the Join_Code_Form (4.2, 4.4)                      | {@link redeemableValueFrom}         | a pasted link *or* a typed code |
 *
 * Both are pure functions of a string, which is what Requirement 5.11 asks for
 * explicitly: the extraction depends on neither React nor the DOM, so what a
 * given path yields can be stated and tested without rendering or navigating.
 * `screens/InviteLandingScreen.tsx` therefore holds no parsing of its own — it
 * calls the extraction once for the path it was mounted on and either issues its
 * calls or renders `INVITE_LINK_INCOMPLETE`.
 *
 * **Neither function ever raises.** `decodeURIComponent` rejects a malformed
 * percent-escape and the `URL` constructor rejects a value that is not a URL;
 * both are guarded, and a decoding failure comes back as the named
 * `'undecodable'` failure rather than as a thrown error. That matters because
 * the input is attacker-controlled in the most ordinary way possible: it is
 * whatever was typed into the address bar. Requirement 5.9 wants a truncated,
 * hand-edited, or mangled link to render one fixed message, not to break a
 * screen.
 *
 * **The secret is a value, never a message.** Neither function is given anything
 * renderable and neither produces anything but the secret itself, which reaches
 * exactly two places: a request body, and the value of its own input field
 * (Requirement 4.10). No message in `lib/messages.ts` takes an interpolation
 * parameter, so there is no message-shaped hole an outcome could carry it
 * through — the mechanism rather than the intention.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all — in particular not `@pitchmate/api-client`
 * (Requirement 18.2). The `/join/` prefix is written here as a literal rather
 * than derived from `INVITE_LANDING_ROUTE` so that this module stays a leaf; the
 * two cannot drift, because Property 9 builds a path with `inviteLandingPath`
 * and recovers the secret through {@link extractInviteSecretFromPath}.
 *
 * Requirements: 4.4, 5.9, 5.11
 */

/**
 * The literal prefix of the Invite_Landing_Route — `INVITE_LANDING_ROUTE` with
 * its `:code` parameter removed, and exactly what `inviteLandingPath` builds
 * onto.
 *
 * Written with both slashes on purpose: it is the marker that introduces the
 * `code` segment, so a path that merely ends in `/join` carries no segment at
 * all.
 */
const INVITE_LANDING_PREFIX = '/join/';

/** The path segment separator, which a percent-encoded secret cannot contain. */
const PATH_SEGMENT_SEPARATOR = '/';

/**
 * The characters that end a path and begin a query or a fragment.
 *
 * Both are cut away before any segment is read. This cannot lose part of a
 * secret: `inviteLandingPath` percent-encodes the secret, and
 * `encodeURIComponent` encodes `?` and `#`, so a raw one in a requested path is
 * always an introducer and never a character of the secret (Requirement 20.8).
 */
const QUERY_AND_FRAGMENT_INTRODUCERS = ['?', '#'] as const;

/**
 * Why an Invite_Secret could not be extracted from a requested path.
 *
 * Three names, and none of them is user-facing: Requirement 5.9 answers all
 * three with the single `INVITE_LINK_INCOMPLETE` message, because telling a
 * visitor *how* their link is broken says something about what a valid link
 * looks like. The names exist so the screen's own tests can state which shape
 * they exercised.
 *
 * | Reason         | The path                                                      |
 * | -------------- | ------------------------------------------------------------- |
 * | `absent`       | carries no `/join/` marker, so there is no segment to read     |
 * | `empty`        | carries the marker but a segment that is empty, or empty after decoding and trimming |
 * | `undecodable`  | carries a segment holding a malformed percent-escape           |
 */
export type InviteSecretFailureReason = 'absent' | 'empty' | 'undecodable';

/**
 * The result of reading an Invite_Secret out of a requested path: either a
 * non-empty secret or one named failure (Requirement 5.11).
 *
 * A discriminated union rather than `string | null`, so a caller cannot mistake
 * a failure for a secret, and so the success member is the only thing in the
 * type that carries the secret at all.
 */
export type InviteSecretExtraction =
  | { readonly ok: true; readonly secret: string }
  | { readonly ok: false; readonly reason: InviteSecretFailureReason };

/**
 * The percent-decoded form of a path segment, or `null` when the segment holds a
 * malformed escape.
 *
 * The whole reason this exists is the `try`: `decodeURIComponent('%')` and
 * `decodeURIComponent('%zz')` raise a `URIError`, and a hand-edited address bar
 * produces exactly those. Guarding here rather than at each call site is what
 * makes both exported functions total.
 */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed percent-escape is not an error worth propagating — it is one
    // of the shapes Requirement 5.9 names.
    return null;
  }
}

/**
 * The candidate with any query string and fragment removed.
 *
 * Cuts at the first introducer of either, so `#` inside a query and `?` after a
 * fragment are both handled by the same single cut rather than by an ordering
 * rule.
 */
function pathWithoutQueryOrFragment(candidate: string): string {
  let end = candidate.length;

  for (const introducer of QUERY_AND_FRAGMENT_INTRODUCERS) {
    const index = candidate.indexOf(introducer);
    if (index >= 0 && index < end) {
      end = index;
    }
  }

  return candidate.slice(0, end);
}

/**
 * Whether the candidate parses as a URL — the test that distinguishes a pasted
 * Invite_Link from a typed Invite_Code (Requirement 4.4).
 *
 * A URL with no base, so only an absolute address qualifies: an Invite_Code of 8
 * to 12 characters is not one, and neither is a bare `/join/…` path. The parsed
 * value is deliberately discarded — the segment is read from the candidate as
 * written, for the reason {@link secretFromInviteLink} gives.
 *
 * `URL` is a global of the URL Standard, present in both the browser and the
 * test runtime; it is not a DOM interface and it is not imported, so `lib/`
 * stays DOM-free (Requirement 18.2).
 */
function parsesAsUrl(candidate: string): boolean {
  try {
    new URL(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * The Invite_Secret carried by a pasted Invite_Link, or `null` when the
 * candidate is not a link carrying one.
 *
 * The segment is sliced out of the candidate **as written** rather than read
 * from the parsed URL's `pathname`, because URL parsing normalises dot segments:
 * a secret of `.` or `..` survives `inviteLandingPath` untouched — neither
 * character is percent-encoded — and would be *removed* from a parsed
 * `pathname`. Slicing the original string keeps every secret character-for-
 * character, which is what Requirement 4.4 asks the derivation for.
 */
function secretFromInviteLink(candidate: string): string | null {
  // 4.4: only something that parses as a URL is treated as a link. Everything
  // else — a short code above all — is the secret already.
  if (!parsesAsUrl(candidate)) {
    return null;
  }

  const path = pathWithoutQueryOrFragment(candidate);

  // 4.4: a URL that is not an invite link — a squad path, someone's homepage —
  // carries no secret to extract.
  if (!path.includes(INVITE_LANDING_PREFIX)) {
    return null;
  }

  // 4.4: the final segment is the token the backend hashes. `lastIndexOf` is
  // safe unconditionally: the marker guarantees at least one separator.
  const finalSegment = path.slice(
    path.lastIndexOf(PATH_SEGMENT_SEPARATOR) + PATH_SEGMENT_SEPARATOR.length,
  );

  const decoded = decodeSegment(finalSegment);
  if (decoded === null) {
    return null;
  }

  const secret = decoded.trim();

  // A link whose final segment is empty, whitespace, or undecodable carries no
  // secret. Answering `null` hands the candidate back to the caller unchanged
  // rather than submitting an empty value the backend could not match.
  return secret === '' ? null : secret;
}

/**
 * The Invite_Secret carried by a requested Invite_Landing_Route path, or a named
 * extraction failure (Requirements 5.9, 5.11).
 *
 * Reads the segment introduced by `/join/`, stops at the next separator, decodes
 * it inside a guard, trims it, and rejects an empty result. Together with
 * `inviteLandingPath` in `./routePaths` this is a round trip: for every non-empty
 * secret of up to 512 characters, reserved characters (`/ ? # & = % +`) and
 * non-ASCII characters included, the secret comes back character-for-character
 * (Requirement 5.11, pinned by Property 9).
 *
 * Pure and total: no clock, no navigation, no DOM, no exception, and the same
 * answer for the same path. Every input yields either a secret or one of three
 * reasons — a path with no marker, a truncated `/join/`, a whitespace-only
 * segment, a lone `%`, and a value that is not a string at all all classify.
 *
 * Trimming happens **after** decoding, so `%20` around a secret is removed just
 * as a literal space is. A secret that intends to carry leading or trailing
 * whitespace is therefore outside the round trip — which costs nothing, because
 * the backend's tokens carry none.
 *
 * @param path the requested path, as the router reports it; a query string and a
 *   fragment are ignored, and a value that is not a string is treated as
 *   carrying no segment
 * @returns the non-empty percent-decoded secret, or the reason it could not be
 *   read — never a thrown error
 *
 * Requirements: 5.9, 5.11
 */
export function extractInviteSecretFromPath(
  path: string,
): InviteSecretExtraction {
  // 5.9: a route value that never arrived is not a segment. Guarded at runtime
  // rather than trusted from the type, because the path comes from the router.
  if (typeof path !== 'string') {
    return { ok: false, reason: 'absent' };
  }

  const pathname = pathWithoutQueryOrFragment(path);
  const markerIndex = pathname.indexOf(INVITE_LANDING_PREFIX);

  // 5.9: no `/join/` marker means no `code` segment — a path of `/join`, or a
  // path belonging to some other route entirely.
  if (markerIndex < 0) {
    return { ok: false, reason: 'absent' };
  }

  const afterMarker = pathname.slice(
    markerIndex + INVITE_LANDING_PREFIX.length,
  );
  const nextSeparator = afterMarker.indexOf(PATH_SEGMENT_SEPARATOR);

  // The `code` segment is one segment: `/join/a/b` carries the secret `a`, and
  // never `a/b`, because `inviteLandingPath` encodes a `/` within a secret.
  const segment =
    nextSeparator < 0 ? afterMarker : afterMarker.slice(0, nextSeparator);

  // 5.9: the marker with nothing after it — a link truncated at the slash.
  if (segment === '') {
    return { ok: false, reason: 'empty' };
  }

  const decoded = decodeSegment(segment);

  // 5.9: a malformed percent-escape, which is what a hand-edited address bar
  // produces. A named failure, not a raised error.
  if (decoded === null) {
    return { ok: false, reason: 'undecodable' };
  }

  const secret = decoded.trim();

  // 5.9: empty after trimming — a segment of spaces, or of `%20`s.
  if (secret === '') {
    return { ok: false, reason: 'empty' };
  }

  return { ok: true, secret };
}

/**
 * The value to submit to `RedeemInvite` for whatever was entered into the
 * Join_Code_Form (Requirement 4.4).
 *
 * The Join_Code_Form accepts both shapes an invite arrives in, and this is the
 * single pure function that reduces them to the one value the backend matches:
 *
 * | Input                                                  | Result                        |
 * | ------------------------------------------------------ | ----------------------------- |
 * | an absolute URL whose path contains `/join/`            | the decoded final segment     |
 * | any other non-empty input                               | itself, trimmed, unchanged    |
 * | an empty or whitespace-only input                       | the empty string              |
 *
 * The second row is the short Invite_Code, which *is* the presentable secret and
 * so needs no derivation. Nothing is guessed beyond those two shapes: a
 * scheme-less `pitch-mate.co.uk/join/…` is passed through as typed and answered
 * by the backend, rather than repaired here on a hunch about what was meant.
 *
 * Returning the trimmed empty string for an empty input keeps the function
 * total. It is not a validation decision — Requirement 4.3 has the form issue no
 * `RedeemInvite` call while the field is empty after trimming, and that check
 * lives with the field it messages.
 *
 * Pure, total, and free of exceptions; the same input always yields the same
 * value. The result is passed to a request body and to nothing else — never to a
 * message, a stored value, or a logging function (Requirement 4.10).
 *
 * @param input the field value exactly as entered, an Invite_Link or an
 *   Invite_Code
 * @returns the redeemable value, trimmed
 *
 * Requirements: 4.2, 4.4
 */
export function redeemableValueFrom(input: string): string {
  // Guarded at runtime rather than trusted from the type, because the value
  // originates in a form field.
  if (typeof input !== 'string') {
    return '';
  }

  // 4.2: the submitted value is trimmed, whichever shape it arrived in.
  const trimmed = input.trim();

  // 4.4: a link yields its token; anything else is already the secret.
  return secretFromInviteLink(trimmed) ?? trimmed;
}
