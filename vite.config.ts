import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Один общий билд для всех заведений. Манифест, иконки и метаданные каждого
// заведения генерирует `tenant:publish` в dist/s/<slug>/ — поэтому manifest: false.
// Service worker собирается из src/sw.ts (injectManifest) и регистрируется
// приложением в scope /s/<slug>/ (этап 7).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['assets/**/*.{js,css,woff,woff2,svg,png,webp}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { sourcemap: true },
});
