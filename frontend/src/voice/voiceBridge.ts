// Frontend voice bridge (WI-2.3).
//
// Connects the Go-side MCP voice tools to the browser audio pipeline. The Go
// bridge emits a "voice:request" event when a voice tool fires and blocks on a
// per-request channel; this module listens for those events, runs the audio
// operation via the injected IAudioService, and reports the result back through
// api.voiceResult(requestId, ...), which unblocks the waiting tool handler.
//
// Multi-client note (v1): every client that has registered a bridge for the
// matching session will attempt to handle the event. The first VoiceResult for
// a given requestId wins (the Go bridge ignores later/duplicate resolves), so
// duplicate handling is safe but wasteful. Targeting a single active/primary
// client is a future refinement — for now, register the bridge on the client
// that owns the visible voice pane.

import * as api from "../api";
import type { IAudioService } from "./types";

/** Payload of the "voice:request" event emitted by the Go voice bridge. */
export interface VoiceRequest {
  sessionId: string;
  requestId: string;
  kind: "listen" | "speak";
  text: string;
}

/**
 * Subscribe to "voice:request" events for the given session and service it with
 * the provided audio service. Returns an unsubscribe function.
 *
 * VoicePane (WI-3.1) calls this on mount with the real AudioService; the dev
 * harness / tests can call it with a stub IAudioService.
 *
 * @param sessionId only requests matching this session id are handled
 * @param service   the audio service that performs listen()/speak()
 * @returns an unsubscribe function (call on unmount)
 */
export function registerVoiceBridge(
  sessionId: string,
  service: IAudioService,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!w?.runtime?.EventsOn) {
    // No Wails runtime (e.g. SSR or a bare unit test) — nothing to subscribe to.
    return () => {};
  }

  const cancel = w.runtime.EventsOn("voice:request", (req: VoiceRequest) => {
    // Ignore events for other sessions (each pane handles only its own).
    if (!req || req.sessionId !== sessionId) return;
    void handleRequest(req, service);
  });

  return () => cancel && cancel();
}

/**
 * Run a single voice request and report the result back to Go. Always resolves
 * the request — on failure it reports the error string so the Go handler can
 * surface a recoverable error to the agent rather than hanging until timeout.
 */
async function handleRequest(
  req: VoiceRequest,
  service: IAudioService,
): Promise<void> {
  try {
    if (req.kind === "listen") {
      const transcript = await service.listen();
      await api.voiceResult(req.requestId, transcript, "");
    } else if (req.kind === "speak") {
      await service.speak(req.text);
      await api.voiceResult(req.requestId, "", "");
    } else {
      await api.voiceResult(
        req.requestId,
        "",
        `unknown voice request kind: ${String(req.kind)}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort: if even reporting the error fails, there is nothing more we
    // can do; the Go side will eventually time out.
    try {
      await api.voiceResult(req.requestId, "", message || "voice request failed");
    } catch {
      /* ignore */
    }
  }
}
