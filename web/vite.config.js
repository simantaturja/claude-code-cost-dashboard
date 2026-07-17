import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative base so the built bundle works both served at "/" by server.js and
  // loaded from disk inside a VS Code webview (asset URLs get rewritten there).
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
    },
  },
});
