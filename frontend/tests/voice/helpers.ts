import { expect, Page } from "@playwright/test";

export const AUDIO_HARNESS = "http://localhost:5181/voice-audio-dev.html";
export const ORB_HARNESS = "http://localhost:5180/voice-orb-dev.html";
export const MARKER = "VOICE_TRANSCRIPT_MARKER";

/**
 * Navigate to the audio harness and wait for window.__voiceService to be
 * constructed. The harness imports the full app module graph (api.ts →
 * xterm/xyflow/dagre/three), so the first hit to a cold vite dev server can
 * trigger a dep re-optimization that RELOADS the page (wiping the global). We
 * reload-and-poll with a generous window so this is robust on cold starts.
 */
export async function gotoAudioHarness(page: Page) {
  await page.goto(AUDIO_HARNESS, { waitUntil: "domcontentloaded" });
  await expect(async () => {
    const ready = await page
      .evaluate(
        () => !!(window as unknown as { __voiceService?: unknown }).__voiceService,
      )
      .catch(() => false);
    if (!ready) {
      await page.reload({ waitUntil: "domcontentloaded" });
      throw new Error("voice service not ready yet");
    }
  }).toPass({ timeout: 45_000, intervals: [500, 1000, 2000] });
}
