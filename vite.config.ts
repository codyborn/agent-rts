import { defineConfig } from 'vite';
import { aiPlugin } from './src/server/ai-plugin';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 3000,
  },
  plugins: [aiPlugin()],
});
