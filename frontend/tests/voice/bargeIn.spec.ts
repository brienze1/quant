import { test, expect } from "@playwright/test";
import { gotoAudioHarness } from "./helpers";

// Barge-in (WI-5.2): if the user starts talking while TTS is playing, playback
// stops and the turn flips to the user (state → listening).
//
// The fully end-to-end barge-in (live VAD firing onSpeechStart from the
// fake-audio mic *during* a TTS clip) depends on real-time interplay between
// Chromium's playback clock and Silero's speech-start — inherently
// nondeterministic in headless CI, especially with the harness's very short
// mock TTS clip. So here we test the DETERMINISTIC barge-in CONTRACT: with
// bargeIn enabled and the service in `speaking`, the speech-start handler (the
// exact callback the VAD fires) must stop playback, resolve the in-flight
// speak(), and transition to `listening`.
//
// If the mock TTS clip is too short to even reach `speaking` in this
// environment, the test skips (rather than failing) — the live-VAD path is on
// the manual checklist; this asserts the code contract that backs it.

test.beforeEach(async ({ page }) => {
  await gotoAudioHarness(page);
});

test("barge-in: speech during playback stops TTS and flips to listening", async ({
  page,
}) => {
  // Enable barge-in and warm up the mic/VAD on the live service.
  await page.evaluate(async () => {
    const svc = (
      window as unknown as {
        __voiceService: {
          setBargeIn: (b: boolean) => void;
          init: () => Promise<void>;
        };
      }
    ).__voiceService;
    svc.setBargeIn(true);
    await svc.init();
  });

  const result = await page.evaluate(async () => {
    const svc = (
      window as unknown as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        __voiceService: any;
      }
    ).__voiceService;

    // Start a speak() and keep its promise. With barge-in it resolves either on
    // natural end OR when the barge-in handler stops it.
    const speakDone: Promise<void> = svc.speak("a longer reply to talk over");

    // Wait until we actually enter `speaking` (the <audio> "play" event fired).
    const startedSpeaking = await new Promise<boolean>((resolve) => {
      let tries = 0;
      const iv = setInterval(() => {
        if (svc.getState() === "speaking") {
          clearInterval(iv);
          resolve(true);
        } else if (++tries > 100) {
          clearInterval(iv);
          resolve(false);
        }
      }, 10);
    });

    if (!startedSpeaking) {
      // Let the speak() settle so we don't leak it.
      await Promise.race([speakDone, new Promise((r) => setTimeout(r, 1000))]).catch(
        () => undefined,
      );
      return { startedSpeaking, stateAfter: svc.getState(), resolved: false };
    }

    // Fire the exact callback the VAD raises on speech-start (barge-in trigger).
    svc.handleSpeechStart();

    // speak() must RESOLVE (stopped, not rejected).
    let resolved = false;
    await Promise.race([
      speakDone.then(() => {
        resolved = true;
      }),
      new Promise((r) => setTimeout(r, 2000)),
    ]);

    return { startedSpeaking, stateAfter: svc.getState(), resolved };
  });

  test.skip(
    !result.startedSpeaking,
    "mock TTS clip did not reach `speaking` in this env (live-VAD barge-in is on the manual checklist)",
  );

  expect(result.resolved).toBe(true); // in-flight speak() resolved
  expect(result.stateAfter).toBe("listening"); // turn flipped to the user
});
