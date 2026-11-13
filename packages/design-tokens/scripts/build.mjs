// Builds every platform's tokens from the DTCG source files in ../tokens.
//
//   dist/tokens.css             web: `--pm-*` custom properties, dark on `:root`, light on `[data-theme='light']`
//   dist/tokens.json            the design-system export shape (what the claude.ai design system reads)
//   dist/tokens.ts              phone: plain values for React Native
//   dist/PitchMateTokens.swift  watch: SwiftUI constants
//
// Run `npm run build --workspace @pitchmate/design-tokens` after changing a token. The outputs are
// committed; apps/web/src/design/tokens.drift.test.ts fails while any of them differs from what
// this renders. Each render function is pure so that test can call it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOKEN_PREFIX = '--pm-'

/** Where a token keeps the value of a theme other than dark, the default. */
const MODES = 'pitchmate.modes'
const SOURCE_FILES = ['primitive', 'semantic', 'scale', 'component', 'type', 'native']
const THEMES = ['dark', 'light']

/**
 * Reads the source files into one object keyed by file name (`primitive`, `semantic`, ...).
 * `tokensDir` is the folder holding them: a test runner that rewrites `import.meta.url` passes it.
 */
export function loadTokens(tokensDir) {
  return Object.fromEntries(
    SOURCE_FILES.map((name) => [
      name,
      JSON.parse(readFileSync(join(tokensDir, `${name}.tokens.json`), 'utf8')),
    ]),
  )
}

const px = (value) => Number(String(value).replace(/px$/, ''))
const isToken = (node) => node !== null && typeof node === 'object' && '$value' in node
const ALIAS = /^\{([a-z0-9.-]+)\}$/

/** The entries of a group that are tokens or sub-groups, skipping `$type`, `$extensions` and friends. */
const children = (group) => Object.entries(group).filter(([key]) => !key.startsWith('$'))

/** A token's raw value for a theme: the light override where there is one, else `$value`. */
const themeValue = (token, theme) =>
  theme === 'light' ? (token.$extensions?.[MODES]?.light ?? token.$value) : token.$value

/** The token an alias path such as `color.green.500` or `font.display` names. */
function lookup(src, path) {
  const segments = path.split('.')
  for (const file of SOURCE_FILES) {
    let node = src[file]
    for (const segment of segments) node = node?.[segment]
    if (isToken(node)) return node
  }
  throw new Error(`Unknown token {${path}}`)
}

/** A colour's literal value in a theme, following aliases all the way down. */
export function resolveColour(src, name, theme) {
  const token = src.semantic.color[name]
  if (!isToken(token)) throw new Error(`Unknown colour token ${name}`)
  let value = themeValue(token, theme)
  for (let alias = ALIAS.exec(value); alias; alias = ALIAS.exec(value)) {
    const [group, ...rest] = alias[1].split('.')
    value =
      group === 'color' && rest.length === 1
        ? themeValue(lookup(src, alias[1]), theme)
        : lookup(src, alias[1]).$value
  }
  return value
}

/** The names of the semantic colour tokens, in source order. */
export const colourNames = (src) => children(src.semantic.color).map(([name]) => name)

/**
 * A colour as the web and the export write it: an alias to another semantic colour stays a
 * reference (so `provisional` follows `result-draw`), an alias to a primitive becomes its value.
 */
function colourReference(src, name, theme, reference) {
  const value = themeValue(src.semantic.color[name], theme)
  const alias = ALIAS.exec(value)
  if (!alias) return value
  const [group, ...rest] = alias[1].split('.')
  return group === 'color' && rest.length === 1 ? reference(rest[0]) : lookup(src, alias[1]).$value
}

const shadowCss = (layers) =>
  layers
    .map((l) => `${l.offsetX} ${l.offsetY} ${l.blur} ${l.spread} ${l.color}${l.inset ? ' inset' : ''}`)
    .join(', ')

const fontStack = (families) => families.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ')
const bezierCss = (points) => `cubic-bezier(${points.join(', ')})`

/** The type styles in source order, each with the group it sits in. */
function typeStyles(src) {
  return children(src.type.type).flatMap(([, group]) =>
    children(group).map(([name, token]) => ({ name, token, group })),
  )
}

/**
 * The spacing scale as a group in ascending order. JSON object keys that look like integers
 * iterate first, which would put `0-5` after `24`.
 */
const spaceScale = (src) =>
  children(src.scale.space).sort(([, a], [, b]) => px(a.$value) - px(b.$value))

/** The entries of a group, or the entries themselves when a caller has already ordered them. */
const entriesOf = (node) => (Array.isArray(node) ? node : children(node))

const familyKey = (style) => ALIAS.exec(style.token.$value.fontFamily)[1].split('.')[1]

/* ------------------------------------------------------------------ web */

export function renderTokensCss(src) {
  const line = (name, value) => `  ${TOKEN_PREFIX}${name}: ${value};`
  const group = (node, prefix, format = (v) => v) =>
    entriesOf(node).map(([name, token]) => line(`${prefix}${name}`, format(token.$value)))

  const type = typeStyles(src).flatMap((style) => {
    const v = style.token.$value
    const lines = [
      line(
        `type-${style.name}`,
        `${v.fontWeight} ${v.fontSize}/${v.lineHeight} var(${TOKEN_PREFIX}font-${familyKey(style)})`,
      ),
    ]
    if (v.letterSpacing !== undefined) lines.push(line(`type-${style.name}-tracking`, v.letterSpacing))
    return lines
  })

  const base = [
    ...group(src.scale.font, 'font-', fontStack),
    ...type,
    ...group(spaceScale(src), 'space-'),
    ...group(src.scale.radius, 'radius-'),
    ...group(src.scale.duration, 'duration-'),
    ...group(src.scale.ease, 'ease-', bezierCss),
    ...group(src.component.size, ''),
    ...group(src.scale.z, 'z-'),
  ]

  const themed = (theme) => [
    ...colourNames(src).map((name) =>
      line(name, colourReference(src, name, theme, (other) => `var(${TOKEN_PREFIX}${other})`)),
    ),
    ...children(src.semantic.shadow).map(([name, token]) =>
      line(`shadow-${name}`, shadowCss(themeValue(token, theme))),
    ),
  ]

  const block = (selector, lines) => `${selector} {\n${lines.join('\n')}\n}\n`

  return [
    '/* Generated by @pitchmate/design-tokens (packages/design-tokens/scripts/build.mjs). Do not edit. */\n',
    block(':root', base),
    block(":root,\n[data-theme='dark']", themed('dark')),
    block("[data-theme='light']", themed('light')),
  ].join('\n')
}

/* --------------------------------------------- design-system export */

/** The token export in the shape the claude.ai design system reads and writes. */
export function renderExportJson(src) {
  const flat = (node, prefix, format = (v) => v) => ({
    tokens: entriesOf(node).map(([name, token]) => ({
      name: `${prefix}${name}`,
      value: format(token.$value),
      usage: token.$description,
    })),
  })
  const perTheme = (value) => Object.fromEntries(THEMES.map((theme) => [theme, value(theme)]))

  const groups = children(src.type.type).map(([, group]) => ({
    name: group.$extensions['pitchmate.groupName'],
    family: group.$extensions['pitchmate.family'],
    styles: children(group).map(([name, token]) => {
      const v = token.$value
      const style = { name }
      if (token.$extensions?.['pitchmate.ownFamily']) style.family = ALIAS.exec(v.fontFamily)[1].split('.')[1]
      style.fontSize = v.fontSize
      style.lineHeight = String(v.lineHeight)
      style.fontWeight = v.fontWeight
      if (v.letterSpacing !== undefined) style.letterSpacing = v.letterSpacing
      const sample = token.$extensions?.['pitchmate.sample']
      if (sample !== undefined) style.sample = sample
      style.usage = token.$description
      return style
    }),
  }))

  const data = {
    name: 'PitchMate',
    version: 1,
    color: {
      themes: [
        { id: 'dark', name: 'Dark' },
        { id: 'light', name: 'Light' },
      ],
      tokens: colourNames(src).map((name) => ({
        name,
        value: perTheme((theme) => colourReference(src, name, theme, (other) => `{${other}}`)),
        usage: src.semantic.color[name].$description,
      })),
    },
    type: {
      fonts: src.type.type.$extensions['pitchmate.fontFiles'],
      families: Object.fromEntries(
        children(src.scale.font).map(([name, token]) => [name, fontStack(token.$value)]),
      ),
      groups,
    },
    spacing: flat(spaceScale(src), 'space-'),
    radius: flat(src.scale.radius, 'radius-'),
    shadow: {
      tokens: children(src.semantic.shadow).map(([name, token]) => ({
        name: `shadow-${name}`,
        value: perTheme((theme) => shadowCss(themeValue(token, theme))),
        usage: token.$description,
      })),
    },
    duration: flat(src.scale.duration, 'duration-'),
    easing: flat(src.scale.ease, 'ease-', bezierCss),
    size: flat(src.component.size, ''),
    zIndex: flat(src.scale.z, 'z-', String),
    meta: { source: 'packages/design-tokens in the PitchMate repository' },
  }
  return `${JSON.stringify(data, null, 1)}\n`
}

/* ---------------------------------------------------------------- phone */

const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
const ms = (value) => Number(String(value).replace(/ms$/, ''))
const round = (n) => Math.round(n * 100) / 100

/** A type style as numbers a native text style takes: sizes in points, tracking in points. */
function nativeType(src, style) {
  const v = style.token.$value
  const size = px(v.fontSize)
  const text = {
    fontFamily: lookup(src, ALIAS.exec(v.fontFamily)[1]).$value[0],
    fontWeight: v.fontWeight,
    fontSize: size,
    lineHeight: typeof v.lineHeight === 'number' ? round(size * v.lineHeight) : px(v.lineHeight),
  }
  if (v.letterSpacing !== undefined) text.letterSpacing = round(size * Number(v.letterSpacing.replace(/em$/, '')))
  return text
}

/** Plain values for React Native: colours as strings, lengths as numbers of points. */
export function renderTokensTs(src) {
  const object = (entries) => Object.fromEntries(entries)
  const data = {
    color: object(
      THEMES.map((theme) => [
        theme,
        object(colourNames(src).map((name) => [camel(name), resolveColour(src, name, theme)])),
      ]),
    ),
    shadow: object(
      THEMES.map((theme) => [
        theme,
        object(
          children(src.semantic.shadow).map(([name, token]) => [
            camel(name),
            themeValue(token, theme).map((l) => ({
              offsetX: px(l.offsetX),
              offsetY: px(l.offsetY),
              blur: px(l.blur),
              spread: px(l.spread),
              color: l.color,
              inset: Boolean(l.inset),
            })),
          ]),
        ),
      ]),
    ),
    space: object(spaceScale(src).map(([name, token]) => [name, px(token.$value)])),
    radius: object(children(src.scale.radius).map(([name, token]) => [camel(name), px(token.$value)])),
    size: object(children(src.component.size).map(([name, token]) => [camel(name), px(token.$value)])),
    duration: object(children(src.scale.duration).map(([name, token]) => [camel(name), ms(token.$value)])),
    ease: object(children(src.scale.ease).map(([name, token]) => [camel(name), token.$value])),
    z: object(children(src.scale.z).map(([name, token]) => [camel(name), token.$value])),
    font: object(children(src.scale.font).map(([name, token]) => [camel(name), token.$value[0]])),
    type: object(typeStyles(src).map((style) => [camel(style.name), nativeType(src, style)])),
    spring: object(children(src.native.spring).map(([name, token]) => [camel(name), token.$value])),
    haptic: object(children(src.native.haptic).map(([name, token]) => [camel(name), token.$value])),
  }

  const lines = [
    '// Generated by @pitchmate/design-tokens (packages/design-tokens/scripts/build.mjs). Do not edit.',
    '// Lengths are points, durations are milliseconds, colours are CSS colour strings.',
    '',
  ]
  for (const [name, value] of Object.entries(data)) {
    lines.push(`export const ${name} = ${JSON.stringify(value, null, 2)} as const`, '')
  }
  lines.push('export type ThemeName = keyof typeof color', 'export type ColorName = keyof (typeof color)[ThemeName]', '')
  return lines.join('\n')
}

/* ---------------------------------------------------------------- watch */

function swiftColour(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value)
  const [r, g, b, a] = hex
    ? [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1)
    : rgba.slice(1).map(Number)
  const channel = (n) => (n / 255).toFixed(3)
  return `Color(.sRGB, red: ${channel(r)}, green: ${channel(g)}, blue: ${channel(b)}, opacity: ${a})`
}

/** A Swift identifier for a token name: `surface-raised` to `surfaceRaised`, `0-5` to `s0_5`. */
const swiftName = (name) => (/^\d/.test(name) ? `s${name.replace(/-/g, '_')}` : camel(name))

/** SwiftUI constants. The watch is always dark, so `Palette` is the dark theme; `LightPalette` is there for the phone. */
export function renderTokensSwift(src) {
  const lines = [
    '// Generated by @pitchmate/design-tokens (packages/design-tokens/scripts/build.mjs). Do not edit.',
    '// Lengths are points, durations are seconds.',
    '',
    'import SwiftUI',
    '',
    'public enum PitchMateTokens {',
  ]
  const section = (name, comment, rows) => {
    lines.push(`    /// ${comment}`, `    public enum ${name} {`, ...rows.map((row) => `        ${row}`), '    }', '')
  }
  const palette = (theme) =>
    colourNames(src).map(
      (name) => `public static let ${swiftName(name)} = ${swiftColour(resolveColour(src, name, theme))}`,
    )
  const lengths = (node) =>
    entriesOf(node).map(([name, token]) => `public static let ${swiftName(name)}: CGFloat = ${px(token.$value)}`)

  section('Palette', 'The dark theme: the one the watch always uses.', palette('dark'))
  section('LightPalette', 'The light theme.', palette('light'))
  section('Space', 'The 4-point spacing scale.', lengths(spaceScale(src)))
  section('Radius', 'Corner radii.', lengths(src.scale.radius))
  section('Size', 'Target sizes and fixed component sizes.', lengths(src.component.size))
  section(
    'Duration',
    'Animation durations.',
    children(src.scale.duration).map(
      ([name, token]) => `public static let ${swiftName(name)}: Double = ${ms(token.$value) / 1000}`,
    ),
  )
  section(
    'Spring',
    'Spring animations: response in seconds and damping fraction.',
    children(src.native.spring).map(
      ([name, token]) =>
        `public static let ${swiftName(name)} = Animation.spring(response: ${token.$value.response}, dampingFraction: ${token.$value.dampingFraction})`,
    ),
  )
  section(
    'TextStyle',
    'Type styles: family, weight (100 to 900), size, line height and tracking in points.',
    typeStyles(src).map((style) => {
      const t = nativeType(src, style)
      return `public static let ${swiftName(style.name)} = (family: "${t.fontFamily}", weight: ${t.fontWeight}, size: CGFloat(${t.fontSize}), lineHeight: CGFloat(${t.lineHeight}), tracking: CGFloat(${t.letterSpacing ?? 0}))`
    }),
  )
  lines.pop()
  lines.push('}', '')
  return lines.join('\n')
}

/* ------------------------------------------------------------------ all */

/** Every committed output, by file name under dist/. */
export function renderAll(src) {
  return {
    'tokens.css': renderTokensCss(src),
    'tokens.json': renderExportJson(src),
    'tokens.ts': renderTokensTs(src),
    'PitchMateTokens.swift': renderTokensSwift(src),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  mkdirSync(join(packageRoot, 'dist'), { recursive: true })
  for (const [name, content] of Object.entries(renderAll(loadTokens(join(packageRoot, 'tokens'))))) {
    writeFileSync(join(packageRoot, 'dist', name), content)
    console.log(`Wrote dist/${name}`)
  }
}
