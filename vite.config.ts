import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': new URL('./shared', import.meta.url).pathname
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    modulePreload: { polyfill: false }
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
