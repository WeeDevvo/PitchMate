import { describe, it, expect } from 'vitest'
import {
  createRedirectTargetStore,
  redirectCandidateFromSearch,
  REDIRECT_PARAM_NAME,
} from './redirectTargetStore'

describe('redirectCandidateFromSearch', () => {
  it('reads the redirect parameter value, tolerating a leading "?"', () => {
    expect(redirectCandidateFromSearch('?redirect=/squads/123')).toBe(
      '/squads/123',
    )
    expect(redirectCandidateFromSearch('redirect=/squads/123')).toBe(
      '/squads/123',
    )
  })

  it('percent-decodes the captured value', () => {
    expect(
      redirectCandidateFromSearch('?redirect=%2Fsquads%2F123%3Ftab%3Dstats'),
    ).toBe('/squads/123?tab=stats')
  })

  it('returns null when the parameter is absent or empty', () => {
    expect(redirectCandidateFromSearch('')).toBeNull()
    expect(redirectCandidateFromSearch('?other=/x')).toBeNull()
    expect(redirectCandidateFromSearch('?redirect=')).toBeNull()
  })

  it('supports a custom parameter name', () => {
    expect(redirectCandidateFromSearch('?returnTo=/x', 'returnTo')).toBe('/x')
    expect(redirectCandidateFromSearch('?redirect=/x', 'returnTo')).toBeNull()
  })

  it('exposes the default parameter name', () => {
    expect(REDIRECT_PARAM_NAME).toBe('redirect')
  })
})

describe('createRedirectTargetStore', () => {
  it('captures a candidate and peeks it without clearing', () => {
    const store = createRedirectTargetStore()
    store.capture('/squads/1')

    expect(store.peek()).toBe('/squads/1')
    expect(store.peek()).toBe('/squads/1')
  })

  it('takes a candidate once, then reports null (single-use, Requirement 11.6)', () => {
    const store = createRedirectTargetStore()
    store.capture('/squads/1')

    expect(store.take()).toBe('/squads/1')
    expect(store.take()).toBeNull()
    expect(store.peek()).toBeNull()
  })

  it('treats null/undefined/empty captures as clearing the store', () => {
    const store = createRedirectTargetStore()
    store.capture('/squads/1')
    store.capture(null)
    expect(store.peek()).toBeNull()

    store.capture('/squads/2')
    store.capture(undefined)
    expect(store.peek()).toBeNull()

    store.capture('/squads/3')
    store.capture('')
    expect(store.peek()).toBeNull()
  })

  it('replaces a previously captured candidate', () => {
    const store = createRedirectTargetStore()
    store.capture('/first')
    store.capture('/second')
    expect(store.take()).toBe('/second')
  })
})
