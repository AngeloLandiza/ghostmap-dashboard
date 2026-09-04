import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Route chunks are code-split by React.lazy; these manual chunks keep the heavy
    // libraries (three.js, charts) out of the entry bundle even when several routes share them.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('three') || id.includes('@react-three')) return 'three'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('ably')) return 'realtime'
          return undefined
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
  },
})
