import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';

/** Renders the current location, so a test can see where a screen navigated. */
export function LocationProbe(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}
