import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/tag-notes/',
  plugins: [
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      devOptions: {
        enabled: true,
      },
    }),
  ],
  test: {
    environment: 'node',
  },
})
