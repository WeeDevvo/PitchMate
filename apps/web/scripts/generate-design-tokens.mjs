// Generates src/design/tokens.css from src/design/tokens.json, the token export
// of the PitchMate design system. Run `npm run tokens --workspace @pitchmate/web`
// after replacing tokens.json; src/design/tokens.drift.test.ts fails while the
// committed stylesheet differs from what this renders.
//
// Every custom property is prefixed `--pm-` because feature token tables still
// declare unprefixed names (`--accent-fill`, `--focus-ring`) on the same
// `[data-theme]` selectors, and the two must not collide while features move
// across.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const TOKEN_PREFIX = '--pm-'

const ALIAS = /^\{([a-z0-9-]+)\}$/

/** A token value, with `{name}` aliases resolved to a reference to that token. */
function cssValue(value) {
  const alias = ALIAS.exec(value)
  return alias ? `var(${TOKEN_PREFIX}${alias[1]})` : value
}

function declaration(name, value) {
  return `  ${TOKEN_PREFIX}${name}: ${cssValue(String(value))};`
}

function typeDeclarations(type) {
  const lines = Object.entries(type.families).map(([family, stack]) =>
    declaration(`font-${family}`, stack),
  )
  for (const group of type.groups) {
    for (const style of group.styles) {
      const family = `var(${TOKEN_PREFIX}font-${style.family ?? group.family})`
      lines.push(
        declaration(
          `type-${style.name}`,
          `${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${family}`,
        ),
      )
      if (style.letterSpacing !== undefined) {
        lines.push(declaration(`type-${style.name}-tracking`, style.letterSpacing))
      }
    }
  }
  return lines
}

/** The themed tokens (colours and shadows) for one theme id. */
function themedDeclarations(tokens, theme) {
  return [...tokens.color.tokens, ...tokens.shadow.tokens].map((token) =>
    declaration(token.name, token.value[theme]),
  )
}

/** Renders the whole stylesheet. Pure, so the drift test can call it. */
export function renderTokensCss(tokens) {
  const flat = ['spacing', 'radius', 'duration', 'easing', 'size', 'zIndex'].flatMap(
    (group) => tokens[group].tokens.map((token) => declaration(token.name, token.value)),
  )
  const block = (selector, lines) => `${selector} {\n${lines.join('\n')}\n}\n`

  return [
    '/* Generated from tokens.json by scripts/generate-design-tokens.mjs. Do not edit. */\n',
    block(':root', [...typeDeclarations(tokens.type), ...flat]),
    block(":root,\n[data-theme='dark']", themedDeclarations(tokens, 'dark')),
    block("[data-theme='light']", themedDeclarations(tokens, 'light')),
  ].join('\n')
}

const tokensJson = new URL('../src/design/tokens.json', import.meta.url)
const tokensCss = new URL('../src/design/tokens.css', import.meta.url)

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = JSON.parse(readFileSync(tokensJson, 'utf8'))
  writeFileSync(tokensCss, renderTokensCss(tokens))
  console.log(`Wrote ${fileURLToPath(tokensCss)}`)
}
