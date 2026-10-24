import appIcon from '../design/logos/pitchmate-app-icon.png';
import markGreen from '../design/logos/pitchmate-mark-green.png';
import markInk from '../design/logos/pitchmate-mark-ink.png';
import markWhite from '../design/logos/pitchmate-mark-white.png';
import { cx } from './cx';
import './Logo.css';

export interface LogoProps {
  /** Mark height in px. */
  size?: number;
  wordmark?: boolean;
  /**
   * `auto` shows the green mark in the dark theme and the ink mark in the light
   * theme. `icon` is the app icon, for app-icon contexts only.
   */
  variant?: 'auto' | 'green' | 'ink' | 'white' | 'icon';
  href?: string;
  className?: string;
}

const MARKS = { green: markGreen, ink: markInk, white: markWhite };

export function Logo({ size = 32, wordmark = true, variant = 'auto', href, className }: LogoProps) {
  const markWidth = Math.round(size * 0.92);
  const mark =
    variant === 'icon' ? (
      <img src={appIcon} width={size} height={size} alt="" style={{ borderRadius: size * 0.22 }} />
    ) : variant === 'auto' ? (
      <>
        <img className="pm-logo__mark--dark" src={markGreen} width={markWidth} height={size} alt="" />
        <img className="pm-logo__mark--light" src={markInk} width={markWidth} height={size} alt="" />
      </>
    ) : (
      <img src={MARKS[variant]} width={markWidth} height={size} alt="" />
    );
  const content = (
    <>
      {mark}
      {wordmark && (
        <span className="pm-logo__word" style={{ fontSize: size * 0.78 }} aria-hidden="true">
          Pitch<b>Mate</b>
        </span>
      )}
    </>
  );

  return href ? (
    <a className={cx('pm-logo', className)} href={href} aria-label="PitchMate">
      {content}
    </a>
  ) : (
    <span className={cx('pm-logo', className)} role="img" aria-label="PitchMate">
      {content}
    </span>
  );
}
