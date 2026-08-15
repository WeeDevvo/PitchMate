/**
 * Pure heading-outline validation for the web auth screens.
 *
 * A well-formed screen outline (see accessibility requirements) has exactly
 * one level-1 heading and never skips a heading level: no heading may be more
 * than one level deeper than the heading immediately preceding it.
 */

/** A single heading in document order, with its level (1 = h1, 2 = h2, …). */
export interface HeadingNode {
  level: number;
  text: string;
}

/** The outcome of validating a heading sequence. */
export interface OutlineResult {
  /** True iff there is exactly one level-1 heading and no level is skipped. */
  ok: boolean;
  /** The number of headings with `level === 1`. */
  h1Count: number;
  /** Index of the first heading that skips a level, or `null` if none skip. */
  skippedAt: number | null;
}

/**
 * Validate a heading sequence for a well-formed document outline.
 *
 * The sequence is well-formed (`ok === true`) if and only if it contains
 * exactly one level-1 heading AND no heading is more than one level deeper than
 * the heading immediately preceding it (no skipped levels). `skippedAt` is the
 * index of the first heading whose level exceeds the previous heading's level by
 * more than one, or `null` when no such skip occurs. The first heading has no
 * predecessor and therefore cannot itself be a skip; the "exactly one h1" rule
 * covers the case of an outline that fails to start at level 1.
 *
 * Requirements: 14.1
 */
export function computeHeadingOutline(headings: HeadingNode[]): OutlineResult {
  let h1Count = 0;
  let skippedAt: number | null = null;

  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];

    if (current.level === 1) {
      h1Count += 1;
    }

    if (index > 0 && skippedAt === null) {
      const previous = headings[index - 1];
      if (current.level - previous.level > 1) {
        skippedAt = index;
      }
    }
  }

  return {
    ok: h1Count === 1 && skippedAt === null,
    h1Count,
    skippedAt,
  };
}
