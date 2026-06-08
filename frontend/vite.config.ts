import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {readFile} from 'node:fs/promises'
import path from 'node:path'

// Serve the self-hosted VAD/onnxruntime-web assets in public/vad/ as RAW static
// files during `vite dev`. onnxruntime-web dynamically import()s its ESM wasm
// glue (ort-wasm-*.mjs) from onnxWASMBasePath; Vite's dev server refuses to
// module-transform files living under public/ and answers /vad/x.mjs?import with
// a 500, which makes the Silero VAD fail to load ("voice detector unavailable").
// This middleware short-circuits any /vad/* request (with or without ?import)
// and streams the raw bytes with the right MIME, so dev behaves like the
// production static asset server. No effect on `vite build` (public/ is copied).
function serveVadAssetsRaw() {
  const types: Record<string, string> = {
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
    '.onnx': 'application/octet-stream',
  }
  return {
    name: 'serve-vad-assets-raw',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith('/vad/')) return next()
        const rel = url.split('?')[0]
        const ext = path.extname(rel)
        const file = path.join(server.config.root, 'public', rel)
        readFile(file)
          .then((buf) => {
            res.setHeader('Content-Type', types[ext] || 'application/octet-stream')
            res.setHeader('Cache-Control', 'no-cache')
            res.end(buf)
          })
          .catch(() => next())
      })
    },
  }
}

export default defineConfig({
  plugins: [serveVadAssetsRaw(), react(), tailwindcss()]
})
