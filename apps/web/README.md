# PitchMate web

The PitchMate web app (`@pitchmate/web`): React 19, TypeScript, Vite and React Router 7. Run the commands from the repository root; the root `CLAUDE.md` has the full list.

```bash
npm install
npm run dev                                   # Vite dev server
npm run build                                 # typecheck, then build
npm run lint
npm test --workspace @pitchmate/web           # Vitest
npm run tokens --workspace @pitchmate/web     # rebuild the design tokens
```

## Layout

- `src/app/` composes the routes from the features.
- `src/features/<feature>/` holds each feature behind a barrel (`index.ts`) and one API facade (`api/<feature>Api.ts`).
- `src/ui/` is the shared component library, built from the design system. Features import it through `src/ui/index.ts` only.
- `src/design/` holds the fonts, the logos, and the tests that guard the design tokens. The tokens themselves live in `packages/design-tokens` and reach the app as `--pm-*` CSS custom properties.
- `src/theme/` resolves dark or light before first paint.

The brand and component rules are in `.claude/rules/brand.md`; the boundaries the tests enforce are in `.claude/rules/architecture-rules.md`.
