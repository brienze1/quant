import { test, expect, Page } from "@playwright/test";
import { gotoAudioHarness } from "../voice/helpers";

// Tests for the ordered, coalescing terminal input queue (remote typing fix).
//
// Every xterm onData event used to fire an independent fire-and-forget RPC; in
// remote (tunnel) mode those rode concurrent HTTP POSTs and the PTY writes
// raced, scrambling keystrokes. createTerminalIO serializes them: at most one
// in-flight input send per session, FIFO, coalescing whatever accumulates
// while a send is in flight into a single follow-up chunk (capped at 16KB).
//
// We reuse the audio harness purely because Vite serves the source there, so
// the page can `import('/src/terminal/terminalInput.ts')` and the last test
// can stub the Wails go bindings + the remote shim's window.__quantRemoteWS.

const MAX_CHUNK = 16 * 1024;

type Call = {
  kind: "input" | "resize";
  sessionId: string;
  data?: string;
  rows?: number;
  cols?: number;
};

// Install a terminalIO instance backed by a fully controllable transport:
// every send is recorded in __tio.calls and returns a deferred promise the
// test settles explicitly via __tio.deferred[i].resolve()/reject().
async function setupDeferredTransport(page: Page) {
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const mod = await import("/src/terminal/terminalInput.ts");
    const calls: unknown[] = [];
    const deferred: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    const defer = () =>
      new Promise<void>((resolve, reject) => deferred.push({ resolve, reject }));
    const transport = {
      sendInput(sessionId: string, data: string) {
        calls.push({ kind: "input", sessionId, data });
        return defer();
      },
      sendResize(sessionId: string, rows: number, cols: number) {
        calls.push({ kind: "resize", sessionId, rows, cols });
        return defer();
      },
    };
    w.__tio = {
      io: mod.createTerminalIO(transport),
      calls,
      deferred,
      tick: () => new Promise((r) => setTimeout(r, 0)),
    };
  });
}

test.describe("terminalInput ordered send queue", () => {
  test("input arriving while a send is in flight coalesces into ONE follow-up send", async ({
    page,
  }) => {
    await gotoAudioHarness(page);
    await setupDeferredTransport(page);

    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (window as any).__tio;
      t.io.sendInput("s1", "a"); // goes out immediately
      t.io.sendInput("s1", "b"); // queued behind the in-flight send
      t.io.sendInput("s1", "c"); // appended to the same pending buffer
      await t.tick();
      const callsWhileInFlight = t.calls.length;
      t.deferred[0].resolve();
      await t.tick();
      t.deferred[1]?.resolve();
      await t.tick();
      return { callsWhileInFlight, calls: t.calls };
    });

    expect(result.callsWhileInFlight).toBe(1);
    expect(result.calls as Call[]).toEqual([
      { kind: "input", sessionId: "s1", data: "a" },
      { kind: "input", sessionId: "s1", data: "bc" },
    ]);
  });

  test("never two concurrent input sends per session", async ({ page }) => {
    await gotoAudioHarness(page);

    const result = await page.evaluate(async () => {
      const mod = await import("/src/terminal/terminalInput.ts");
      let inFlight = 0;
      let maxInFlight = 0;
      const datas: string[] = [];
      const transport = {
        sendInput(_sessionId: string, data: string) {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          datas.push(data);
          // Settle asynchronously so pumping overlaps real event-loop turns.
          return new Promise<void>((resolve) =>
            setTimeout(() => {
              inFlight--;
              resolve();
            }, 0),
          );
        },
        sendResize: () => Promise.resolve(),
      };
      const io = mod.createTerminalIO(transport);
      let expected = "";
      for (let i = 0; i < 100; i++) {
        const piece = `${String(i).padStart(3, "0")};`;
        expected += piece;
        io.sendInput("s1", piece);
      }
      for (
        let i = 0;
        i < 500 && datas.join("").length < expected.length;
        i++
      ) {
        await new Promise((r) => setTimeout(r, 0));
      }
      return { maxInFlight, joined: datas.join(""), expected };
    });

    expect(result.maxInFlight).toBe(1);
    expect(result.joined).toBe(result.expected);
  });

  test("FIFO is preserved across a rejected send (no retry, no reorder)", async ({
    page,
  }) => {
    await gotoAudioHarness(page);
    await setupDeferredTransport(page);

    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (window as any).__tio;
      t.io.sendInput("s1", "a"); // in flight
      t.io.sendInput("s1", "b");
      t.io.sendInput("s1", "c");
      await t.tick();
      t.deferred[0].reject(new Error("boom")); // "a" is dropped, NOT retried
      await t.tick();
      t.deferred[1]?.resolve();
      await t.tick();
      return { calls: t.calls };
    });

    // The failed chunk is dropped (retrying keystrokes risks duplicates); the
    // queued data still goes out next, in order.
    expect(result.calls as Call[]).toEqual([
      { kind: "input", sessionId: "s1", data: "a" },
      { kind: "input", sessionId: "s1", data: "bc" },
    ]);
  });

  test(">16KB of pending input splits into ordered MAX_CHUNK slices", async ({
    page,
  }) => {
    await gotoAudioHarness(page);
    await setupDeferredTransport(page);

    const result = await page.evaluate(
      async ({ total }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = (window as any).__tio;
        let big = "";
        for (let i = 0; i < total; i++) {
          big += String.fromCharCode(33 + (i % 90));
        }
        t.io.sendInput("s1", big);
        await t.tick();
        // Settle each send as it appears until the queue drains.
        for (let i = 0; i < 10 && t.deferred.length > i; i++) {
          t.deferred[i].resolve();
          await t.tick();
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lengths = (t.calls as any[]).map((c) => c.data.length);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const joined = (t.calls as any[]).map((c) => c.data).join("");
        return { lengths, matches: joined === big };
      },
      { total: 40_000 },
    );

    expect(result.lengths).toEqual([MAX_CHUNK, MAX_CHUNK, 40_000 - 2 * MAX_CHUNK]);
    expect(result.matches).toBe(true);
  });

  test("resize is last-write-wins: intermediate sizes are skipped, duplicates suppressed", async ({
    page,
  }) => {
    await gotoAudioHarness(page);
    await setupDeferredTransport(page);

    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (window as any).__tio;
      t.io.sendResize("s1", 24, 80); // in flight
      t.io.sendResize("s1", 30, 100); // superseded before it ever goes out
      t.io.sendResize("s1", 40, 120); // the size that must win
      await t.tick();
      const callsWhileInFlight = t.calls.length;
      t.deferred[0].resolve();
      await t.tick();
      t.deferred[1]?.resolve();
      await t.tick();
      t.io.sendResize("s1", 40, 120); // equals last sent → no send at all
      await t.tick();
      return { callsWhileInFlight, calls: t.calls };
    });

    expect(result.callsWhileInFlight).toBe(1);
    expect(result.calls as Call[]).toEqual([
      { kind: "resize", sessionId: "s1", rows: 24, cols: 80 },
      { kind: "resize", sessionId: "s1", rows: 40, cols: 120 },
    ]);
  });

  test("default transport: WS send()===true skips the api fallback, false hits it", async ({
    page,
  }) => {
    await gotoAudioHarness(page);

    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const goCalls: unknown[] = [];
      const wsFrames: unknown[] = [];

      // Fake go bindings behind api.sendMessage / api.resizeTerminal.
      const existingGo = w.go || {};
      existingGo.controller = existingGo.controller || {};
      existingGo.controller.sessionController = {
        SendMessage: async (id: string, msg: string) => {
          goCalls.push({ m: "SendMessage", id, msg });
        },
        ResizeTerminal: async (id: string, rows: number, cols: number) => {
          goCalls.push({ m: "ResizeTerminal", id, rows, cols });
        },
      };
      w.go = existingGo;

      const mod = await import("/src/terminal/terminalInput.ts");
      const tick = () => new Promise((r) => setTimeout(r, 0));

      // Socket open: frames ride the WS, the RPC fallback is never touched.
      w.__quantRemoteWS = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        send: (frame: any) => {
          wsFrames.push(frame);
          return true;
        },
      };
      mod.terminalIO.sendInput("ws-sess", "hello");
      mod.terminalIO.sendResize("ws-sess", 40, 120);
      await tick();
      const goCallsWithWs = goCalls.length;

      // Socket down: send() returns false → fall back to the api bindings.
      w.__quantRemoteWS = { send: () => false };
      mod.terminalIO.sendInput("rpc-sess", "world");
      mod.terminalIO.sendResize("rpc-sess", 50, 90);
      await tick();
      await tick();
      return { goCallsWithWs, wsFrames, goCalls };
    });

    expect(result.goCallsWithWs).toBe(0);
    expect(result.wsFrames).toEqual([
      { type: "input", sessionId: "ws-sess", data: "hello" },
      { type: "resize", sessionId: "ws-sess", rows: 40, cols: 120 },
    ]);
    expect(result.goCalls).toEqual([
      { m: "SendMessage", id: "rpc-sess", msg: "world" },
      { m: "ResizeTerminal", id: "rpc-sess", rows: 50, cols: 90 },
    ]);
  });
});
