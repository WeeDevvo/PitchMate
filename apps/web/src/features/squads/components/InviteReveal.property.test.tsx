/**
 * Property test for the Invite_Reveal's unrecoverability (task 12.3).
 *
 * **Property 29: A revealed invite is unrecoverable once dismissed.** *For any*
 * generated invite link and code, dismissing the Invite_Reveal and unmounting the
 * Squad_Route each remove both values from the rendered output and from every
 * value the feature retains, and neither value is written to browser storage at
 * any point.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 11.7 — dismissal discards both values from the rendered output | {@link expectValuesUnrecoverable}, after the dismiss control is activated |
 * | 11.7 — dismissal discards them from every value the feature retains | a re-render, a reopening of the generator, and a fresh mount each restoring neither |
 * | 11.7 — unmounting the Squad_Route discards both values | the InviteManager unmount property, and the direct Invite_Reveal unmount property |
 * | 11.7 — neither value is written to browser storage | {@link watchPersistence}, spying on the storage setter and the cookie setter |
 *
 * ### Why the storage claim is a spy and not a read-back
 *
 * Reading `localStorage.length` after the fact answers a weaker question: it
 * cannot tell a value that was never written from one that was written and then
 * removed, and a secret that reached the disk for a millisecond has still left
 * the process. {@link watchPersistence} therefore intercepts
 * `Storage.prototype.setItem` — which is the one method both `localStorage` and
 * `sessionStorage` route through — and the `document.cookie` setter, and records
 * every call for the whole life of the surface. A write followed by a removal
 * fails here, as it should.
 *
 * The same watch records every `console` argument, because a log line is the other
 * way a secret escapes a page, and the copy-failure path is where the temptation
 * to log the value is greatest. Console output is asserted only to *not carry
 * either value*, rather than to be silent, so a genuine React warning reports
 * itself rather than failing this property for the wrong reason.
 *
 * ### Why the flow is driven through the real Invite_Manager
 *
 * "Removed from every value the feature retains" is not a claim about this
 * component: {@link InviteReveal} holds neither value in state, so a test that
 * only ever renders it directly would prove the interesting half by construction.
 * The retained copy lives in `state/useInviteManager.ts`'s reveal state, so the
 * dismissal property mounts the real {@link InviteManager} over a stubbed
 * `SquadsApi`, generates an invite, and dismisses the reveal the real wiring
 * produced. What follows the dismissal is then the honest question — a re-render,
 * a reopening of the generator, and (in the unmount property) a fresh mount, none
 * of which may bring either value back.
 *
 * The direct-render property covers the unmount path at the component's own seam,
 * where the values arrive as props and go when the props do.
 *
 * ### How a value is searched for, and why three representations
 *
 * A rendered value does not appear in the markup verbatim: serialising escapes
 * `&`, `<`, and `>` in text and `&` and `"` in an attribute, so a reserved
 * character in a token would make a naive `outerHTML.includes(value)` check pass
 * whether the value were present or not. {@link expectValuesUnrecoverable}
 * therefore searches the raw value, its text-escaped form, and its
 * attribute-escaped form, across `document.documentElement.outerHTML`, the
 * document's text, and the document URL. {@link expectValuesPresented} asserts the
 * mirror image first, so a run cannot pass because nothing was ever revealed.
 *
 * ### The generated values, and the sentinel inside them
 *
 * Every generated link and code carries a fixed sentinel segment. That is not a
 * weakening of the property — the sentinel is part of the value being searched for
 * — it is what makes the absence check meaningful: a bare twelve-character token
 * can coincide with a class name or an id in the surrounding markup, which would
 * fail the property for a reason that has nothing to do with the invite. Around
 * the sentinel the payloads cover realistic tokens, the URL-reserved characters
 * (`/ ? # & = % +`) that force the escaping question, and non-ASCII characters.
 *
 * Feature: web-squads-screens, Property 29: A revealed invite is unrecoverable once dismissed
 * Validates: Requirements 11.7
 */
import { useRef, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';

import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  COPY_INVITE_LINK_LABEL,
  GENERATE_INVITE_HEADING,
  GENERATE_INVITE_SUBMIT_LABEL,
} from '../lib/messages';
import {
  parseGeneratedInvite,
  printGeneratedInvite,
  type GeneratedInvite,
} from '../lib/parse/generatedInvite';
import type { InviteSummary } from '../lib/parse/inviteSummary';
import { InviteManager } from './InviteManager';
import {
  INVITE_REVEAL_CODE_SELECTOR,
  INVITE_REVEAL_DISMISS_SELECTOR,
  INVITE_REVEAL_LINK_SELECTOR,
  INVITE_REVEAL_OUTCOME_REGION_ID,
  INVITE_REVEAL_SELECTOR,
  InviteReveal,
} from './InviteReveal';

const SQUAD_ID = '9f1b3c1e-6d2a-4c6f-9b57-2c1a0d5e7f31';

/**
 * One listed invite, so the flow runs against a populated listing rather than an
 * empty one. Its values are fixed and share nothing with a generated secret, so
 * the listing can never satisfy an absence check by accident.
 */
const LISTED_INVITE: InviteSummary = {
  inviteId: '11111111-1111-4111-8111-111111111111',
  state: 'Active',
  createdAtMs: Date.UTC(2025, 2, 1, 10, 0, 0),
  createdBy: 'admin',
  expiresAtMs: Date.UTC(2025, 2, 8, 10, 0, 0),
};

// --- Generators --------------------------------------------------------------

/** The characters a backend token or code realistically draws on. */
const TOKEN_CHARACTERS: readonly string[] =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('');

/**
 * The URL-reserved characters. Present in the payloads because each of them is a
 * character that either changes how a value is escaped in serialised markup (`&`)
 * or how it would be read back out of a path (`/ ? # = % +`).
 */
const RESERVED_CHARACTERS: readonly string[] = ['/', '?', '#', '&', '=', '%', '+'];

/** Non-ASCII characters, including one outside the basic multilingual plane. */
const NON_ASCII_CHARACTERS: readonly string[] = ['é', 'ü', 'ß', 'Ω', '漢', 'א', '😀'];

/** A string drawn from one character pool. */
function drawnFrom(
  pool: readonly string[],
  minLength: number,
  maxLength: number,
): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...pool), { minLength, maxLength })
    .map((characters) => characters.join(''));
}

/** The varying part of a generated secret. */
const payloadArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: drawnFrom(TOKEN_CHARACTERS, 12, 32) },
  {
    weight: 2,
    arbitrary: drawnFrom([...TOKEN_CHARACTERS, ...RESERVED_CHARACTERS], 12, 32),
  },
  {
    weight: 2,
    arbitrary: drawnFrom([...TOKEN_CHARACTERS, ...NON_ASCII_CHARACTERS], 12, 32),
  },
  {
    weight: 1,
    arbitrary: drawnFrom([...RESERVED_CHARACTERS, ...NON_ASCII_CHARACTERS], 12, 24),
  },
);

/**
 * The sentinels. Each is part of the value the property searches for, and each
 * makes that value long and distinctive enough that it cannot coincide with the
 * markup around it.
 */
const LINK_SENTINEL = 'PM-REVEALED-LINK-TOKEN-';
const CODE_SENTINEL = 'PM-REVEALED-CODE-';

/** The two values the Invite_Reveal presents. */
interface RevealValues {
  readonly redeemableLink: string;
  readonly code: string;
}

/**
 * A `GenerateInvite` response, produced by printing a candidate value and parsing
 * it back — so the values the reveal receives are exactly what the feature's own
 * Response_Parser would hand it, rather than a hand-built object that happens to
 * have the right fields.
 */
const generatedInviteArb: fc.Arbitrary<GeneratedInvite> = fc
  .record({
    inviteId: fc.uuid(),
    absoluteLink: fc.boolean(),
    linkPayload: payloadArb,
    codePayload: payloadArb,
    expiresAtMs: fc.oneof(
      fc.constant(null),
      fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2035, 0, 1) }),
    ),
  })
  .map(({ inviteId, absoluteLink, linkPayload, codePayload, expiresAtMs }) => {
    const token = `${LINK_SENTINEL}${linkPayload}`;
    const candidate: GeneratedInvite = {
      inviteId,
      // Both forms the backend may return: the absolute address it builds today,
      // and the relative `/join/{token}` the design also allows. Neither is
      // rewritten by the component, so both must be handled identically.
      redeemableLink: absoluteLink
        ? `https://pitch-mate.co.uk/join/${token}`
        : `/join/${token}`,
      code: `${CODE_SENTINEL}${codePayload}`,
      expiresAtMs,
    };

    const parsed = parseGeneratedInvite(printGeneratedInvite(candidate));

    if (!parsed.ok) {
      throw new Error(
        `the generated invite must parse, but it did not: ${parsed.reason}`,
      );
    }

    return parsed.value;
  });

/** The two values of a generated response, which is all the reveal receives. */
function valuesOf(invite: GeneratedInvite): RevealValues {
  return { redeemableLink: invite.redeemableLink, code: invite.code };
}

// --- Searching the document for a value --------------------------------------

/** A value as it appears in a serialised text node. */
function textEscaped(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** A value as it appears in a serialised attribute. */
function attributeEscaped(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/**
 * Requirement 11.7: the value is nowhere in the document — not in its markup, not
 * in its text, and not in its address — in any of the three forms serialisation
 * could have put it there in.
 */
function expectValueUnrecoverable(value: string, context: string): void {
  const markup = document.documentElement.outerHTML;
  const text = document.documentElement.textContent ?? '';
  const address = window.location.href;

  for (const form of [value, textEscaped(value), attributeEscaped(value)]) {
    expect(
      markup.includes(form),
      `${context}: the rendered markup still carries the value`,
    ).toBe(false);
    expect(
      text.includes(form),
      `${context}: the rendered text still carries the value`,
    ).toBe(false);
    expect(
      address.includes(form),
      `${context}: the document address carries the value`,
    ).toBe(false);
  }
}

/** Both values, gone (Requirement 11.7). */
function expectValuesUnrecoverable(values: RevealValues, context: string): void {
  expect(
    document.querySelector(INVITE_REVEAL_SELECTOR),
    `${context}: the reveal surface is still rendered`,
  ).toBeNull();
  expectValueUnrecoverable(values.redeemableLink, context);
  expectValueUnrecoverable(values.code, context);
}

/**
 * The mirror image, asserted before every dismissal and unmount: the surface does
 * present both values, so an absence afterwards is a discard rather than a flow
 * that never revealed anything.
 */
function expectValuesPresented(surface: HTMLElement, values: RevealValues): void {
  const link = surface.querySelector(INVITE_REVEAL_LINK_SELECTOR);
  const code = surface.querySelector(INVITE_REVEAL_CODE_SELECTOR);

  expect(link?.textContent).toBe(values.redeemableLink);
  // 11.8: the backend's value as returned, unrewritten, as the address too.
  expect(link?.getAttribute('href')).toBe(values.redeemableLink);
  expect(code?.textContent).toBe(values.code);
  expect(document.documentElement.textContent ?? '').toContain(values.redeemableLink);
  expect(document.documentElement.textContent ?? '').toContain(values.code);
}

// --- Watching every way a value could persist --------------------------------

/** One recorded write to `localStorage` or `sessionStorage`. */
interface StorageWrite {
  readonly store: string;
  readonly key: string;
  readonly value: string;
}

/**
 * Everything a page can leave behind, recorded as it happens rather than read
 * back afterwards.
 */
interface PersistenceWatch {
  readonly storageWrites: readonly StorageWrite[];
  readonly cookieWrites: readonly string[];
  readonly consoleLines: readonly string[];
  restore(): void;
}

/** An argument of a `console` call, rendered for containment checks only. */
function describeArgument(argument: unknown): string {
  if (typeof argument === 'string') {
    return argument;
  }

  try {
    return JSON.stringify(argument) ?? String(argument);
  } catch {
    return String(argument);
  }
}

/**
 * Intercept `Storage.prototype.setItem`, the `document.cookie` setter, and every
 * `console` method, recording each call and passing it through.
 *
 * Spying on the *setter* rather than reading the store afterwards is the point: a
 * value written and then removed is still a value that left the page, and it fails
 * here (Requirement 11.7).
 */
function watchPersistence(): PersistenceWatch {
  const storageWrites: StorageWrite[] = [];
  const cookieWrites: string[] = [];
  const consoleLines: string[] = [];

  const originalSetItem = Storage.prototype.setItem;
  const setItemSpy = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key: string, value: string): void {
      storageWrites.push({
        store: this === window.sessionStorage ? 'sessionStorage' : 'localStorage',
        key,
        value,
      });
      originalSetItem.call(this, key, value);
    });

  const cookieDescriptor = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'cookie',
  );
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: (): string => (cookieDescriptor?.get?.call(document) as string | undefined) ?? '',
    set: (value: string): void => {
      cookieWrites.push(value);
      cookieDescriptor?.set?.call(document, value);
    },
  });

  const consoleMethods: readonly 'log'[] = [
    'log',
    'info',
    'warn',
    'error',
    'debug',
  ] as readonly 'log'[];
  const consoleSpies = consoleMethods.map((method) => {
    const original = console[method].bind(console) as (...args: unknown[]) => void;

    return vi.spyOn(console, method).mockImplementation((...args: unknown[]): void => {
      consoleLines.push(args.map(describeArgument).join(' '));
      original(...args);
    });
  });

  return {
    storageWrites,
    cookieWrites,
    consoleLines,
    restore(): void {
      setItemSpy.mockRestore();
      for (const spy of consoleSpies) {
        spy.mockRestore();
      }
      Reflect.deleteProperty(document, 'cookie');
    },
  };
}

/**
 * Requirement 11.7: neither value reached browser storage, a cookie, or a log at
 * any point in the surface's life — and, since the feature persists nothing at
 * all, nothing was written whatsoever.
 */
function expectNothingPersisted(
  watch: PersistenceWatch,
  values: RevealValues,
): void {
  const secrets = [values.redeemableLink, values.code];

  for (const write of watch.storageWrites) {
    for (const secret of secrets) {
      expect(
        `${write.key} ${write.value}`.includes(secret),
        `a ${write.store} write carried the value`,
      ).toBe(false);
    }
  }

  for (const cookie of watch.cookieWrites) {
    for (const secret of secrets) {
      expect(cookie.includes(secret), 'a cookie carried the value').toBe(false);
    }
  }

  // No message and no log may echo a secret: the copy outcomes are fixed strings
  // taking no interpolation parameter (Requirement 17.2). Console output is
  // otherwise left alone, so a genuine warning reports itself.
  for (const line of watch.consoleLines) {
    for (const secret of secrets) {
      expect(line.includes(secret), 'a log line carried the value').toBe(false);
    }
  }

  // The stronger statement the design makes: this feature writes no storage and no
  // cookie at all, so there is not merely no secret in a write — there is no
  // write.
  expect(watch.storageWrites).toEqual([]);
  expect(watch.cookieWrites).toEqual([]);
}

/** A fresh run starts from an empty store, so a leak cannot ride in on one. */
function clearPersistence(): void {
  window.localStorage.clear();
  window.sessionStorage.clear();
}

// --- The transport seam ------------------------------------------------------

/** A method this surface has no business calling. */
function unavailable(name: string): () => never {
  return () => {
    throw new Error(`${name} must not be called`);
  };
}

interface ApiCallLog {
  listCalls: number;
  generateCalls: number;
}

/**
 * A `SquadsApi` answering `ListInvites` and — where a generated invite is supplied
 * — `GenerateInvite`, and refusing everything else. Withholding the generated
 * invite is how a remount is asserted to reveal nothing: a reveal reappearing
 * there could only have come from a retained value, and a second `GenerateInvite`
 * would fail loudly instead.
 */
function createFakeApi(generated: GeneratedInvite | null): {
  readonly api: SquadsApi;
  readonly log: ApiCallLog;
} {
  const log: ApiCallLog = { listCalls: 0, generateCalls: 0 };
  const listOutcome: CallResult<readonly InviteSummary[]> = {
    kind: 'success',
    value: [LISTED_INVITE],
  };

  const api: SquadsApi = {
    listInvites: () => {
      log.listCalls += 1;
      return Promise.resolve(listOutcome);
    },
    generateInvite: () => {
      log.generateCalls += 1;
      if (generated === null) {
        throw new Error('generateInvite must not be called');
      }
      return Promise.resolve({ kind: 'success', value: generated });
    },
    revokeInvite: unavailable('revokeInvite'),
    listMySquads: unavailable('listMySquads'),
    getSquad: unavailable('getSquad'),
    getDisplayRatingLeaderboard: unavailable('getDisplayRatingLeaderboard'),
    createSquad: unavailable('createSquad'),
    redeemInvite: unavailable('redeemInvite'),
    previewInvite: unavailable('previewInvite'),
    createGuest: unavailable('createGuest'),
    editGuest: unavailable('editGuest'),
    promoteToAdmin: unavailable('promoteToAdmin'),
    getFeatureFlags: unavailable('getFeatureFlags'),
    setFeatureFlag: unavailable('setFeatureFlag'),
  };

  return { api, log };
}

type User = ReturnType<typeof userEvent.setup>;

/** Opens the generator, submits the default validity, and waits for the reveal. */
async function revealThroughManager(user: User): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: GENERATE_INVITE_HEADING }));
  await user.click(
    screen.getByRole('button', { name: GENERATE_INVITE_SUBMIT_LABEL }),
  );

  return waitFor(() => {
    const surface = document.querySelector<HTMLElement>(INVITE_REVEAL_SELECTOR);
    expect(surface).not.toBeNull();
    return surface as HTMLElement;
  });
}

/**
 * Activates the copy control and waits for its outcome, so the property covers
 * the whole life of the surface — including the path where a value is handed to
 * the clipboard and a message is announced about it.
 */
async function copyAndSettle(
  user: User,
  surface: HTMLElement,
  values: RevealValues,
): Promise<void> {
  await user.click(within(surface).getByRole('button', { name: COPY_INVITE_LINK_LABEL }));

  await waitFor(() => {
    const region = document.getElementById(INVITE_REVEAL_OUTCOME_REGION_ID);
    expect(region?.textContent ?? '').not.toBe('');
  });

  // Whichever outcome it was, the announcement carries no part of either value.
  const announced = document.getElementById(INVITE_REVEAL_OUTCOME_REGION_ID)
    ?.textContent ?? '';
  expect(announced).not.toContain(values.redeemableLink);
  expect(announced).not.toContain(values.code);
}

// --- A harness for the direct render ----------------------------------------

/**
 * The smallest thing that owns an Invite_Reveal: an opener control for focus to
 * return to, and the mounted-while-revealed relationship the real wiring has.
 */
function RevealHarness({ values }: { readonly values: RevealValues }): ReactElement {
  const openerRef = useRef<HTMLButtonElement>(null);
  const [revealed, setRevealed] = useState(true);

  return (
    <div>
      <button type="button" ref={openerRef}>
        Generate an invite
      </button>
      {revealed ? (
        <InviteReveal
          redeemableLink={values.redeemableLink}
          code={values.code}
          openerRef={openerRef}
          onDismiss={() => setRevealed(false)}
          headingLevel={2}
        />
      ) : null}
    </div>
  );
}

// --- The property ------------------------------------------------------------

describe('Property 29 — a revealed invite is unrecoverable once dismissed', () => {
  // Feature: web-squads-screens, Property 29: A revealed invite is unrecoverable once dismissed
  // Validates: Requirements 11.7
  it('discards both values from the rendered output and from every retained value when the reveal is dismissed', async () => {
    await fc.assert(
      fc.asyncProperty(generatedInviteArb, async (generated) => {
        const values = valuesOf(generated);
        clearPersistence();
        const watch = watchPersistence();
        const user = userEvent.setup({ delay: null });
        const { api, log } = createFakeApi(generated);
        const view = render(<InviteManager api={api} squadId={SQUAD_ID} />);

        try {
          await waitFor(() => {
            expect(log.listCalls).toBe(1);
          });

          const surface = await revealThroughManager(user);
          expectValuesPresented(surface, values);
          await copyAndSettle(user, surface, values);

          // 11.7: dismissal. The hook holds the only copy of either value, and
          // this is what clears it.
          await user.click(
            surface.querySelector<HTMLElement>(INVITE_REVEAL_DISMISS_SELECTOR) as HTMLElement,
          );
          await waitFor(() => {
            expect(document.querySelector(INVITE_REVEAL_SELECTOR)).toBeNull();
          });
          expectValuesUnrecoverable(values, 'after dismissal');

          // 11.7, "every value it retains": three ways a retained copy would show
          // itself, none of which may.
          view.rerender(<InviteManager api={api} squadId={SQUAD_ID} />);
          expectValuesUnrecoverable(values, 'after a re-render');

          await user.click(
            screen.getByRole('button', { name: GENERATE_INVITE_HEADING }),
          );
          expectValuesUnrecoverable(values, 'after the generator is reopened');

          // Reopening the generator offers the form again rather than re-issuing a
          // call, so the dismissed reveal cannot return by that route either.
          expect(log.generateCalls).toBe(1);

          expectNothingPersisted(watch, values);
        } finally {
          watch.restore();
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 600_000);

  // Feature: web-squads-screens, Property 29: A revealed invite is unrecoverable once dismissed
  // Validates: Requirements 11.7
  it('discards both values when the Squad_Route unmounts while the reveal is displayed, and a fresh mount restores neither', async () => {
    await fc.assert(
      fc.asyncProperty(generatedInviteArb, async (generated) => {
        const values = valuesOf(generated);
        clearPersistence();
        const watch = watchPersistence();
        const user = userEvent.setup({ delay: null });
        const first = createFakeApi(generated);
        const view = render(<InviteManager api={first.api} squadId={SQUAD_ID} />);

        try {
          await waitFor(() => {
            expect(first.log.listCalls).toBe(1);
          });

          const surface = await revealThroughManager(user);
          expectValuesPresented(surface, values);

          // 11.7: the Squad_Route unmounts with the reveal still displayed — no
          // dismissal, no copy, nothing tidied up by the person.
          view.unmount();
          expectValuesUnrecoverable(values, 'after the route unmounted');

          // A fresh mount over a seam that would *throw* on `GenerateInvite`: the
          // only way either value could appear now is from something the feature
          // kept, so a reveal here is a failure and a refused call is louder still.
          const second = createFakeApi(null);
          render(<InviteManager api={second.api} squadId={SQUAD_ID} />);
          await waitFor(() => {
            expect(second.log.listCalls).toBe(1);
          });
          expectValuesUnrecoverable(values, 'after a fresh mount');
          expect(second.log.generateCalls).toBe(0);

          expectNothingPersisted(watch, values);
        } finally {
          watch.restore();
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 600_000);

  // Feature: web-squads-screens, Property 29: A revealed invite is unrecoverable once dismissed
  // Validates: Requirements 11.7
  it('holds neither value of its own, so dismissal and unmount each remove both from the document', async () => {
    await fc.assert(
      fc.asyncProperty(generatedInviteArb, async (generated) => {
        const values = valuesOf(generated);
        clearPersistence();
        const watch = watchPersistence();
        const user = userEvent.setup({ delay: null });
        const view = render(<RevealHarness values={values} />);

        try {
          const surface = document.querySelector<HTMLElement>(
            INVITE_REVEAL_SELECTOR,
          ) as HTMLElement;
          expect(surface).not.toBeNull();
          expectValuesPresented(surface, values);

          // The copy path, where the value is handed to the clipboard and an
          // outcome is announced, runs before the surface goes.
          await copyAndSettle(user, surface, values);

          await user.click(
            surface.querySelector<HTMLElement>(INVITE_REVEAL_DISMISS_SELECTOR) as HTMLElement,
          );
          await waitFor(() => {
            expect(document.querySelector(INVITE_REVEAL_SELECTOR)).toBeNull();
          });
          // 11.7: the component retained neither value, so unmounting it — which
          // is what dismissal does here — takes both with it.
          expectValuesUnrecoverable(values, 'after the reveal was dismissed');

          // And the surrounding tree going takes nothing further with it.
          view.unmount();
          expectValuesUnrecoverable(values, 'after the tree unmounted');

          expectNothingPersisted(watch, values);
        } finally {
          watch.restore();
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 600_000);
});
