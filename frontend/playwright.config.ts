import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// E2E config for the Voice feature (WI-6.1).
//
// The whole capture→VAD→STT path is driven deterministically by Chromium's
// fake-audio device: a real speech WAV is fed as the microphone so the real
// Silero VAD endpoints it, with getUserMedia auto-granted. STT/TTS are mocked
// by the audio dev harness (fixed transcript marker + tiny MP3), so assertions
// are exact and the run is fully hermetic (no network, no human).
//
// Two vite dev harnesses are launched as webServers:
//   - audio harness on :5181 (vite.audio.config.ts) — exposes window.__voice*
//   - orb harness   on :5180 (vite.orb.config.ts)   — orb state/theme controls
//
// Visual baselines are platform-specific (generated on macOS Chromium).

const FIXTURE = path.resolve(__dirname, "tests/fixtures/utterance.wav");

export default defineConfig({
  // Covers tests/voice (audio+orb harnesses) and tests/remote (input queue).
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: undefined,
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${FIXTURE}%noloop`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: "npx vite --config vite.audio.config.ts",
      url: "http://localhost:5181",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npx vite --config vite.orb.config.ts",
      url: "http://localhost:5180",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
