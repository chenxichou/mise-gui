import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { readFileSync } from 'node:fs'

const mainEntry = 'electron/main.ts'

export default defineConfig({
  plugins: [
    {
      name: 'third-party-notices',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt',
          source: readFileSync(new URL('./THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8') })
      },
    },
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        // React Fast Refresh injects an inline preamble and Vite uses a local
        // WebSocket. The production document keeps its strict policy.
        return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:5173 ws://127.0.0.1:5173")
      },
    },
    react(),
    electron({
      main: {
        entry: mainEntry,
        async onstart({ startup }) { await startup(['.']) },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: false,
            rolldownOptions: {
              input: mainEntry,
              output: { format: 'cjs', entryFileNames: 'main.cjs' },
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rolldownOptions: {
              output: { format: 'cjs', entryFileNames: 'preload.cjs' },
            },
          },
        },
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
})
