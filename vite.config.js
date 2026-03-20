export default defineConfig({
  plugins: [react()],
  esbuild: {
    target: 'es2020'
  },
  build: {
    target: 'es2020'
  }
})
