/**
 * Component tests for the App_Shell's Squad_Scope plumbing.
 *
 * These cover the two ways a Squad_Scope may reach the shell and nothing else: a
 * `squadId` route parameter on a shell route, and a hosting Destination_Content
 * calling `usePublishSquadScope` (Requirement 7.2). They also pin the answer
 * Requirement 7.1 gives to an unusable value — no Squad_Scope active, no error —
 * and the rule that the provider itself renders no Squad_Scope selection control.
 *
 * The route parameter is driven through the real client-side router
 * (`createMemoryRouter` / `RouterProvider`), the same router the app uses, in the
 * two arrangements the shell can actually meet:
 *
 * - **scoped route** — the parameter is matched by the route that renders the
 *   provider, which the provider reads for itself, and
 * - **nested route** — the provider sits in the `/app` layout route and the
 *   parameter is matched below it, where only that route's content can see it, so
 *   the content binds it with `usePublishSquadScopeFromRoute`.
 *
 * The normaliser's own exhaustive coverage lives in
 * `lib/squadScope.property.test.ts`; these tests assert that the provider routes
 * each source *through* it, not that it works.
 *
 * Feature: app-shell
 * Requirements: 7.1, 7.2
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  createMemoryRouter,
  MemoryRouter,
  Outlet,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import {
  SQUAD_SCOPE_ROUTE_PARAMETER,
  SquadScopeProvider,
  usePublishSquadScope,
  usePublishSquadScopeFromRoute,
  useSquadScope,
  type PublishSquadScope,
} from './SquadScopeContext';

/** Two well-formed identities, deliberately differing in letter case. */
const IDENTITY_A = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';
const IDENTITY_B = '018F3A2B-4C5D-7E6F-8A9B-0C1D2E3F4A5C';

/** The text the probes render when no Squad_Scope is active. */
const NONE = 'none';

/** Surfaces the active Squad_Scope as text. */
function ScopeProbe() {
  const scope = useSquadScope();
  return <span data-testid="scope">{scope ?? NONE}</span>;
}

/** The currently displayed scope, as the probe sees it. */
function displayedScope(): string {
  return screen.getByTestId('scope').textContent ?? '';
}

/**
 * Stands in for a hosting Destination_Content: hands the publish function to the
 * test on every render and reads the scope, as real content that both publishes
 * and displays a scope would. Reading the scope is what makes this component
 * re-render on a scope change, which in turn makes the publish function's
 * identity — and the absence of a re-render on a no-op publish — observable.
 */
function PublishCapture({
  onPublish,
}: {
  readonly onPublish: (publish: PublishSquadScope) => void;
}) {
  const publish = usePublishSquadScope();
  const scope = useSquadScope();

  // Reported once per render, so the collected functions double as a render
  // count for this component.
  onPublish(publish);

  return <span data-testid="publisher-view">{scope ?? NONE}</span>;
}

/** Nested-route content that binds its own `squadId` parameter to the scope. */
function RouteBoundContent() {
  const scope = usePublishSquadScopeFromRoute();
  return <span data-testid="bound-scope">{scope ?? NONE}</span>;
}

// --- arrangement C: the provider in a plain, unparameterised tree ------------

/** Renders the provider with no route parameter anywhere, and returns a publisher. */
function renderUnscoped() {
  const publishes: PublishSquadScope[] = [];

  const result = render(
    <MemoryRouter initialEntries={['/app']}>
      <SquadScopeProvider>
        <PublishCapture onPublish={(publish) => publishes.push(publish)} />
        <ScopeProbe />
      </SquadScopeProvider>
    </MemoryRouter>,
  );

  return {
    ...result,
    publishes,
    /** How many times the publishing content has rendered. */
    renderCount(): number {
      return publishes.length;
    },
    /** Publish a value the way hosting content would: outside render. */
    publish(candidate: unknown) {
      act(() => {
        publishes[publishes.length - 1](candidate);
      });
    },
  };
}

// --- arrangement A: the parameter on the route that renders the provider -----

/**
 * Render a route table whose scoped route renders the provider itself, so the
 * provider reads the `squadId` parameter directly.
 */
function renderScopedRoute(initialPath: string, extras?: ReactNode) {
  const wrap = (): ReactElementLike => (
    <SquadScopeProvider>
      {extras}
      <ScopeProbe />
    </SquadScopeProvider>
  );

  const routes: RouteObject[] = [
    { path: '/app', element: wrap() },
    { path: `/app/squads/:${SQUAD_SCOPE_ROUTE_PARAMETER}`, element: wrap() },
  ];

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  render(<RouterProvider router={router} />);
  return router;
}

/** The element type a route object accepts, named to keep the helper readable. */
type ReactElementLike = RouteObject['element'];

// --- arrangement B: the parameter on a nested route below the provider -------

/**
 * Render a route table matching the shell's own shape: one `/app` layout route
 * rendering the provider around the `Outlet`, with an unscoped index child and a
 * scoped child whose content binds the parameter.
 */
function renderNestedRoute(initialPath: string, extras?: ReactNode) {
  const routes: RouteObject[] = [
    {
      path: '/app',
      element: (
        <SquadScopeProvider>
          {extras}
          <ScopeProbe />
          <Outlet />
        </SquadScopeProvider>
      ),
      children: [
        { index: true, element: null },
        {
          path: `squads/:${SQUAD_SCOPE_ROUTE_PARAMETER}`,
          element: <RouteBoundContent />,
        },
      ],
    },
  ];

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('SquadScopeProvider — a route parameter on the provider’s own route', () => {
  // Validates: Requirements 7.1 (nothing supplied → account-wide)
  it('treats no Squad_Scope as active where the route carries no squad identity', () => {
    renderScopedRoute('/app');

    expect(displayedScope()).toBe(NONE);
  });

  // Validates: Requirements 7.2 (a well-formed route parameter becomes the scope)
  it('treats a well-formed route parameter as the active Squad_Scope', () => {
    renderScopedRoute(`/app/squads/${IDENTITY_A}`);

    expect(displayedScope()).toBe(IDENTITY_A);
  });

  // Validates: Requirements 7.2 (the identity is opaque — the supplied case is kept)
  it('supplies the identity character-for-character, keeping its letter case', () => {
    renderScopedRoute(`/app/squads/${IDENTITY_B}`);

    expect(displayedScope()).toBe(IDENTITY_B);
    expect(displayedScope()).not.toBe(IDENTITY_B.toLowerCase());
  });

  // Validates: Requirements 7.1 (an unusable value is not an error)
  it.each([
    ['malformed', 'not-an-identity'],
    ['whitespace-only', '%20%20%20'],
    ['the unhyphenated form', '018f3a2b4c5d7e6f8a9b0c1d2e3f4a5b'],
    ['a braced form', '%7B018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b%7D'],
    ['trailing-space padded', '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b%20'],
  ])('treats no Squad_Scope as active for a %s route parameter', (_label, parameter) => {
    renderScopedRoute(`/app/squads/${parameter}`);

    // No error indication of any kind: the tree renders, and the probe simply
    // reports that no Squad_Scope is active (Requirement 7.1).
    expect(displayedScope()).toBe(NONE);
  });

  // Validates: Requirements 7.2, 7.3 (the supplied scope changes with the route)
  it('follows the route parameter from one identity to another', async () => {
    const router = renderScopedRoute(`/app/squads/${IDENTITY_A}`);
    expect(displayedScope()).toBe(IDENTITY_A);

    await act(async () => {
      await router.navigate(`/app/squads/${IDENTITY_B}`);
    });

    expect(displayedScope()).toBe(IDENTITY_B);
  });

  // Validates: Requirements 7.3 (withdrawing a scope restores the account-wide view)
  it('treats no Squad_Scope as active once the route stops naming a squad', async () => {
    const router = renderScopedRoute(`/app/squads/${IDENTITY_A}`);

    await act(async () => {
      await router.navigate('/app');
    });

    expect(displayedScope()).toBe(NONE);
  });
});

describe('SquadScopeProvider — a route parameter on a nested route', () => {
  // Validates: Requirements 7.2 (a nested shell route supplies the scope)
  it('takes the scope from a nested route’s bound squadId parameter', () => {
    renderNestedRoute(`/app/squads/${IDENTITY_A}`);

    expect(displayedScope()).toBe(IDENTITY_A);
    expect(screen.getByTestId('bound-scope')).toHaveTextContent(IDENTITY_A);
  });

  // Validates: Requirements 7.1 (an unusable nested parameter is not an error)
  it('treats no Squad_Scope as active for a malformed nested parameter', () => {
    renderNestedRoute('/app/squads/not-an-identity');

    expect(displayedScope()).toBe(NONE);
    expect(screen.getByTestId('bound-scope')).toHaveTextContent(NONE);
  });

  // Validates: Requirements 7.2, 7.3 (a nested change carries through)
  it('follows a nested parameter between identities and withdraws it on leaving', async () => {
    const router = renderNestedRoute(`/app/squads/${IDENTITY_A}`);
    expect(displayedScope()).toBe(IDENTITY_A);

    await act(async () => {
      await router.navigate(`/app/squads/${IDENTITY_B}`);
    });
    expect(displayedScope()).toBe(IDENTITY_B);

    await act(async () => {
      await router.navigate('/app');
    });
    expect(displayedScope()).toBe(NONE);
  });
});

describe('SquadScopeProvider — hosting content as the source', () => {
  // Validates: Requirements 7.2 (a hosting Destination_Content supplies the scope)
  it('treats a published well-formed identity as the active Squad_Scope', () => {
    const view = renderUnscoped();
    expect(displayedScope()).toBe(NONE);

    view.publish(IDENTITY_A);

    expect(displayedScope()).toBe(IDENTITY_A);
  });

  // Validates: Requirements 7.1 (a published unusable value leaves no scope)
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['the empty string', ''],
    ['whitespace only', '   '],
    ['a malformed string', 'not-an-identity'],
    ['a number', 42],
    ['an identity-shaped object', { squadId: IDENTITY_A }],
    ['an array holding an identity', [IDENTITY_A]],
  ])('treats no Squad_Scope as active when %s is published', (_label, candidate) => {
    const view = renderUnscoped();
    view.publish(IDENTITY_A);
    expect(displayedScope()).toBe(IDENTITY_A);

    view.publish(candidate);

    expect(displayedScope()).toBe(NONE);
  });

  // Validates: Requirements 7.2 (publishing is a stable seam usable from an effect)
  it('hands out one stable publish function across renders and scope changes', () => {
    const view = renderUnscoped();

    view.publish(IDENTITY_A);
    view.publish(IDENTITY_B);
    view.publish(null);

    // Several renders happened, and every one of them saw the same function, so
    // naming it in an effect's dependency list cannot loop.
    expect(view.publishes.length).toBeGreaterThan(1);
    for (const publish of view.publishes) {
      expect(publish).toBe(view.publishes[0]);
    }
  });

  // Validates: Requirements 7.3 (an idle re-publish is not a scope change)
  it('re-renders nothing when the published value normalises to the active scope', () => {
    const view = renderUnscoped();
    const rendersOnMount = view.renderCount();

    view.publish(IDENTITY_A);
    const rendersAfterFirstPublish = view.renderCount();
    expect(rendersAfterFirstPublish).toBeGreaterThan(rendersOnMount);

    // The same identity again: the active scope is unchanged, so nothing
    // re-renders and the notification centre sees no scope change.
    view.publish(IDENTITY_A);
    expect(view.renderCount()).toBe(rendersAfterFirstPublish);

    view.publish(null);
    const rendersAfterWithdrawal = view.renderCount();
    expect(rendersAfterWithdrawal).toBeGreaterThan(rendersAfterFirstPublish);

    // Two different unusable values both mean "no scope", so the second is not a
    // change either (Requirement 7.1).
    view.publish('not-an-identity');
    expect(view.renderCount()).toBe(rendersAfterWithdrawal);
    expect(displayedScope()).toBe(NONE);
  });

  // Validates: Requirements 7.2 (the documented effect-based publishing usage)
  it('supports the documented publish-on-mount, withdraw-on-unmount usage', () => {
    function HostingContent({ squadId }: { readonly squadId: unknown }) {
      const publishSquadScope = usePublishSquadScope();
      useEffect(() => {
        publishSquadScope(squadId);
        return () => publishSquadScope(null);
      }, [publishSquadScope, squadId]);
      return null;
    }

    function Tree({ mounted }: { readonly mounted: boolean }) {
      return (
        <MemoryRouter initialEntries={['/app']}>
          <SquadScopeProvider>
            {mounted ? <HostingContent squadId={IDENTITY_A} /> : null}
            <ScopeProbe />
          </SquadScopeProvider>
        </MemoryRouter>
      );
    }

    const { rerender } = render(<Tree mounted />);
    expect(displayedScope()).toBe(IDENTITY_A);

    rerender(<Tree mounted={false} />);
    expect(displayedScope()).toBe(NONE);
  });
});

describe('SquadScopeProvider — precedence between the two sources', () => {
  // Validates: Requirements 7.2 (a parameter the provider can see wins)
  it('prefers its own route parameter over a published identity', () => {
    let publish: PublishSquadScope | undefined;
    renderScopedRoute(
      `/app/squads/${IDENTITY_A}`,
      <PublishCapture onPublish={(value) => (publish = value)} />,
    );

    act(() => {
      publish?.(IDENTITY_B);
    });

    expect(displayedScope()).toBe(IDENTITY_A);
  });

  // Validates: Requirements 7.1 (a malformed parameter is answered account-wide)
  it('prefers a malformed route parameter over a published identity', () => {
    let publish: PublishSquadScope | undefined;
    renderScopedRoute(
      '/app/squads/not-an-identity',
      <PublishCapture onPublish={(value) => (publish = value)} />,
    );

    act(() => {
      publish?.(IDENTITY_B);
    });

    // The route already says which squad the person is working within, so a
    // value published elsewhere cannot override it — an unusable one lands on
    // the account-wide view rather than on another squad (Requirement 7.1).
    expect(displayedScope()).toBe(NONE);
  });

  // Validates: Requirements 7.2 (the published value applies where the route has none)
  it('keeps a published identity across a navigation that carries no parameter', async () => {
    let publish: PublishSquadScope | undefined;
    const router = renderNestedRoute(
      '/app',
      <PublishCapture onPublish={(value) => (publish = value)} />,
    );

    act(() => {
      publish?.(IDENTITY_B);
    });
    expect(displayedScope()).toBe(IDENTITY_B);

    // Into a nested squad route, whose bound parameter takes over…
    await act(async () => {
      await router.navigate(`/app/squads/${IDENTITY_A}`);
    });
    expect(displayedScope()).toBe(IDENTITY_A);

    // …and back out, where the nested content withdraws its scope.
    await act(async () => {
      await router.navigate('/app');
    });
    expect(displayedScope()).toBe(NONE);
  });
});

describe('SquadScopeProvider — the provider renders no scope selector', () => {
  // Validates: Requirements 7.2 (the scope originates outside the Shell_Frame)
  it('renders its children only, with no control of its own', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/app']}>
        <SquadScopeProvider>
          <p>destination content</p>
        </SquadScopeProvider>
      </MemoryRouter>,
    );

    // Nothing wrapping, nothing added: the provider contributes no element, so
    // it can contribute no Squad_Scope selection control (Requirement 7.2).
    expect(container.innerHTML).toBe('<p>destination content</p>');
    expect(
      container.querySelectorAll(
        'button, select, input, a, [role="combobox"], [role="listbox"], [role="menu"]',
      ),
    ).toHaveLength(0);
  });
});

describe('SquadScopeContext — the hooks outside a provider', () => {
  // Validates: Requirements 7.1 (an unsupplied scope is a state, not an error)
  it('reports no Squad_Scope active when useSquadScope is used outside a provider', () => {
    render(<ScopeProbe />);

    expect(displayedScope()).toBe(NONE);
  });

  // Validates: Requirements 7.2 (publishing into nothing is a wiring mistake)
  it('throws when usePublishSquadScope is used outside a provider', () => {
    // Silence the expected React error boundary logging for this render.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<PublishCapture onPublish={() => {}} />)).toThrow(
      'usePublishSquadScope must be used within a SquadScopeProvider',
    );

    spy.mockRestore();
  });

  // Validates: Requirements 7.2 (the route binding needs the same provider)
  it('throws when usePublishSquadScopeFromRoute is used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      render(
        <MemoryRouter initialEntries={['/app']}>
          <RouteBoundContent />
        </MemoryRouter>,
      ),
    ).toThrow('usePublishSquadScope must be used within a SquadScopeProvider');

    spy.mockRestore();
  });
});

describe('SquadScopeProvider — outside a router', () => {
  // Validates: Requirements 7.1, 7.2 (no route parameter is available at all)
  it('falls back to the published value with no router above it', () => {
    let publish: PublishSquadScope | undefined;

    render(
      <SquadScopeProvider>
        <PublishCapture onPublish={(value) => (publish = value)} />
        <ScopeProbe />
      </SquadScopeProvider>,
    );

    expect(displayedScope()).toBe(NONE);

    act(() => {
      publish?.(IDENTITY_A);
    });

    expect(displayedScope()).toBe(IDENTITY_A);
  });
});
