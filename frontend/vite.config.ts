import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Make a new deploy take over immediately instead of waiting for every tab
      // to close. Without these, the old precached bundle keeps being served after
      // a deploy (the "it still shows the old screen" problem).
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Restorna',
        short_name: 'Restorna',
        theme_color: '#9E7C46',
        background_color: '#F4F1EA',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
    }),
  ],
  server: { port: 5173 },
});
