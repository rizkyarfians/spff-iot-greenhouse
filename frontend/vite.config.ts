import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Explicit opt-in preview; never proxy browser requests to the production API.
// Vite binds to localhost when launched with --host 127.0.0.1.
const aiPreview = process.env.VITE_SPFF_AI_PREVIEW === 'true'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': aiPreview ? 'http://127.0.0.1:5002' : 'http://127.0.0.1:5001',
    },
  },
})
