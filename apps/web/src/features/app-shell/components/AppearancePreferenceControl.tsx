/**
 * The Appearance_Preference_Control — three native radios in one group.
 *
 * Requirement 12.4 asks for a single group of exactly three mutually exclusive
 * options carrying `system`, `dark`, and `light`, a group name that says the
 * subject is appearance, a visible text label of 1 to 24 characters on each
 * option, exactly the option matching the current Appearance_Preference reported
 * as selected and the other two reported as not selected, and the whole group
 * reachable and selectable by keyboard alone with focus entering on the currently
 * selected option.
 *
 * Every one of those is what a `<fieldset>` + `<legend>` around three
 * `<input type="radio">` sharing one `name` already does:
 *
 * - the fieldset is a group and the legend names it, so no `role` or
 *   `aria-label` is written here;
 * - one shared `name` makes the options mutually exclusive, so selecting one
 *   deselects the others without any code saying so;
 * - `checked` maps straight to the reported selected state, so exactly one option
 *   reports as selected for any preference value;
 * - the browser puts only the checked radio of a group in the Tab order, which is
 *   precisely "focus enters the group on the currently selected option"; and
 * - arrow keys move and select within the group natively, so this component
 *   registers **no** key handler. A custom one would be a second, weaker
 *   implementation of behaviour the platform already gets right, and would have
 *   to be re-derived for every keyboard layout and reading direction.
 *
 * The current value is therefore determinable without colour, without visual
 * position, and without a pointer (Requirement 12.4).
 *
 * ### It decides nothing
 *
 * Resolution, persistence, cross-context adoption, and the rejected-write
 * behaviour all live in {@link ShellThemeProvider} and `src/theme`. This control
 * reads `preference` to report the selected option and calls `setPreference` on a
 * change — that single call is what applies the newly resolved Theme's tokens to
 * the frame and the active Destination_Content in place, with no full-document
 * reload, and writes the value under the one namespaced storage key
 * (Requirement 12.5). A write the browser rejects changes nothing here: the
 * provider keeps the selected value for the session, so this control keeps
 * reporting it and renders no error (Requirement 12.14).
 *
 * No colour value is written here either — `styles/shell.css` resolves the
 * control's presentation from the per-Theme token tables (Requirement 12.8), and
 * `.shell-appearance__option` is the class that carries the Compact_Layout
 * pointer target size (Requirement 13.13).
 *
 * Requirements: 12.4, 12.5, 12.8, 12.14, 13.13
 */
import { type ReactElement } from 'react';
import { useShellTheme } from './ShellThemeProvider';
import {
  APPEARANCE_GROUP_LABEL,
  APPEARANCE_OPTION_LABELS,
} from '../lib/messages';
import { APPEARANCE_PREFERENCES } from '../lib/theme';

/**
 * The shared `name` that makes the three options one radio group.
 *
 * Exported so a test can assert the group is single, not because a caller is
 * expected to change it.
 */
export const APPEARANCE_RADIO_GROUP_NAME = 'shell-appearance';

export interface AppearancePreferenceControlProps {
  /**
   * The radio group's `name`. Overridable only so a surface rendering two
   * controls at once — a test harness, in practice — does not collapse them into
   * one group.
   */
  readonly name?: string;
}

/**
 * Render the appearance option group, reporting and setting the
 * Appearance_Preference held by the Theme_Provider.
 *
 * Requirements: 12.4, 12.5, 12.14
 */
export function AppearancePreferenceControl({
  name = APPEARANCE_RADIO_GROUP_NAME,
}: AppearancePreferenceControlProps): ReactElement {
  const { preference, setPreference } = useShellTheme();

  return (
    <fieldset className="shell-appearance">
      {/* 12.4: the group's accessible name, naming appearance as its subject. */}
      <legend className="shell-appearance__legend">{APPEARANCE_GROUP_LABEL}</legend>
      {/* The three values come from the shared module's presentation order, so
          this component cannot register a fourth option or miss one. */}
      {APPEARANCE_PREFERENCES.map((value) => (
        <label
          key={value}
          className="shell-appearance__option"
          // The selected option as an attribute, for the stylesheet and the
          // layout tests, alongside the radio's own reported state.
          data-appearance={value}
          data-selected={preference === value ? 'true' : 'false'}
        >
          <input
            className="shell-appearance__radio"
            type="radio"
            name={name}
            value={value}
            // 12.4: exactly one option reports as selected; the other two report
            // as not selected.
            checked={preference === value}
            // 12.5, 12.14: pointer and keyboard selection arrive here alike, and
            // the provider does the rest.
            onChange={() => setPreference(value)}
          />
          <span className="shell-appearance__label">
            {APPEARANCE_OPTION_LABELS[value]}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export default AppearancePreferenceControl;
