import { describe, it, expect, beforeEach } from 'vitest'
import {
  createInMemorySessionStore,
  createLocalStorageSessionStore,
  SESSION_STORAGE_KEY,
  type PersistedSession,
  type SessionStore,
} from './SessionStore'

const VALID_SESSION: PersistedSession = {
  accessToken: 'access-token-abc',
  refreshToken: 'refresh-token-xyz',
  expiresAtMs: 1_700_000_000_000,
}

/**
 * The in-memory and localStorage-backed stores must share identical contracts,
 * so the core behaviour is exercised against both via this shared suite. The
 * localStorage-backed store relies on jsdom's `localStorage` (provided by the
 * project's test environment).
 */
function sharedStoreBehaviour(makeStore: () => SessionStore): void {
  it('round-trips a saved session through load', () => {
    const store = makeStore()
    store.save(VALID_SESSION)
    expect(store.load()).toEqual(VALID_SESSION)
  })

  it('returns null when no session has been saved', () => {
    const store = makeStore()
    expect(store.load()).toBeNull()
  })

  it('returns null after clear removes the session (Requirement 8.5)', () => {
    const store = makeStore()
    store.save(VALID_SESSION)
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('replaces prior state on a subsequent save', () => {
    const store = makeStore()
    store.save(VALID_SESSION)
    const next: PersistedSession = {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAtMs: 1_800_000_000_000,
    }
    store.save(next)
    expect(store.load()).toEqual(next)
  })
}

describe('createInMemorySessionStore', () => {
  sharedStoreBehaviour(createInMemorySessionStore)
})

describe('createLocalStorageSessionStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  sharedStoreBehaviour(createLocalStorageSessionStore)

  it('persists under the single namespaced key', () => {
    const store = createLocalStorageSessionStore()
    store.save(VALID_SESSION)
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull()
  })

  it('survives being reloaded from the same underlying storage', () => {
    // A fresh store instance reading the same localStorage models a full reload.
    createLocalStorageSessionStore().save(VALID_SESSION)
    const afterReload = createLocalStorageSessionStore()
    expect(afterReload.load()).toEqual(VALID_SESSION)
  })

  it('returns null when the key is absent (Requirement 8.5)', () => {
    expect(createLocalStorageSessionStore().load()).toBeNull()
  })

  it('returns null when accessToken is missing (Requirement 8.5)', () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ refreshToken: 'r', expiresAtMs: 1 }),
    )
    expect(createLocalStorageSessionStore().load()).toBeNull()
  })

  it('returns null when accessToken is empty (Requirement 8.5)', () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ accessToken: '', refreshToken: 'r', expiresAtMs: 1 }),
    )
    expect(createLocalStorageSessionStore().load()).toBeNull()
  })

  it('returns null when refreshToken is missing (Requirement 8.5)', () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ accessToken: 'a', expiresAtMs: 1 }),
    )
    expect(createLocalStorageSessionStore().load()).toBeNull()
  })

  it('returns null when refreshToken is empty (Requirement 8.5)', () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ accessToken: 'a', refreshToken: '', expiresAtMs: 1 }),
    )
    expect(createLocalStorageSessionStore().load()).toBeNull()
  })

  it('returns null when expiresAtMs is missing or non-finite (Requirement 8.5)', () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ accessToken: 'a', refreshToken: 'r' }),
    )
    expect(createLocalStorageSessionStore().load()).toBeNull()

    // NaN/Infinity are not representable in JSON (become null), so cover the
    // string-typed expiry case too.
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAtMs: 'x' }),
    )
    expect(createLocalStorageSessionStore().load()).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, '{ not valid json')
    expect(createLocalStorageSessionStore().load()).toBeNull()
  })
})

describe('createInMemorySessionStore — incomplete-state semantics', () => {
  it('reports absent when saved a session missing a token (Requirement 8.5)', () => {
    const store = createInMemorySessionStore()
    // Force an incomplete value through the typed boundary to prove load
    // re-validates identically to the browser store.
    store.save({ accessToken: 'a', expiresAtMs: 1 } as unknown as PersistedSession)
    expect(store.load()).toBeNull()
  })
})
