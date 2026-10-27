import { cx } from './cx';
import './Button.css';

export interface ButtonClassOptions {
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'accent-ghost' | 'ink';
  size?: 'sm' | 'md' | 'lg' | 'pitch';
  block?: boolean;
}

/**
 * The button classes, for a link that reads as a button (a call to action that
 * navigates). Use `Button` for anything that acts on the page.
 */
export function buttonClasses({ variant = 'primary', size = 'md', block }: ButtonClassOptions = {}): string {
  return cx('pm-btn', `pm-btn--${variant}`, size !== 'md' && `pm-btn--${size}`, block && 'pm-btn--block');
}
