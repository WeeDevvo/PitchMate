/**
 * The Settings_Destination's content — the appearance section, then whatever a
 * later feature injects.
 *
 * This is the one Destination the App_Shell supplies content for besides the
 * Notifications_Destination, because the Appearance_Preference_Control is the
 * shell's own surface (Requirements 3.1, 12.4). Anything else that belongs on a
 * settings screen arrives through `destinationContent.settings` and is rendered
 * *after* the appearance section, so a later feature adds settings without
 * touching this file (Requirement 15.4).
 *
 * ### The heading
 *
 * The frame renders no level-one heading (Requirements 1.9, 13.2), so this
 * content contributes the one `h1` of the `/app/settings` route — and
 * {@link ContentRegion} finds and announces exactly this element when the
 * Content_Region changes (Requirement 13.12). Its text is the label registered
 * for the Settings_Destination rather than a literal, so the heading and the
 * destination's Primary_Navigation control cannot drift apart.
 *
 * Injected content must therefore start no higher than a level-two heading; the
 * appearance section itself adds no heading at all, since its `<fieldset>` legend
 * already names it.
 *
 * Requirements: 3.1, 12.4, 13.2, 15.4
 */
import { type ReactElement, type ReactNode } from 'react';
import { AppearancePreferenceControl } from './components/AppearancePreferenceControl';
import { destinationLabel } from './lib/destinations';

export interface SettingsDestinationProps {
  /**
   * Extra settings sections, supplied as `destinationContent.settings` where the
   * route table is assembled. Rendered after the appearance section; omitted
   * entirely when nothing is injected, which is the MVP.
   */
  readonly children?: ReactNode;
}

/**
 * Render the Settings_Destination: one level-one heading, the appearance option
 * group, then any injected settings content.
 *
 * Requirements: 3.1, 12.4, 13.2
 */
export function SettingsDestination({ children }: SettingsDestinationProps): ReactElement {
  return (
    <div className="shell-settings">
      {/* 13.2: the route's single level-one heading, contributed by the content. */}
      <h1>{destinationLabel('settings')}</h1>
      {/* 12.4: the appearance section comes first, so the shell's own setting is
          reached before anything a later feature adds. */}
      <AppearancePreferenceControl />
      {children}
    </div>
  );
}

export default SettingsDestination;
