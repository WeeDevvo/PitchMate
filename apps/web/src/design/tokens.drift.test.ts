import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  colourNames,
  loadTokens,
  renderAll,
  resolveColour,
  // @ts-expect-error -- plain ESM build script, no type declarations
} from '../../../../packages/design-tokens/scripts/build.mjs'

/*
 * The design tokens live in packages/design-tokens: one DTCG source, built into
 * the web's CSS, the design-system export, and the phone and watch values. The
 * built files are committed. If this fails, run
 * `npm run tokens --workspace @pitchmate/web`.
 */

const tokensPackage = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'design-tokens',
)
const dist = join(tokensPackage, 'dist')
const source = loadTokens(join(tokensPackage, 'tokens'))
const rendered: Record<string, string> = renderAll(source)

describe('design tokens outputs', () => {
  it.each(Object.keys(rendered))('%s matches what the token source renders', (file) => {
    const committed = readFileSync(join(dist, file), 'utf8')

    expect(committed.replace(/\r\n/g, '\n')).toBe(rendered[file])
  })

  it('declares every colour token for both themes on the web', () => {
    const css = rendered['tokens.css']
    const [, dark, light] = css.split(/^(?=:root,|\[data-theme='light'\])/m)
    const names: string[] = colourNames(source)

    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(dark).toContain(`--pm-${name}:`)
      expect(light).toContain(`--pm-${name}:`)
    }
  })

  it('resolves every colour to a literal value in both themes', () => {
    for (const name of colourNames(source) as string[]) {
      for (const theme of ['dark', 'light']) {
        expect(resolveColour(source, name, theme)).toMatch(/^(#[0-9a-f]{6}|rgba\(.+\))$/)
      }
    }
  })

  it('gives the phone and the watch the same colours as the web', () => {
    const bg: string = resolveColour(source, 'bg', 'dark')

    expect(rendered['tokens.css']).toContain(`--pm-bg: ${bg};`)
    expect(rendered['tokens.ts']).toContain(`"bg": "${bg}"`)
    expect(rendered['PitchMateTokens.swift']).toContain('public static let bg = Color(.sRGB')
  })
})
