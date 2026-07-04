import { test, expect } from "@playwright/test";
import { gotoAudioHarness } from "./helpers";

// Regression test for the false "Voice mode has ENDED" bug.
//
// In recording mode the Go-side voice_listen blocks on a 120s ListenTimeout that
// the frontend keeps alive by pinging voiceListenExtend every 30s. The bug: that
// keepalive used to run ONLY while the audioService state was "recording". When a
// long recording stops, audioService switches to "thinking" and THEN transcribes
// (await Promise.all(segments)) — leaving "recording" before listen() resolves.
// If transcribing the recording took >120s the keepalive was already stopped, so
// the Go side timed out and told the agent voice mode had ended, even though the
// pane was alive and the transcript landed moments later.
//
// The fix ties the keepalive to the LIFETIME of the record-mode listen request
// (capture + the post-recording STT window), not to the transient "recording"
// state. This test drives registerVoiceBridge with a fully controllable stub
// service and Playwright's fake clock: it fires a record:true listen, leaves the
// "recording" state while the listen is still pending, fast-forwards past several
// keepalive intervals, and asserts the pings KEEP coming. On the old code the
// pings would have stopped the moment the state left "recording".
//
// We reuse the audio harness purely because Vite serves the source there, so the
// page can `import('/src/voice/voiceBridge.ts')` and stub the Wails runtime/go
// bindings the bridge talks to. The harness's own __voiceService is unused.

const SESSION = "keepalive-test-session";
const REQUEST_ID = "vr-keepalive-test";
const INTERVAL_MS = 30_000;

test.describe("voiceBridge recording keepalive", () => {
  test("keeps extending the listen across the post-recording STT window", async ({
    page,
  }) => {
    await gotoAudioHarness(page);

    // 1. Stub the Wails event runtime + go bindings, build a controllable stub
    //    audio service, then register the real voiceBridge against it. No timers
    //    are created yet (registerVoiceBridge only subscribes to the event); the
    //    keepalive interval is armed later, when the record listen fires.
    await page.evaluate(
      async ({ session }) => {
        const w = window as unknown as Record<string, unknown>;
        const extendCalls: string[] = [];
        const resultCalls: Array<{ id: string; t: string; e: string }> = [];
        w.__extendCalls = extendCalls;
        w.__resultCalls = resultCalls;

        // Fake Wails event runtime: capture the "voice:request" handler so the
        // test can deliver an event synchronously.
        w.runtime = {
          EventsOn: (event: string, handler: (req: unknown) => void) => {
            if (event === "voice:request") w.__voiceHandler = handler;
            return () => {
              w.__voiceHandler = null;
            };
          },
        };

        // Fake go bindings that api.voiceListenExtend / voiceResult call through
        // callGo (window.go.voice.voiceController.*). Record every call.
        const existingGo = (w.go as Record<string, unknown>) || {};
        existingGo.voice = {
          voiceController: {
            VoiceListenExtend: async (id: string) => {
              extendCalls.push(id);
            },
            VoiceResult: async (id: string, t: string, e: string) => {
              resultCalls.push({ id, t, e });
            },
            VoiceResultClosed: async (id: string) => {
              resultCalls.push({ id, t: "", e: "closed" });
            },
          },
        };
        w.go = existingGo;

        // Controllable stub IAudioService: listen() stays pending until the test
        // calls __resolveListen, and __pushState lets the test simulate the
        // service leaving the "recording" state mid-request.
        let stateCb: ((s: string) => void) | null = null;
        let listenResolve: ((t: string) => void) | null = null;
        w.__pushState = (s: string) => {
          if (stateCb) stateCb(s);
        };
        w.__resolveListen = (t: string) => {
          if (listenResolve) listenResolve(t);
        };
        const noop = () => {};
        const stub = {
          onState: (cb: (s: string) => void) => {
            stateCb = cb;
            return () => {
              stateCb = null;
            };
          },
          onError: () => noop,
          getState: () => "idle",
          getInputAnalyser: () => null,
          getOutputAnalyser: () => null,
          init: async () => {},
          listen: () =>
            new Promise<string>((res) => {
              listenResolve = res;
            }),
          cancelListen: noop,
          startRecording: noop,
          stopRecording: async () => {},
          isRecording: () => false,
          onRecordingTranscript: () => noop,
          speak: async () => {},
          stopSpeaking: noop,
          setBargeIn: noop,
          setBargeInGuardMs: noop,
          listInputDevices: async () => [],
          hasDeviceLabels: async () => false,
          setInputDevice: async () => {},
          getInputDevice: () => null,
          onDevicesChanged: () => noop,
          startInputPreview: async () => {},
          stopInputPreview: noop,
          getInputLevel: () => 0,
          getOutputLevel: () => 0,
          getContextState: () => "running",
          resumeContext: async () => {},
          dispose: async () => {},
        };

        const mod = await import("/src/voice/voiceBridge.ts");
        w.__cancelBridge = mod.registerVoiceBridge(
          session,
          stub as unknown as Parameters<typeof mod.registerVoiceBridge>[1],
          {},
        );
      },
      { session: SESSION },
    );

    // 2. Install the fake clock BEFORE the keepalive interval is armed. Timers
    //    created from here on are controlled by page.clock.
    await page.clock.install();

    // 3. Deliver a record-mode listen request. handleRequest synchronously arms
    //    the keepalive (immediate ping + 30s interval) before awaiting listen().
    await page.evaluate(
      ({ session, requestId }) => {
        const w = window as unknown as {
          __voiceHandler?: (req: unknown) => void;
        };
        w.__voiceHandler?.({
          sessionId: session,
          requestId,
          kind: "listen",
          text: "",
          record: true,
        });
      },
      { session: SESSION, requestId: REQUEST_ID },
    );

    // Immediate ping fired on start.
    expect(
      await page.evaluate(
        () => (window as unknown as { __extendCalls: string[] }).__extendCalls.length,
      ),
    ).toBe(1);

    // 4. Simulate the bug window: the service leaves "recording" (enters the STT
    //    "thinking" phase) while the listen is STILL pending. On the old code this
    //    stopped the keepalive. Fast-forward past 3 intervals.
    await page.evaluate(() =>
      (window as unknown as { __pushState: (s: string) => void }).__pushState(
        "thinking",
      ),
    );
    // fastForward jumps the clock and fires each recurring timer once per call,
    // so calling it once per interval gives 3 controlled keepalive ticks. (runFor
    // would tick through every intermediate ms and flood the harness's own RAF /
    // analyser loops, crashing the page.)
    for (let i = 0; i < 3; i++) await page.clock.fastForward(INTERVAL_MS);

    // The keepalive must have kept pinging: 1 immediate + 3 interval ticks.
    expect(
      await page.evaluate(
        () => (window as unknown as { __extendCalls: string[] }).__extendCalls.length,
      ),
    ).toBe(4);
    expect(
      await page.evaluate(() =>
        (window as unknown as { __extendCalls: string[] }).__extendCalls.every(
          (id) => id === "vr-keepalive-test",
        ),
      ),
    ).toBe(true);

    // 5. Transcription completes → listen() resolves → settle() stops the
    //    keepalive and reports the result.
    await page.evaluate(() =>
      (window as unknown as { __resolveListen: (t: string) => void }).__resolveListen(
        "hello from a long recording",
      ),
    );

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __resultCalls: unknown[] }).__resultCalls.length,
        ),
      )
      .toBe(1);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __resultCalls: Array<{ t: string }> })
            .__resultCalls[0].t,
      ),
    ).toBe("hello from a long recording");

    // 6. After settle, the keepalive is stopped: fast-forwarding fires no more
    //    pings.
    const countBefore = await page.evaluate(
      () => (window as unknown as { __extendCalls: string[] }).__extendCalls.length,
    );
    for (let i = 0; i < 4; i++) await page.clock.fastForward(INTERVAL_MS);
    const countAfter = await page.evaluate(
      () => (window as unknown as { __extendCalls: string[] }).__extendCalls.length,
    );
    expect(countAfter).toBe(countBefore);
  });
});
