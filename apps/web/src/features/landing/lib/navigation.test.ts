import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  navigateWithFallback,
  DEFAULT_NAV_TIMEOUT_MS,
  type NavigationAttempt,
} from './navigation'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('navigateWithFallback', () => {
  it('resolves { ok: true } when the attempt confirms reachability within the budget', async () => {
    const attempt: NavigationAttempt = vi.fn(() => Promise.resolve())

    const result = await navigateWithFallback('/signup', DEFAULT_NAV_TIMEOUT_MS, {
      attempt,
    })

    expect(result).toEqual({ ok: true })
    expect(attempt).toHaveBeenCalledWith('/signup')
  })

  it('resolves { ok: false } when the attempt rejects', async () => {
    const attempt: NavigationAttempt = vi.fn(() =>
      Promise.reject(new Error('unreachable')),
    )

    const result = await navigateWithFallback('/privacy', DEFAULT_NAV_TIMEOUT_MS, {
      attempt,
    })

    expect(result).toEqual({ ok: false })
  })

  it('resolves { ok: false } when a synchronous attempt throws', async () => {
    const attempt: NavigationAttempt = vi.fn(() => {
      throw new Error('boom')
    })

    const result = await navigateWithFallback('/terms', DEFAULT_NAV_TIMEOUT_MS, {
      attempt,
    })

    expect(result).toEqual({ ok: false })
  })

  it('resolves { ok: false } when the attempt exceeds the time budget', async () => {
    vi.useFakeTimers()
    // An attempt that never settles — only the budget can decide the outcome.
    const attempt: NavigationAttempt = vi.fn(() => new Promise<void>(() => {}))

    const promise = navigateWithFallback('/login', 3000, { attempt })

    // Just before the budget expires: still pending.
    await vi.advanceTimersByTimeAsync(2999)
    // Cross the 3-second boundary.
    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toEqual({ ok: false })
  })

  it('does not report a timeout failure when the attempt wins the race', async () => {
    vi.useFakeTimers()
    let confirmReachable: (() => void) | undefined
    const attempt: NavigationAttempt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          confirmReachable = resolve
        }),
    )

    const promise = navigateWithFallback('/signup', 3000, { attempt })

    // Confirm reachability well within the budget.
    await vi.advanceTimersByTimeAsync(1000)
    confirmReachable?.()

    await expect(promise).resolves.toEqual({ ok: true })

    // Advancing past the old budget must not change the already-settled result.
    await vi.advanceTimersByTimeAsync(5000)
    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('clears the timeout timer once the attempt settles', async () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const attempt: NavigationAttempt = vi.fn(() => Promise.resolve())

    await navigateWithFallback('/signup', 3000, { attempt })
    // Let the resolved attempt microtask flush.
    await vi.advanceTimersByTimeAsync(0)

    expect(clearSpy).toHaveBeenCalled()
  })

  it('defaults to a 3-second budget when no timeout is supplied', async () => {
    vi.useFakeTimers()
    const attempt: NavigationAttempt = vi.fn(() => new Promise<void>(() => {}))

    const promise = navigateWithFallback('/login', undefined, { attempt })

    await vi.advanceTimersByTimeAsync(DEFAULT_NAV_TIMEOUT_MS)

    await expect(promise).resolves.toEqual({ ok: false })
  })

  it('uses window.location.assign by default and reports success on navigation', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } } as unknown as Window)

    // The default attempt initiates a full-page navigation and stays pending,
    // so within a short budget the outcome is a (retryable) timeout failure,
    // but the navigation call itself must have been made.
    const result = await navigateWithFallback('/signup', 10)

    expect(assign).toHaveBeenCalledWith('/signup')
    expect(result).toEqual({ ok: false })

    vi.unstubAllGlobals()
  })
})
