import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// @ts-expect-error -- plain ESM build script, no type declarations
import { renderTokensCss } from '../../scripts/generate-design-tokens.mjs'
import tokens from './tokens.json'

/*
 * tokens.css is generated from tokens.json (the design system's export) and
 * committed. If this fails, run `npm run tokens --workspace @pitchmate/web`.
 */

describe('design tokens stylesheet', () => {
  it('matches what tokens.json renders', () => {
    const committed = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8')

    expect(committed.replace(/\r\n/g, '\n')).toBe(renderTokensCss(tokens))
  })

  it('declares every colour token for both themes', () => {
    const css: string = renderTokensCss(tokens)
    const [, dark, light] = css.split(/^(?=:root,|\[data-theme='light'\])/m)

    for (const token of tokens.color.tokens) {
      expect(dark).toContain(`--pm-${token.name}:`)
      expect(light).toContain(`--pm-${token.name}:`)
    }
  })
})
