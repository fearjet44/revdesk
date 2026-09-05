import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { controlDeskPlugin } from './server/plugin.ts'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), controlDeskPlugin(path.join(root, 'data'))],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Tailscale serve holds the tailnet :5173 and proxies here. Without
    // strictPort Vite treats that as "in use" and walks 5174, then 5175
    // (Ready for Duty).
    strictPort: true,
    allowedHosts: ['brendanthenavigator.mole-bushmaster.ts.net'],
  },
})
