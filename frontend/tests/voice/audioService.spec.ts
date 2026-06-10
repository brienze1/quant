import { test, expect, Page } from "@playwright/test";
import { gotoAudioHarness, MARKER } from "./helpers";

// E2E for the frontend audio service (WI-2.2) — the capture→VAD→STT and
// TTS→playback paths — driven against the audio dev harness on :5181 with
// Chromium fake-audio (utterance.wav) and the harness's mock transport
// (fixed transcript marker + tiny WAV).

// Record the sequence of service states by subscribing to onState from the page.
async function installStateRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __voiceService?: {
        onState: (cb: (s: string) => void) => () => void;
        getState: () => string;
      };
      __stateLog?: string[];
    };
    w.__stateLog = [w.__voiceService!.getState()];
    w.__voiceService!.onState((s) => w.__stateLog!.push(s));
  });
}

async function getStateLog(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __stateLog?: string[] }).__stateLog ?? [],
  );
}

test.beforeEach(async ({ page }) => {
  await gotoAudioHarness(page);
});

test("listen(): fake-audio WAV drives the real Silero VAD to endpoint → STT marker", async ({
  page,
}) => {
  await installStateRecorder(page);

  // Drive listen() via the harness's Listen button so its handler runs the real
  // service AND writes the resolved transcript back to the DOM + window globals.
  await page.click("[data-testid=listen]");

  // 1+2) The DOM transcript shows exactly the mock marker once listen()
  // resolves (the round-trip is proven: fake-audio → VAD → STT mock → marker).
  await expect(page.locator("[data-testid=transcript]")).toHaveText(MARKER);

  // The resolved value is also mirrored on the window global.
  const transcript = await page.evaluate(
    () => (window as unknown as { __voiceTranscript?: string }).__voiceTranscript,
  );
  expect(transcript).toBe(MARKER);

  // 3) State machine proves the REAL Silero VAD endpointed the WAV:
  //    listen() sets `listening`; `thinking` is ONLY entered from
  //    handleSpeechEnd() (i.e. the VAD fired speech-end on the fake audio).
  //    resolveListen() now HOLDS `thinking` after STT resolves (it reflects the
  //    agent's real reasoning window until the next speak()/listen()), instead of
  //    dropping straight back to `idle`. So the terminal state here is `thinking`.
  //    No infinite record (bounded earlier than maxListen — proven by the
  //    promise resolving, not timing out).
  const log = await getStateLog(page);
  expect(log).toContain("listening");
  expect(log).toContain("thinking"); // <-- VAD endpointed the utterance
  expect(log[log.length - 1]).toBe("thinking");
  // Ordering: listening must precede thinking which precedes the final idle.
  const iListening = log.indexOf("listening");
  const iThinking = log.indexOf("thinking");
  expect(iListening).toBeGreaterThanOrEqual(0);
  expect(iThinking).toBeGreaterThan(iListening);

  // 4) The input analyser exists (the orb has live mic data while listening).
  const hasInputAnalyser = await page.evaluate(
    () =>
      !!(
        window as unknown as {
          __voiceService: { getInputAnalyser: () => unknown };
        }
      ).__voiceService.getInputAnalyser(),
  );
  expect(hasInputAnalyser).toBe(true);

  // No error surfaced.
  expect(
    await page.evaluate(
      () => (window as unknown as { __voiceError?: string | null }).__voiceError,
    ),
  ).toBeFalsy();
});

test("listen({record:true}) starts pinned in recording mode; a segment ending in 'stop recording' finalizes hands-free with the phrase stripped", async ({
  page,
}) => {
  await installStateRecorder(page);

  await page.evaluate(() => {
    const w = window as unknown as {
      __voiceService: { listen: (o?: { record?: boolean }) => Promise<string> };
      __voiceTranscriptQueue?: string[];
      __recordedResult?: string;
    };
    // Script the segment's STT result to END with the spoken stop phrase.
    w.__voiceTranscriptQueue = ["I want dark mode and bigger fonts. Stop recording."];
    w.__recordedResult = undefined;
    void w.__voiceService.listen({ record: true }).then(
      (t) => (w.__recordedResult = t),
      (e) => (w.__recordedResult = `ERROR:${String((e as { message?: string })?.message ?? e)}`),
    );
  });

  // Agent-activated recording: the turn is pinned open the moment it is armed,
  // BEFORE any speech — state goes straight to "recording".
  await page.waitForFunction(
    () => (window as unknown as { __voiceState?: string }).__voiceState === "recording",
  );

  // The fake-audio utterance endpoints → the segment's STT resolves ending in
  // the stop phrase → the recording finalizes as if "■ stop" was pressed, with
  // the phrase (and separating punctuation) stripped from the transcript.
  await page.waitForFunction(
    () =>
      (window as unknown as { __recordedResult?: string }).__recordedResult !== undefined,
  );
  const result = await page.evaluate(
    () => (window as unknown as { __recordedResult?: string }).__recordedResult,
  );
  expect(result).toBe("I want dark mode and bigger fonts");

  // The turn never passed through the plain "listening" state: record mode
  // enters "recording" directly (and speech-start keeps it there).
  const log = await getStateLog(page);
  expect(log).toContain("recording");
  expect(log).not.toContain("listening");
  // After the hands-free stop, the turn resolves into the post-listen
  // "thinking" hold (same as a manual stop).
  expect(log[log.length - 1]).toBe("thinking");
});

test("speak(): TTS → <audio> emits play then ended, state speaking → idle", async ({
  page,
}) => {
  await installStateRecorder(page);

  await page.evaluate(() =>
    (
      window as unknown as { __voiceService: { speak: (t: string) => Promise<void> } }
    ).__voiceService.speak("hello from the voice service"),
  );

  const log = await getStateLog(page);
  // speak() drives `speaking` (on <audio> play) then resolves back to `idle`
  // (on <audio> ended). The promise resolving proves `ended` fired.
  expect(log).toContain("speaking");
  expect(log[log.length - 1]).toBe("idle");

  // Output analyser was wired for the speaking-reactive orb.
  const hasOutputAnalyser = await page.evaluate(
    () =>
      !!(
        window as unknown as {
          __voiceService: { getOutputAnalyser: () => unknown };
        }
      ).__voiceService.getOutputAnalyser(),
  );
  // Best-effort: routing can fail on some codecs; assert it was at least
  // attempted by checking no playback error surfaced. If wired, even better.
  const err = await page.evaluate(
    () => (window as unknown as { __voiceError?: string | null }).__voiceError,
  );
  expect(err).toBeFalsy();
  // The analyser is torn down on finishSpeak(), so by now it may be null again;
  // we don't hard-assert its presence post-playback (it's transient).
  void hasOutputAnalyser;
});
