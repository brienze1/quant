import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone vite config for the audioService dev harness (WI-2.2). Uses a
// dedicated port (5181) to avoid clashing with quant's dev ports and the orb
// harness (5180). Entry = voice-audio-dev.html. The self-hosted VAD/onnx assets
// in public/vad/ are served from the app root so the lib loads them offline.
export default defineConfig({
  plugins: [react()],
  server: { port: 5181, strictPort: true },
  build: { rollupOptions: { input: "voice-audio-dev.html" } },
});
