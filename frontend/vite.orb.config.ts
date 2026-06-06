import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone vite config for the VoiceOrb dev harness. Uses a dedicated port
// (5180) to avoid clashing with quant's dev ports. Entry = voice-orb-dev.html.
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  build: { rollupOptions: { input: "voice-orb-dev.html" } },
});
