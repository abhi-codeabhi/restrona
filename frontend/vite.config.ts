import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
