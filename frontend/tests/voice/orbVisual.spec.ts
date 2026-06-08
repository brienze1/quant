import { test, expect, Page } from "@playwright/test";

// Orb visual regression (P1 / WI-6.1) on the orb harness (:5180), across the 4
// states × {dark, light}.
//
// The orb is a LIVE WebGL animation (continuous requestAnimationFrame), so a
// strict pixel snapshot is impossible — successive frames legitimately differ by
// up to ~12% of pixels in the animated states. We therefore combine:
//
//   1. A tolerant screenshot baseline (catches gross regressions / a broken or
//      blank orb / wrong theme) while allowing the per-frame pulse animation.
//      Baselines are PLATFORM-SPECIFIC — generated on macOS Chromium. Regenerate
//      with `npx playwright test orbVisual --update-snapshots` on the same OS.
//
//   2. A deterministic EDGE-OVERFLOW check that directly guards WI-5.1 (the
//      speaking flare was reduced to fit a 220×220 orb inside the stage well):
//      we read the canvas border pixels and assert the flare does NOT bleed all
//      the way to the stage frame edge. This is animation-independent.

const STATES = ["idle", "listening", "thinking", "speaking"] as const;
const THEMES = [
  { preset: "quant-dark", label: "dark", bgDark: true },
  { preset: "quiet-light", label: "light", bgDark: false },
] as const;

async function selectState(page: Page, state: string) {
  await page.click(`[data-state-btn=${state}]`);
}
async function selectTheme(page: Page, preset: string) {
  await page.click(`[data-preset-btn=${preset}]`);
}
async function settle(page: Page) {
  await page.waitForTimeout(800); // let the shader reach steady state
}

// Measure how far the orb's glow reaches toward the stage frame edge.
//
// We screenshot the stage element (the COMPOSITED result) rather than calling
// gl.readPixels on the WebGL canvas: the orb's renderer is created without
// `preserveDrawingBuffer`, so the drawing buffer is cleared after each frame
// and an out-of-frame readPixels returns an empty buffer (always-zero → false
// "overflow"). The composited screenshot is reliable regardless of the buffer
// state. We decode the PNG in-browser (the browser has a native PNG decoder)
// onto a 2D canvas and measure the brightest pixel in a thin edge band vs. the
// brightest pixel overall, relative to the dark-well background.
//
// The harness mirrors the production geometry (a 220px orb centered in a 240px
// dark well), so a low ratio means the flare is contained inside the well —
// directly guarding WI-5.1.
//
// We compare the MEAN luminance of a thin edge band against the MEAN of the
// central core. Mean (not max-pixel) is deliberate: the orb's starfield
// scatters single bright specks into the edge band, and a max-pixel metric is
// dominated by one such speck (especially for the dim light-theme purple orb,
// where a white star outshines the orb itself → false "overflow"). The mean is
// robust to specks: a contained flare leaves the edge mean near the dark-well
// baseline while the core is bright (low ratio); a flare that bleeds to the
// frame raises the edge mean toward the core (high ratio).
async function edgeOverflowRatio(page: Page): Promise<number> {
  const buf = await page.locator("[data-orb-stage]").screenshot();
  const b64 = buf.toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("decode failed"));
      img.src = "data:image/png;base64," + b64;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const w = c.width;
    const h = c.height;
    const d = ctx.getImageData(0, 0, w, h).data;
    const lum = (i: number) =>
      0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const band = Math.max(3, Math.round(Math.min(w, h) * 0.06));
    const cx0 = Math.round(w * 0.35);
    const cx1 = Math.round(w * 0.65);
    const cy0 = Math.round(h * 0.35);
    const cy1 = Math.round(h * 0.65);
    let edgeSum = 0;
    let edgeN = 0;
    let coreSum = 0;
    let coreN = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = lum((y * w + x) * 4);
        if (x < band || x >= w - band || y < band || y >= h - band) {
          edgeSum += l;
          edgeN++;
        }
        if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
          coreSum += l;
          coreN++;
        }
      }
    }
    const edge = edgeSum / edgeN;
    const core = coreSum / coreN;
    if (core <= 1) return 1; // nothing rendered → treat as overflow/failure
    return edge / core; // ~0 = contained, →1 = flare reaches the frame
  }, b64);
}

test.beforeEach(async ({ page }) => {
  await page.goto("http://localhost:5180/voice-orb-dev.html", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("[data-orb-stage] canvas");
});

for (const theme of THEMES) {
  for (const state of STATES) {
    test(`orb ${theme.label} / ${state} renders and fits the stage frame`, async ({
      page,
    }) => {
      await selectTheme(page, theme.preset);
      await selectState(page, state);
      await settle(page);

      // 1) Tolerant visual baseline (animation-aware).
      const stage = page.locator("[data-orb-stage]");
      await expect(stage).toHaveScreenshot(`orb-${theme.label}-${state}.png`, {
        maxDiffPixelRatio: 0.2,
        threshold: 0.3,
        animations: "disabled",
      });

      // 2) Deterministic flare-containment guard (WI-5.1). The orb's glow must
      // not reach the stage frame edge — most relevant for `speaking`. Measured
      // edge/core ratios on macOS Chromium: dark 0.09–0.15, light 0.33–0.51
      // (the light core is dimmer so the ratio runs higher even when contained).
      // A bleeding flare would push this toward ~1; 0.6 leaves headroom both ways.
      const ratio = await edgeOverflowRatio(page);
      expect(ratio).toBeLessThan(0.6);
    });
  }
}
