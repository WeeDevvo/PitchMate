/**
 * Unit tests for the Shell_Frame's viewport layout detection.
 *
 * Three claims, matching the three acceptance criteria the hook answers:
 *
 * - a viewport narrower than 768 pixels reports the Compact_Layout, and 768
 *   itself is already wide, so the boundary is inclusive on the wide side
 *   (Requirements 1.6, 1.7);
 * - a crossing of the boundary is reported to the caller, so the frame can
 *   re-render into the other layout (Requirement 1.13); and
 * - an environment that cannot answer the query — no `matchMedia`, a throwing
 *   `matchMedia`, or one offering only the deprecated listener pair — still
 *   yields a usable layout rather than an error.
 *
 * jsdom lays nothing out and evaluates no media query, so the width is supplied
 * by a controllable `matchMedia` stub that parses `min-width` out of the query
 * and can flip the reported width and notify its subscribers — the same approach
 * the landing feature's responsive and ThemeProvider suites take. That stub lives
 * in `viewportLayoutTestHarness.ts` because the frame's layout tests (task 10.10)
 * drive the same crossings through the whole Shell_Frame; it offers the modern
 * and the deprecated listener APIs separately, because choosing between them is
 * part of what this hook does.
 *
 * Feature: app-shell
 * Requirements: 1.6, 1.7, 1.13
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useViewportLayout,
  WIDE_LAYOUT_MIN_WIDTH_PX,
  WIDE_LAYOUT_QUERY,
} from './useViewportLayout';
import { installViewport, restoreViewport } from './viewportLayoutTestHarness';

afterEach(() => {
  restoreViewport();
});

describe('useViewportLayout — which layout each width calls for', () => {
  // Requirement 1.7 — 768 is a wide width, so the boundary is stated once.
  it('declares the boundary at 768 pixels as an inclusive min-width query', () => {
    expect(WIDE_LAYOUT_MIN_WIDTH_PX).toBe(768);
    expect(WIDE_LAYOUT_QUERY).toBe('(min-width: 768px)');
  });

  // Requirement 1.6
  it.each([360, 480, 767])('reports the compact layout at %ipx', (width) => {
    installViewport(width);

    const { result } = renderHook(() => useViewportLayout());

    expect(result.current).toBe('compact');
  });

  // Requirement 1.7 — 768 itself is wide, not compact.
  it.each([768, 1024, 1920])('reports the wide layout at %ipx', (width) => {
    installViewport(width);

    const { result } = renderHook(() => useViewportLayout());

    expect(result.current).toBe('wide');
  });
});

describe('useViewportLayout — crossing the boundary', () => {
  // Requirement 1.13
  it('reports the wide layout after a compact viewport widens past the boundary', () => {
    const viewport = installViewport(767);
    const { result } = renderHook(() => useViewportLayout());
    expect(result.current).toBe('compact');

    act(() => {
      viewport.setWidth(768);
    });

    expect(result.current).toBe('wide');
  });

  // Requirement 1.13
  it('reports the compact layout after a wide viewport narrows below the boundary', () => {
    const viewport = installViewport(1024);
    const { result } = renderHook(() => useViewportLayout());
    expect(result.current).toBe('wide');

    act(() => {
      viewport.setWidth(767);
    });

    expect(result.current).toBe('compact');
  });

  // Requirement 1.13 — a change that stays on one side of the boundary is not a
  // layout change, so the reported value is unchanged.
  it('keeps reporting the same layout for a width change within one band', () => {
    const viewport = installViewport(1024);
    const { result } = renderHook(() => useViewportLayout());

    act(() => {
      viewport.setWidth(1920);
    });

    expect(result.current).toBe('wide');
  });

  // Requirement 1.13 — the subscription is released with the frame, so a later
  // crossing cannot notify an unmounted tree.
  it('releases its media-query subscription on unmount', () => {
    const viewport = installViewport(1024);
    const { unmount } = renderHook(() => useViewportLayout());
    expect(viewport.liveListenerCount).toBeGreaterThan(0);

    unmount();

    expect(viewport.liveListenerCount).toBe(0);
  });

  // Requirement 1.13 — a browser exposing only the deprecated listener pair
  // still gets live layout changes.
  it('observes crossings through the deprecated listener pair', () => {
    const viewport = installViewport(360, 'legacy');
    const { result, unmount } = renderHook(() => useViewportLayout());
    expect(result.current).toBe('compact');

    act(() => {
      viewport.setWidth(1024);
    });
    expect(result.current).toBe('wide');

    unmount();
    expect(viewport.liveListenerCount).toBe(0);
  });
});

describe('useViewportLayout — environments that cannot answer the query', () => {
  // Requirement 1.6 — compact keeps every Destination reachable behind the
  // disclosure control, so an unknown width degrades to it.
  it('reports the compact layout where matchMedia is absent', () => {
    Reflect.deleteProperty(window, 'matchMedia');

    const { result } = renderHook(() => useViewportLayout());

    expect(result.current).toBe('compact');
  });

  // Requirement 1.6
  it('reports the compact layout where the media query is rejected', () => {
    window.matchMedia = (() => {
      throw new Error('media query rejected');
    }) as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewportLayout());

    expect(result.current).toBe('compact');
  });
});
