import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0' },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: { manualChunks: (id) => /node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react-vendor' : undefined },
    },
  },
});
