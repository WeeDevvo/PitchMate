import googleG from '../design/logos/google-g.svg';

export interface GoogleMarkProps {
  /** Tile size in px. */
  size?: number;
}

/**
 * Google's "G" on its white tile, for "Continue with Google". Google's brand
 * rules fix its colours, so it is a supplied asset (tile included), never
 * redrawn or recoloured. Decorative: the button's label names the provider.
 */
export function GoogleMark({ size = 22 }: GoogleMarkProps) {
  return <img className="pm-google" src={googleG} width={size} height={size} alt="" />;
}
