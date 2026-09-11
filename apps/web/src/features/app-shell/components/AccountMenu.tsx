/**
 * The Account_Menu — the Shell_Header surface holding Profile, Settings, and
 * Sign out.
 *
 * Like the Notification_Panel, this is the *contents* of a disclosure plus the
 * trigger that opens it: {@link Disclosure} owns `aria-expanded`/`aria-controls`,
 * the Escape close that returns focus to the trigger (Requirement 8.5), and the
 * outside-pointer close that leaves focus where the pointer put it
 * (Requirement 8.7), and the header's disclosure group makes this surface and the
 * Notification_Panel mutually exclusive by construction (Requirement 8.8). None
 * of that is restated here.
 *
 * ### Why this is not a `role="menu"`
 *
 * Requirement 8.3 is explicit: the three controls are each reachable and
 * activatable **using only Tab and Shift+Tab**, and no arrow-key, Home-key, or
 * End-key focus model is required to reach or activate any of them. That rules
 * `role="menu"` out rather than merely making it optional — an ARIA menu commits
 * to the opposite contract, where the menu takes focus, its `menuitem`s are
 * removed from the tab sequence, and arrow keys become the only way to move
 * between them. Adopting the role and then not implementing that model would
 * leave the markup promising a keyboard interface the component does not have,
 * which is worse for a screen-reader user than the plain alternative.
 *
 * So this is what it says on the tin: a disclosure containing a list of three
 * ordinary controls — two router `Link`s and one `<button>`. Each is natively
 * focusable and in the document's tab sequence, in the order Requirement 8.2
 * fixes, and each activates from Enter (and Space, for the button) with no key
 * handler written here. `Disclosure` renders the surface immediately after the
 * trigger in DOM order, so Tab from the trigger lands on Profile and Shift+Tab
 * from Profile lands back on the trigger, with no focus trap and no `aria-modal`
 * (Requirement 13.6). The `<ul>` is a plain grouping element: it tells assistive
 * technology there are three items without claiming a widget role.
 *
 * ### No account detail, deliberately (Requirements 8.1, 8.4)
 *
 * The trigger's name is the fixed {@link ACCOUNT_MENU_LABEL}, rendered as its
 * visible text so the visible label and the accessible name are the same string.
 * Neither the trigger nor the surface renders an account name, an email address,
 * or an avatar image — the shell has no backend account read model to read one
 * from, and Requirement 8.4 forbids disclosing one regardless. Nothing in this
 * file reads the Session: the Auth_Feature's sign-out arrives as a plain function
 * prop (Requirements 15.1, 15.2), and there is no `useAuth` call here.
 *
 * ### Closing on navigation (Requirement 8.6)
 *
 * Activating Profile or Settings closes the menu and navigates. `Disclosure`
 * moves no focus for an `'activate'` close, because the caller knows what is
 * about to happen to the element holding focus — so, exactly as
 * {@link PrimaryNavigation} does, focus is returned to the trigger *before* the
 * close is requested: the activated `Link` unmounts with the surface, and moving
 * focus first means it never lands on `<body>` in between. The navigation itself
 * is the `Link`'s own business and happens either way, client-side and without a
 * full-document reload.
 *
 * ### Sign-out: the waiting is here, the sign-out is not
 *
 * Every decision about the sign-out lifecycle lives in
 * {@link useSignOut} — the single flight, the 10-second watchdog, the failure
 * message, and cancelling the poll loop on completion (Requirements 8.9–8.13).
 * What this component decides is how those three states are *presented*:
 *
 * | State | Presentation |
 * | --- | --- |
 * | resting | the plain label, no progress indication, activatable (Req 8.12) |
 * | pending | {@link SIGN_OUT_IN_PROGRESS} beside the label, `aria-busy`, `aria-disabled` (Req 8.10) |
 * | failed | {@link SIGN_OUT_FAILED} in an alert region the control describes (Req 8.11) |
 *
 * The pending control is `aria-disabled`, never `disabled`. Requirement 8.10 asks
 * for keyboard focus to be *retained on the Sign_Out_Control* while a sign-out is
 * in progress, and a genuinely disabled button drops the focus of the person who
 * just activated it onto `<body>`. The prevention the requirement asks for is
 * already absolute in the hook, which rejects a second activation outright, so
 * `aria-disabled` reports a state that is true rather than creating one.
 *
 * Activating the Sign_Out_Control requests no close, which is how the menu stays
 * open for the duration (Requirement 8.10) and how the failure message has
 * somewhere to appear. A person may still close the menu themselves — Escape and
 * an outside pointer are unconditional in Requirements 8.5 and 8.7 — and the hook
 * survives that unmounting without stranding a state update.
 *
 * All presentation comes from `styles/shell.css`; no colour is written here
 * (Requirements 12.8, 13.4).
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 8.11, 8.12, 13.6
 */
import { useCallback, useId, useRef, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import {
  PROFILE_ROUTE,
  SETTINGS_ROUTE,
  destinationLabel,
} from '../lib/destinations';
import {
  ACCOUNT_MENU_LABEL,
  SIGN_OUT_IN_PROGRESS,
  SIGN_OUT_LABEL,
} from '../lib/messages';
import { useSignOut } from '../state/useSignOut';
import { Disclosure } from './Disclosure';
import type { ShellHeaderSlotProps } from './ShellHeader';

export interface AccountMenuProps extends ShellHeaderSlotProps {
  /**
   * The Auth_Feature's sign-out navigation, injected from the shell's route table
   * (task 14.5).
   *
   * A plain function, so this component neither imports the Auth_Feature nor
   * touches a Session, a token, or a router of its own (Requirements 8.9, 15.1,
   * 15.2).
   */
  readonly signOut: () => Promise<void>;
  /**
   * Called once when that navigation resolves, for the caller to cancel the
   * scheduled unread-count calls (Requirement 8.13).
   *
   * Optional: the cancellation belongs to whoever owns the notification centre,
   * not to the menu.
   */
  readonly onSignOutComplete?: () => void;
}

/**
 * Render the Account_Menu's trigger and the surface it discloses.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 8.11, 8.12, 13.6
 */
export function AccountMenu({
  disclosure,
  signOut,
  onSignOutComplete,
}: AccountMenuProps): ReactElement {
  const { open, requestOpen, requestClose } = disclosure;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const failureId = useId();

  // 8.9–8.13: the whole sign-out lifecycle, decided in one tested place.
  const { pending, failureMessage, activate } = useSignOut(signOut, onSignOutComplete);

  /**
   * 8.6: a navigation control closes the menu, and focus returns to the trigger
   * before the surface unmounts underneath it.
   */
  const handleNavigate = useCallback((): void => {
    if (!open) {
      return;
    }
    triggerRef.current?.focus();
    requestClose('activate');
  }, [open, requestClose]);

  /**
   * 8.10: a second concurrent activation does nothing. The hook rejects it too;
   * stating it here as well keeps the `aria-disabled` the control reports
   * truthful. No close is requested, so the menu stays open for the duration.
   */
  const handleSignOut = useCallback((): void => {
    if (pending) {
      return;
    }
    activate();
  }, [activate, pending]);

  return (
    <Disclosure
      id={disclosure.surfaceId}
      open={open}
      onRequestOpen={requestOpen}
      onRequestClose={requestClose}
      className="shell-account-menu"
      surfaceClassName="shell-account-menu__surface"
      trigger={(triggerProps) => (
        <button
          ref={triggerRef}
          type="button"
          className="shell-account-menu__trigger"
          {...triggerProps}
        >
          {/* 8.1, 8.4: fixed text naming the menu, and no value from the Session.
              Name-from-content, so the visible label *is* the accessible name. */}
          {ACCOUNT_MENU_LABEL}
        </button>
      )}
    >
      {/*
       * 8.2, 8.3: exactly three controls, in this document order, each natively
       * focusable and in the tab sequence. A plain list — no `role="menu"`, no
       * `role="menuitem"`, no arrow-key model (see the note at the top of this
       * file).
       */}
      <ul className="shell-account-menu__list">
        <li className="shell-account-menu__entry">
          <Link
            to={PROFILE_ROUTE}
            className="shell-account-menu__item"
            data-account-control="profile"
            onClick={handleNavigate}
          >
            {/* Read from the registry, so this label and the Profile_Destination's
                Primary_Navigation control can never disagree. */}
            {destinationLabel('profile')}
          </Link>
        </li>
        <li className="shell-account-menu__entry">
          <Link
            to={SETTINGS_ROUTE}
            className="shell-account-menu__item"
            data-account-control="settings"
            onClick={handleNavigate}
          >
            {destinationLabel('settings')}
          </Link>
        </li>
        <li className="shell-account-menu__entry">
          <button
            type="button"
            className="shell-account-menu__item shell-account-menu__sign-out"
            data-account-control="sign-out"
            // 8.10: progress reported programmatically and a second activation
            // prevented — without `disabled`, which would take focus off the
            // control the requirement says must keep it.
            aria-disabled={pending ? true : undefined}
            aria-busy={pending ? true : undefined}
            // 8.11: the failure is associated with the control that produced it.
            aria-describedby={failureMessage === null ? undefined : failureId}
            data-pending={pending ? 'true' : 'false'}
            onClick={handleSignOut}
          >
            {/* 8.2: the visible label, unchanged in every state, so the control a
                person names by speech stays the same control. */}
            <span className="shell-account-menu__item-label">{SIGN_OUT_LABEL}</span>
            {/* 8.10, 8.12: progress as words beside the label, and no element at
                all while nothing is in progress. */}
            {pending ? (
              <span className="shell-account-menu__progress">{SIGN_OUT_IN_PROGRESS}</span>
            ) : null}
          </button>
        </li>
      </ul>

      {/*
       * 8.11: the error indication. Announced without moving focus — the control
       * keeps it — and not a control itself, so the menu still presents exactly
       * three (Requirement 8.2). There is no retry control: the Sign_Out_Control
       * has been handed back and is the way to try again.
       */}
      {failureMessage === null ? null : (
        <p
          id={failureId}
          className="shell-account-menu__failure"
          role="alert"
          aria-live="assertive"
          data-shell-sign-out-failure="true"
        >
          {failureMessage}
        </p>
      )}
    </Disclosure>
  );
}

export default AccountMenu;
