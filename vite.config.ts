import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), {
    name: 'reload-procedural-game',
    handleHotUpdate({ file, server }) {
      if (file.replace(/\\/g, '/').indexOf('/src/game/') !== -1) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  }],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 25 },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
