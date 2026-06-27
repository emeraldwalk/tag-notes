import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

// Overridable so CI can deploy feature branches under a different subpath
// (e.g. /tag-notes/preview/) without touching the production build.
const base = process.env.VITE_BASE_PATH ?? '/tag-notes/'
const isPreview = process.env.VITE_APP_VARIANT === 'preview'

export default defineConfig({
  base,
  plugins: [
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: isPreview ? 'Tag Notes (Preview)' : 'Tag Notes',
        short_name: isPreview ? 'Notes Preview' : 'Notes',
        description: 'Capture freeform notes with embedded titles and tags.',
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
      // The production service worker registers with scope "/tag-notes/",
      // which also covers "/tag-notes/preview/". Without this denylist its
      // NavigationRoute intercepts every navigation in that scope -
      // including a first-ever visit to /preview/ - and serves back the
      // production index.html before the preview build's own service
      // worker ever gets a chance to register.
      workbox: isPreview
        ? undefined
        : {
            navigateFallbackDenylist: [/^\/tag-notes\/preview\//],
          },
    }),
  ],
  test: {
    environment: 'node',
  },
})
