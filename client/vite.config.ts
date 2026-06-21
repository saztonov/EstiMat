import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Один идентификатор на сборку: вшивается в бандл (__BUILD_ID__) и кладётся
// в dist/version.json. В рантайме хук сравнивает их и предлагает обновиться,
// если вкладка работает на устаревшем бандле.
// Меняется при каждой реальной пересборке фронта (Docker-слой сборки
// инвалидируется при изменении client/). Можно переопределить env BUILD_ID.
const BUILD_ID = process.env.BUILD_ID || new Date().toISOString();

const versionFilePlugin = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ buildId: BUILD_ID }),
    });
  },
});

export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true, // проксировать WebSocket (/api/realtime) на бэкенд
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
