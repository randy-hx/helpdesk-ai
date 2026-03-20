import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  esbuild: {
    target: 'es2022',
    supported: {
      'optional-chaining': true,
      'nullish-coalescing': true,
    },
  },
  build: {
    target: 'es2022'
  }
})
