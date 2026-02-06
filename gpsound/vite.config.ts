import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import wasm from 'vite-plugin-wasm'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), wasm()],
  // Use BASE_PATH env var for GitHub Pages deployment, default to '/' for local dev
  base: process.env.BASE_PATH || '/',
  build: {
    sourcemap: true
  }
})
