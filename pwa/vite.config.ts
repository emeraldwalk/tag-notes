import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

// Plan 8: served by the tracker Worker at the site root. Overridable for a build under a subpath.
const base = process.env.VITE_BASE_PATH ?? '/'
// The commit this bundle was built from (Workers Builds sets WORKERS_CI_COMMIT_SHA), shown in Settings next to the
// server's build, so a phone still running an older bundle is visible.
const appBuild = (process.env.WORKERS_CI_COMMIT_SHA ?? 'dev').slice(0, 7)

export default defineConfig({
  base,
  define: {
    __APP_BUILD__: JSON.stringify(appBuild),
  },
  plugins: [
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Tracker',
        short_name: 'Tracker',
        description: 'Notes, food and the health data behind blood sugar highs.',
        scope: base,
        start_url: base,
        theme_color: '#2f6f4f',
        background_color: '#fefefe',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
      // Only the app's own files are precached. Navigations to /api and /auth go to the network: sign-in
      // redirects and JSON must never be answered with the cached index.html. No runtime caching: data comes from
      // the API each time (online only).
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
})
