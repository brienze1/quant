import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Standalone vite config for the audioService dev harness (WI-2.2). Uses a
// dedicated port (5181) to avoid clashing with quant's dev ports and the orb
// harness (5180). Entry = voice-audio-dev.html. The self-hosted VAD/onnx assets
// in public/vad/ are served from the app root so the lib loads them offline.

// Serve the self-hosted VAD assets (onnx + onnxruntime-web .mjs/.wasm) as RAW
// static files. Needed because onnxruntime-web does a dynamic `import()` of
// `/vad/ort-wasm-*.mjs`; under vite DEV that import gets a `?import` query and
// vite refuses to transform a /public asset (500). Intercepting here serves the
// bytes untouched with the right MIME type. (In a production `vite build` this
// is a non-issue — /public is copied as-is and served statically.)
function serveVadAssets(): Plugin {
  const vadDir = resolve(__dirname, "public/vad");
  const types: Record<string, string> = {
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".wasm": "application/wasm",
    ".onnx": "application/octet-stream",
  };
  return {
    name: "serve-vad-assets-raw",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith("/vad/")) return next();
        const file = resolve(vadDir, url.slice("/vad/".length));
        if (!file.startsWith(vadDir) || !existsSync(file)) return next();
        const ext = file.slice(file.lastIndexOf("."));
        res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  plugins: [serveVadAssets(), react()],
  server: { port: 5181, strictPort: true },
  build: { rollupOptions: { input: "voice-audio-dev.html" } },
});
