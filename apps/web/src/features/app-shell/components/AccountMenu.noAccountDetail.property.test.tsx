/**
 * Property test for the Account_Menu's disclosure surface (task 12.3).
 *
 * **Property 27: The account menu discloses no account detail.** *For any*
 * established session, the account-menu control's accessible name is one fixed
 * text naming the account menu that contains no value read from the session, and
 * neither that control nor the opened menu renders an account name, an email
 * address, or an avatar image.
 *
 * Two acceptance criteria:
 *
 * | Criterion | What it asks | Where it is asserted |
 * | --- | --- | --- |
 * | 8.1 | exactly one control, its accessible name fixed text naming the account menu, containing no value read from the Session | {@link expectFixedTriggerName} |
 * | 8.4 | no account name, no email address, and no avatar image on the control or within the menu | {@link expectNoAccountDetail} |
 *
 * ### What "no value read from the session" is measured against
 *
 * The Auth_Feature's `Session` is a token pair plus an expiry instant — it holds
 * no account name, email address, or avatar URL of its own, and the shell has no
 * backend account read model to fetch one from. So the values a leak *could* be
 * built from are the tokens themselves, and the only account detail reachable
 * from them is whatever an Access_Token happens to carry in its payload. Every
 * generated session therefore establishes a **JWT-shaped Access_Token whose
 * payload base64-encodes a display name, an email address, an avatar URL, and a
 * subject id** — exactly the shape an implementation would decode if it decided
 * to put a name or an avatar on the trigger — and the property asserts that none
 * of those values, and neither raw token, reaches the document in any form: not
 * as text, not as an attribute value, not as an element id.
 *
 * The session is established through a **real `SessionManager`** over a real
 * `AuthProvider`, and every run asserts through {@link AuthStateProbe} that the
 * tree really did render with the Auth_State `authenticated`. Without that, "no
 * account detail was disclosed" could hold for a tree in which no session existed
 * to disclose anything from.
 *
 * ### Why the whole document is inspected, not the accessibility tree
 *
 * A leaked email address in a `title`, a `data-` attribute, an `aria-label`, or an
 * avatar URL in an inline `background-image` is still a disclosure. The value
 * checks therefore run against `documentElement.innerHTML` — markup, attributes
 * and all — while the image and text-residue checks are scoped to the disclosure
 * container, which holds the trigger and the surface and so is precisely the "on
 * the opening control and within the Account_Menu" that Requirement 8.4 names.
 *
 * The residue check is the half that catches an account detail the generators
 * never supplied: every fixed string the menu is allowed to render is subtracted
 * from the container's text, and what remains must be nothing at all. An invented
 * initial, a hard-coded name, or a stray "signed in as" would survive that
 * subtraction.
 *
 * ### The sign-out states are part of the opened menu
 *
 * The second property re-checks the same claims in the three states the menu can
 * be observed in — resting, a sign-out in progress, and a sign-out that did not
 * complete — because each renders further text, and the requirement is about the
 * opened menu rather than about one instant of it.
 *
 * Per-example assertions on the trigger's name and the absence of images live in
 * `AccountMenu.test.tsx`; this file is the generator-driven property at the
 * 100-iteration floor Requirement 14.2 sets. A harness control at the foot of the
 * file proves the leak checks fail for a menu that *does* display account detail,
 * so the property is not a fact about an inert harness.
 *
 * Feature: app-shell, Property 27: The account menu discloses no account detail
 * Validates: Requirements 8.1, 8.4
 */
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fc from 'fast-check';

import {
  AuthProvider,
  createInMemorySessionStore,
  createSessionManager,
  useAuth,
  type AuthState,
  type Session,
  type SessionManager,
} from '../../auth';
import { AccountMenu } from './AccountMenu';
import { destinationLabel } from '../lib/destinations';
import {
  ACCOUNT_MENU_LABEL,
  SIGN_OUT_FAILED,
  SIGN_OUT_IN_PROGRESS,
  SIGN_OUT_LABEL,
} from '../lib/messages';
import { useDisclosureGroup } from '../state/useDisclosureGroup';

/** The surface id the Shell_Header supplies for the account disclosure. */
const SURFACE_ID = 'shell-account-menu';

/** Every fixed string the Account_Menu is permitted to render. */
const ALLOWED_TEXT: readonly string[] = [
  ACCOUNT_MENU_LABEL,
  destinationLabel('profile'),
  destinationLabel('settings'),
  SIGN_OUT_LABEL,
  SIGN_OUT_IN_PROGRESS,
  SIGN_OUT_FAILED,
];

// --- The generated account detail -------------------------------------------

/**
 * Display names an implementation might reach for: short and long, hyphenated and
 * apostrophed, and non-Latin — the last of which also forces the token encoding
 * to handle text `btoa` alone cannot.
 */
const DISPLAY_NAMES: readonly string[] = [
  'Dave',
  'BigDave',
  'Priya Kaur',
  'Jean-Luc Fontaine',
  "Aoife O'Brien",
  'Müller',
  'Ngozi Adeyemi',
  '张伟',
  'Þórunn Jónsdóttir',
];

/** Email addresses, including the shapes that survive naive escaping badly. */
const EMAIL_ADDRESSES: readonly string[] = [
  'dave@example.com',
  'priya.kaur@squad.example',
  'ngozi+pitchmate@mail.example',
  'müller@example.de',
  'j.fontaine@sub.domain.example.co.uk',
];

const hexDigitArb = fc.constantFrom(...'0123456789abcdef'.split(''));

const hexRun = (minLength: number, maxLength: number): fc.Arbitrary<string> =>
  fc.string({ unit: hexDigitArb, minLength, maxLength });

/** Avatar locations, as an object-storage URL on a User record would be. */
const avatarUrlArb: fc.Arbitrary<string> = hexRun(8, 32).map(
  (id) => `https://cdn.example.com/avatars/${id}.png`,
);

/** The account detail a leak would be built from. */
interface AccountDetail {
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string;
  readonly userId: string;
}

/** An established session, paired with the detail its Access_Token carries. */
interface EstablishedSession {
  readonly session: Session;
  readonly detail: AccountDetail;
  /** The Access_Token's payload segment, as it appears in the token. */
  readonly payloadSegment: string;
}

/** Base64url of arbitrary text, unicode included — `btoa` alone rejects it. */
function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let latin1 = '';
  for (const byte of bytes) {
    latin1 += String.fromCharCode(byte);
  }
  return btoa(latin1).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

const accountDetailArb: fc.Arbitrary<AccountDetail> = fc.record({
  name: fc.constantFrom(...DISPLAY_NAMES),
  email: fc.constantFrom(...EMAIL_ADDRESSES),
  avatarUrl: avatarUrlArb,
  userId: fc.uuid(),
});

/**
 * An established session whose Access_Token is JWT-shaped and carries the
 * generated account detail in its payload.
 *
 * Expiry instants are realistic epoch milliseconds, so the decimal string of the
 * expiry is 13 digits and cannot coincide with a React-generated element id.
 */
const establishedSessionArb: fc.Arbitrary<EstablishedSession> = fc
  .tuple(
    accountDetailArb,
    hexRun(24, 48),
    fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 }),
  )
  .map(([detail, refreshToken, expiresAtMs]) => {
    const payloadSegment = base64Url(
      JSON.stringify({
        sub: detail.userId,
        name: detail.name,
        email: detail.email,
        picture: detail.avatarUrl,
        exp: Math.floor(expiresAtMs / 1000),
      }),
    );
    const accessToken = `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${payloadSegment}.${base64Url(
      `signature-${detail.userId}`,
    )}`;

    return {
      detail,
      payloadSegment,
      session: { accessToken, refreshToken, expiresAtMs },
    };
  });

/** Every value a disclosure could be built from, for the markup checks. */
function sessionValues(established: EstablishedSession): readonly string[] {
  const { detail, session, payloadSegment } = established;
  return [
    detail.name,
    detail.email,
    detail.avatarUrl,
    detail.userId,
    session.accessToken,
    session.refreshToken,
    payloadSegment,
    String(session.expiresAtMs),
  ];
}

// --- The harness -------------------------------------------------------------

/** A {@link SessionManager} holding `session` as the current Session. */
function managerWith(session: Session): SessionManager {
  const manager = createSessionManager({
    storage: createInMemorySessionStore(),
    api: {
      refresh: vi.fn(async () => ({ kind: 'transport-failure' as const })),
      signOut: vi.fn(async () => ({ kind: 'success' as const })),
    },
    now: () => 1_700_000_000_000,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated: vi.fn(),
  });
  // Establishing before the render means the tree mounts with the session already
  // in place, which is the "established session" the property is stated over.
  manager.establish(session);
  return manager;
}

/**
 * Reports the Auth_State the tree rendered with, and renders nothing — so the
 * document contains only what the Account_Menu put there.
 */
function AuthStateProbe({
  onState,
}: {
  readonly onState: (state: AuthState) => void;
}): ReactElement | null {
  const { state } = useAuth();
  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return null;
}

/** Wires the menu the way the Shell_Header does, over the frame's disclosure group. */
function Harness({
  signOut,
  onState,
}: {
  readonly signOut: () => Promise<void>;
  readonly onState: (state: AuthState) => void;
}): ReactElement {
  const { open, toggle, close } = useDisclosureGroup();

  return (
    <>
      <AuthStateProbe onState={onState} />
      <AccountMenu
        disclosure={{
          surfaceId: SURFACE_ID,
          open: open === 'account',
          requestOpen: () => toggle('account'),
          requestClose: () => close('account'),
        }}
        signOut={signOut}
      />
    </>
  );
}

interface MountedMenu {
  /** The Auth_State the tree rendered with; must be `authenticated`. */
  readonly authState: () => AuthState | null;
}

function mountMenu(
  session: Session,
  signOut: () => Promise<void> = async () => {},
): MountedMenu {
  const observed: { state: AuthState | null } = { state: null };

  render(
    <AuthProvider manager={managerWith(session)}>
      <MemoryRouter initialEntries={['/app']}>
        <Harness
          signOut={signOut}
          onState={(state) => {
            observed.state = state;
          }}
        />
      </MemoryRouter>
    </AuthProvider>,
  );

  return { authState: () => observed.state };
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: ACCOUNT_MENU_LABEL });
}

/** The disclosure container: the trigger plus the surface while it is open. */
function container(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-shell-disclosure="${SURFACE_ID}"]`,
  );
  if (element === null) {
    throw new Error('The Account_Menu disclosure container is not rendered.');
  }
  return element;
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirement 8.1: exactly one control opens the menu, and its accessible name is
 * the one fixed text naming the account menu — with the visible label the same
 * string, and nothing from the session in either.
 */
function expectFixedTriggerName(established: EstablishedSession): void {
  const controls = container().querySelectorAll('[aria-controls]');
  expect(controls).toHaveLength(1);

  const control = trigger();
  expect(control).toHaveAccessibleName(ACCOUNT_MENU_LABEL);
  // Name from content, so the visible label and the accessible name agree.
  expect(control.textContent).toBe(ACCOUNT_MENU_LABEL);
  // Fixed text that names the account menu, rather than naming a person.
  expect(ACCOUNT_MENU_LABEL).toMatch(/account/iu);
  for (const value of sessionValues(established)) {
    expect(ACCOUNT_MENU_LABEL.toLowerCase()).not.toContain(value.toLowerCase());
  }
}

/** Selectors for anything that renders, or could carry, an image. */
const IMAGE_SELECTOR =
  'img, svg, picture, source, object, canvas, video, [role="img"], input[type="image"], [src], [srcset], [poster], [style*="background-image"], [style*="url("]';

/**
 * Requirement 8.4: no account name, no email address, and no avatar image — on
 * the opening control or within the menu.
 *
 * @param allowedExtras fixed strings the current sign-out state adds.
 */
function expectNoAccountDetail(
  established: EstablishedSession,
  allowedExtras: readonly string[] = [],
): void {
  const region = container();

  // No avatar image, and nothing that could load one.
  expect(region.querySelectorAll(IMAGE_SELECTOR)).toHaveLength(0);

  // No email address: an `@` in an address shape would be one wherever it sat.
  const text = region.textContent ?? '';
  expect(text).not.toContain('@');
  expect(region.innerHTML).not.toMatch(/[^\s"'<>@]+@[^\s"'<>@]+\.[a-z]{2,}/iu);

  // No account name, invented or otherwise: subtract every fixed string the menu
  // may render and nothing at all may remain.
  const allowed = [...ALLOWED_TEXT, ...allowedExtras];
  let residue = text;
  for (const phrase of allowed) {
    residue = residue.split(phrase).join('');
  }
  expect(residue.trim()).toBe('');

  // And no value of the session reached the document in any form — text,
  // attribute value, or element id.
  const markup = document.documentElement.innerHTML.toLowerCase();
  for (const value of sessionValues(established)) {
    expect(markup).not.toContain(value.toLowerCase());
  }
}

/** Every accessible name inside the open surface, in document order. */
function surfaceControlNames(): readonly string[] {
  const surface = document.getElementById(SURFACE_ID);
  if (surface === null) {
    throw new Error('The Account_Menu surface is not rendered.');
  }
  return Array.from(surface.querySelectorAll<HTMLElement>('a, button')).map(
    (control) => control.textContent ?? '',
  );
}

// --- The properties ----------------------------------------------------------

describe('AccountMenu — Property 27 (the account menu discloses no account detail)', () => {
  // Feature: app-shell, Property 27: The account menu discloses no account detail
  // Validates: Requirements 8.1, 8.4
  it('names the menu with one fixed text and discloses no account detail, for any established session', () => {
    fc.assert(
      fc.property(establishedSessionArb, (established) => {
        const mounted = mountMenu(established.session);
        try {
          // Non-vacuity: a session really was established, so there was account
          // detail available to disclose.
          expect(mounted.authState()).toBe('authenticated');

          // Closed: the trigger alone (Requirement 8.1).
          expectFixedTriggerName(established);
          expectNoAccountDetail(established);
          expect(trigger()).toHaveAttribute('aria-expanded', 'false');

          // Opened: the trigger and the surface (Requirement 8.4).
          fireEvent.click(trigger());
          expect(trigger()).toHaveAttribute('aria-expanded', 'true');
          expectFixedTriggerName(established);
          expectNoAccountDetail(established);
          // The three controls are named by their fixed labels and nothing else.
          expect(surfaceControlNames()).toEqual([
            destinationLabel('profile'),
            destinationLabel('settings'),
            SIGN_OUT_LABEL,
          ]);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: app-shell, Property 27: The account menu discloses no account detail
  // Validates: Requirements 8.1, 8.4
  it('discloses no account detail in any sign-out state of the opened menu', async () => {
    await fc.assert(
      fc.asyncProperty(
        establishedSessionArb,
        fc.constantFrom('resting', 'pending', 'failed'),
        async (established, state) => {
          // A sign-out that never settles holds the pending state open; a
          // rejected one reaches the failure indication.
          const signOut =
            state === 'pending'
              ? () => new Promise<void>(() => {})
              : async () => {
                  if (state === 'failed') {
                    throw new Error('stuck');
                  }
                };

          const mounted = mountMenu(established.session, signOut);
          try {
            expect(mounted.authState()).toBe('authenticated');
            fireEvent.click(trigger());

            if (state !== 'resting') {
              fireEvent.click(
                screen.getByRole('button', { name: new RegExp(SIGN_OUT_LABEL, 'u') }),
              );
              // Let the rejection settle, so the failure indication is rendered.
              await act(async () => {
                await Promise.resolve();
              });
            }

            if (state === 'pending') {
              expect(
                screen.getByRole('button', { name: new RegExp(SIGN_OUT_LABEL, 'u') }),
              ).toHaveTextContent(SIGN_OUT_IN_PROGRESS);
            }
            if (state === 'failed') {
              expect(screen.getByRole('alert')).toHaveTextContent(SIGN_OUT_FAILED);
            }

            // Whatever the state added, it added no account detail.
            expectFixedTriggerName(established);
            expectNoAccountDetail(established);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});

/**
 * Harness controls, not properties: the generators and the leak checks must be
 * capable of failing, or the properties above would hold for any harness at all.
 */
describe('AccountMenu property harness', () => {
  it('generatorValuesAreDistinguishableFromTheMenusOwnText', () => {
    const corpus = ALLOWED_TEXT.join(' ').toLowerCase();
    for (const value of [...DISPLAY_NAMES, ...EMAIL_ADDRESSES]) {
      // A generated value that were part of the menu's own text would make the
      // "value never reaches the markup" check fail for a correct menu.
      expect(corpus).not.toContain(value.toLowerCase());
    }
  });

  it('leakChecksCatchADisplayedNameEmailAndAvatar', () => {
    const established = fc.sample(establishedSessionArb, 1)[0];
    const { detail } = established;

    render(
      <div data-shell-disclosure={SURFACE_ID}>
        <button type="button" aria-controls={SURFACE_ID} aria-expanded={true}>
          {detail.name}
        </button>
        <div id={SURFACE_ID}>
          <img src={detail.avatarUrl} alt={`${detail.name} avatar`} />
          <p>{detail.email}</p>
        </div>
      </div>,
    );

    // Every clause of Requirement 8.4 that the leaky menu breaks is caught.
    expect(() => expectNoAccountDetail(established)).toThrow();
    // And the fixed-name claim of Requirement 8.1 with it.
    expect(() => expectFixedTriggerName(established)).toThrow();
  });
});
