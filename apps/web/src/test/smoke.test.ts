import { describe, it, expect } from 'vitest'

describe('test tooling smoke test', () => {
  it('runs the vitest runner', () => {
    expect(1 + 1).toBe(2)
  })

  it('provides a jsdom document environment', () => {
    const el = document.createElement('div')
    el.textContent = 'PitchMate'
    expect(el.textContent).toBe('PitchMate')
  })
})
