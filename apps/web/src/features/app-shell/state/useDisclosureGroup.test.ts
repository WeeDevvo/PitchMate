/**
 * Unit tests for the header's disclosure group.
 *
 * These cover the shape of the single `open` value and the two operations over
 * it: the closed start (Requirement 8.1), toggling, the exclusivity that
 * Requirement 8.8 requires between the Notification_Panel and the Account_Menu,
 * the targeted `close` that ignores a stale request, and the stable identities the
 * frame relies on when naming these functions in dependency lists.
 *
 * The exhaustive activation-sequence property lives in the Property 26 test; this
 * file pins the individual transitions.
 *
 * Feature: app-shell
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDisclosureGroup } from './useDisclosureGroup';

describe('useDisclosureGroup', () => {
  // Requirement 8.1 — collapsed on first render.
  it('reports no open surface on the first render', () => {
    const { result } = renderHook(() => useDisclosureGroup());

    expect(result.current.open).toBeNull();
  });

  it('opens the toggled surface', () => {
    const { result } = renderHook(() => useDisclosureGroup());

    act(() => {
      result.current.toggle('notifications');
    });

    expect(result.current.open).toBe('notifications');
  });

  it('closes the open surface when it is toggled again', () => {
    const { result } = renderHook(() => useDisclosureGroup());

    act(() => {
      result.current.toggle('account');
    });
    act(() => {
      result.current.toggle('account');
    });

    expect(result.current.open).toBeNull();
  });

  // Requirement 8.8 — at most one surface open at any instant.
  it('replaces the open surface when a different surface is toggled', () => {
    const { result } = renderHook(() => useDisclosureGroup());

    act(() => {
      result.current.toggle('notifications');
    });
    act(() => {
      result.current.toggle('account');
    });

    expect(result.current.open).toBe('account');
  });

  it('closes the named surface while it is the open one', () => {
    const { result } = renderHook(() => useDisclosureGroup());

    act(() => {
      result.current.toggle('navigation');
    });
    act(() => {
      result.current.close('navigation');
    });

    expect(result.current.open).toBeNull();
  });

  it('ignores a close request for a surface that is not open', () => {
    const { result } = renderHook(() => useDisclosureGroup());

    act(() => {
      result.current.toggle('account');
    });
    act(() => {
      result.current.close('notifications');
    });

    expect(result.current.open).toBe('account');
  });

  it('keeps stable operation identities across re-renders', () => {
    const { result, rerender } = renderHook(() => useDisclosureGroup());
    const firstToggle = result.current.toggle;
    const firstClose = result.current.close;

    rerender();

    expect(result.current.toggle).toBe(firstToggle);
    expect(result.current.close).toBe(firstClose);
  });

  it('starts closed again when the hook is remounted', () => {
    // Requirement 1.13: the header keys this hook on the viewport layout, so a
    // breakpoint crossing remounts it and discards any expanded surface.
    const { result, unmount } = renderHook(() => useDisclosureGroup());

    act(() => {
      result.current.toggle('navigation');
    });
    expect(result.current.open).toBe('navigation');
    unmount();

    const remounted = renderHook(() => useDisclosureGroup());
    expect(remounted.result.current.open).toBeNull();
  });
});
