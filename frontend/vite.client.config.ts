import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import type { OutputBundle } from 'rollup'

// Build config for the STANDALONE PWA remote client (dist-client), hosted at a
// stable origin — GitHub Pages: https://<owner>.github.io/quant-remote/. This is
// separate from the desktop Wails build (vite.config.ts → dist/): different entry
// (client.html → src/client.tsx), different base, and it bundles the configurable
// cross-origin transport + a service worker for offline launch.
//
// The entry file is client.html (frontend/index.html is the desktop entry and
// can't be reused). GitHub Pages serves index.html for a directory, so we rename
// the emitted client.html → index.html during the build, BEFORE vite-plugin-pwa
// globs the output for its precache manifest.
function renameClientHtml() {
  return {
    name: 'rename-client-html-to-index',
    enforce: 'post' as const,
    generateBundle(_opts: unknown, bundle: OutputBundle) {
      const html = bundle['client.html']
      if (html) {
        html.fileName = 'index.html'
        delete bundle['client.html']
        bundle['index.html'] = html
      }
    },
  }
}

const BASE = '/quant-remote/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    renameClientHtml(),
    VitePWA({
      // "prompt": new deploys wait until the user confirms via the in-app
      // Update popup (client.tsx registerSW) instead of activating silently —
      // on iOS "autoUpdate" only lands on the second cold launch, which made
      // updates look like they never arrived.
      registerType: 'prompt',
      injectRegister: false, // client.tsx registers the SW manually
      filename: 'sw.js',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Quant — Claude Code crew',
        short_name: 'Quant',
        description: 'Orchestrate a crew of Claude Code agents from anywhere.',
        id: BASE,
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0c0e',
        theme_color: '#0b0c0e',
        categories: ['developer', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'New session', short_name: 'New', url: BASE + '?new=session' },
          { name: 'Voice', short_name: 'Voice', url: BASE + '?voice=1' },
        ],
      },
      workbox: {
        // Precache the whole built shell so the app OPENS offline (live data
        // still needs the tunnel). Cross-origin tunnel calls (/__quant_remote/*)
        // are never same-origin here, so Workbox does not intercept them.
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2}'],
        navigateFallback: BASE + 'index.html',
        navigateFallbackDenylist: [/^\/__quant_remote\//],
        cleanupOutdatedCaches: true,
        // Prompt-update flow: the new SW must NOT activate on its own
        // (skipWaiting false — the Update button sends SKIP_WAITING), but once
        // it activates it must claim open pages so controllerchange fires and
        // the updateSW(true) reload actually happens.
        skipWaiting: false,
        clientsClaim: true,
        // The app bundle is large (xterm, mermaid, three, react-flow); raise the
        // precache size ceiling so the shell precaches in full.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: 'dist-client',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./client.html', import.meta.url)),
    },
  },
})
