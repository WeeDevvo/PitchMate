/**
 * WCAG 2.1 contrast between design-system colour tokens, resolved from
 * `tokens.json` for a theme. Used by the token contrast tests.
 */
import tokens from './tokens.json';

export type DesignTheme = 'dark' | 'light';

const byName = new Map(tokens.color.tokens.map((token) => [token.name, token.value]));

/** A colour token's hex value in a theme, following `{alias}` references. */
export function resolveColour(name: string, theme: DesignTheme): string {
  const value = byName.get(name)?.[theme];
  if (value === undefined) {
    throw new Error(`Unknown colour token ${name}`);
  }
  const alias = /^\{([a-z0-9-]+)\}$/.exec(value);
  return alias ? resolveColour(alias[1], theme) : value;
}

function luminance(hex: string): number {
  const int = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio between two colour tokens in a theme. */
export function tokenContrast(foreground: string, background: string, theme: DesignTheme): number {
  const [a, b] = [luminance(resolveColour(foreground, theme)), luminance(resolveColour(background, theme))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
