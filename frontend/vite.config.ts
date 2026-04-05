import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Use inline service worker — avoids separate sw.ts compilation issues
      injectRegister: 'auto',
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^\/api\/(catalog|lists)/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
            },
          },
          {
            urlPattern: /minio.*\.(webp|jpg|png)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 2592000 },
            },
          },
        ],
      },
      manifest: {
        name: 'קניות ביחד',
        short_name: 'קניות',
        description: 'רשימת קניות משפחתית משותפת',
        theme_color: '#2D6A4F',
        background_color: '#F7F5F0',
        display: 'standalone',
        orientation: 'portrait',
        dir: 'rtl',
        lang: 'he',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', rewrite: (p: string) => p.replace(/^\/api/, '') },
      '/ws':  { target: 'ws://localhost:8001', ws: true },
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
})
