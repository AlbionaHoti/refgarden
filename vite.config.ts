import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  build: { rollupOptions: { input: mode === 'hosted' ? ['index.html'] : ['index.html', 'legacy.html'] } },
  server: { proxy: { '/api': 'http://127.0.0.1:4318' } },
}));
