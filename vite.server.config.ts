import { defineConfig } from 'vite'

// One-file Node bundle of `server/standalone.ts` (yaml inlined) for the
// desktop shell's release build. `npm run build:server` → dist-server/server.mjs.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'server/standalone.ts',
    outDir: 'dist-server',
    target: 'node20',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'server.mjs' } },
  },
  ssr: { noExternal: true },
})
