/// <reference types="vitest/config" />
import { defineConfig, type IndexHtmlTransformResult, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { THEME_BOOTSTRAP_SOURCE } from './src/theme/themeBootstrap'

/** Identifies the bootstrap-injecting plugin in the plugin list and in tests. */
export const THEME_BOOTSTRAP_PLUGIN_NAME = 'pitchmate:theme-bootstrap'

/**
 * Injects the one pre-paint theme bootstrap into `index.html`'s `<head>`.
 *
 * The bootstrap body is declared once, as `THEME_BOOTSTRAP_SOURCE` in
 * `src/theme/themeBootstrap.ts`; `index.html` carries no hand-written copy, so
 * exactly one bootstrap declaration exists in the application (Requirements
 * 12.13, 15.7).
 *
 * The tag is deliberately a plain inline script with no `type`: a module script
 * is deferred past the document's first paint, which is precisely what
 * Requirement 12.13 rules out. Injecting into `head` (rather than
 * `head-prepend`) keeps it after the charset and viewport metadata while still
 * running before any body content is painted.
 */
export function themeBootstrapPlugin(): Plugin {
  return {
    name: THEME_BOOTSTRAP_PLUGIN_NAME,
    transformIndexHtml(): IndexHtmlTransformResult {
      return [
        {
          tag: 'script',
          children: THEME_BOOTSTRAP_SOURCE,
          injectTo: 'head',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), themeBootstrapPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
