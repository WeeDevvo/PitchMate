/**
 * The button classes a link takes to read as a button: the same classes
 * `Button` renders for the same variant, size and width.
 */
import { describe, expect, it } from 'vitest';

import { buttonClasses } from '.';

describe('buttonClasses', () => {
  it('defaults to a medium primary button', () => {
    expect(buttonClasses()).toBe('pm-btn pm-btn--primary');
  });

  it('names the variant, a non-default size and the block width', () => {
    expect(buttonClasses({ variant: 'secondary', size: 'lg', block: true })).toBe(
      'pm-btn pm-btn--secondary pm-btn--lg pm-btn--block',
    );
  });

  it('names the ink variant for a call to action on a green band', () => {
    expect(buttonClasses({ variant: 'ink', size: 'lg' })).toBe('pm-btn pm-btn--ink pm-btn--lg');
  });
});
