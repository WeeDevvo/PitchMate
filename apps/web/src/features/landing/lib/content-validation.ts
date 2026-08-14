/**
 * Pure content-validation logic for the marketing landing page.
 *
 * The landing page speaks to casual players in plain, benefit-focused language
 * and never surfaces PitchMate's technical concepts. This module provides a
 * case-insensitive scanner that flags any prohibited technical vocabulary so
 * offending copy is caught at build/test time and never shipped.
 */

/**
 * Technical terms that must never appear in visible landing-page content.
 *
 * The Greek letters `μ` (mu) and `σ` (sigma) are single-character terms matched
 * as case-insensitive substrings.
 *
 * Requirements: 1.2, 2.6, 2.8, 7.3
 */
export const PROHIBITED_TERMS = [
  'rating',
  'algorithm',
  'openskill',
  'μ',
  'σ',
  'rsvp',
  'event log',
] as const;

/**
 * Scan `text` for prohibited technical vocabulary.
 *
 * Matching is case-insensitive (via `toLowerCase`), which also folds the
 * upper-case Greek forms `Μ`/`Σ` onto their lower-case counterparts. Returns the
 * canonical term(s) from {@link PROHIBITED_TERMS} that were found, in declaration
 * order and without duplicates. Returns an empty array when the text is clean.
 *
 * Requirements: 1.2, 2.6, 2.8, 7.3
 */
export function findProhibitedTerms(text: string): string[] {
  const haystack = text.toLowerCase();
  return PROHIBITED_TERMS.filter((term) => haystack.includes(term.toLowerCase()));
}
