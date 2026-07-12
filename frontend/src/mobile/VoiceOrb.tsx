import { useEffect, useRef } from "react";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

/**
 * Canvas voice orb — self-contained, offline-safe, state-reactive. Ported
 * verbatim from the design source.
 *
 * IMPORTANT: the clamp helpers `A` (alpha clamp), `cs` (color-stop offset clamp)
 * and `shp` (sheen offset clamp) are load-bearing — without them
 * `gradient.addColorStop` throws `IndexSizeError` on some animation frames when
 * a computed alpha/offset drifts outside [0,1]. Do not remove them.
 */
export function VoiceOrb({
  state,
  accent = "#2ed3a0",
  size = 220,
}: {
  state: VoiceState;
  accent?: string;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stRef = useRef(state);
  stRef.current = state;
  const acRef = useRef(accent);
  acRef.current = accent;

  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const t0 = performance.now();
    let level = 0.12;
    let running = true;
    const reduced =
      typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    const hexToRgb = (h: string): [number, number, number] => {
      const n = parseInt(h.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const rings: { r: number; a: number }[] = [];

    const draw = (now: number) => {
      if (!running) return;
      const dpr = Math.min(devicePixelRatio || 1, 2.5);
      const w = cvs.clientWidth;
      const h = cvs.clientHeight;
      if (cvs.width !== w * dpr) {
        cvs.width = w * dpr;
        cvs.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const T = (now - t0) / 1000;
      const st = stRef.current;
      const [r, g, b] = hexToRgb(acRef.current || "#2ed3a0");
      // alpha clamp — keeps rgba() alpha in [0,1]
      const A = (a: number) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
      // color-stop offset clamp — keeps addColorStop offset in [0,1]
      const cs = (grad: CanvasGradient, off: number, col: string) =>
        grad.addColorStop(Math.max(0, Math.min(1, off || 0)), col);

      // target level per state
      let target = 0.12;
      if (st === "listening")
        target = 0.42 + 0.4 * Math.abs(Math.sin(T * 5.1)) * (0.6 + 0.4 * Math.sin(T * 13.3));
      else if (st === "speaking") target = 0.5 + 0.42 * Math.abs(Math.sin(T * 3.0 + Math.sin(T * 7.0)));
      else if (st === "thinking") target = 0.2 + 0.06 * Math.sin(T * 2.2);
      else target = 0.14 + 0.05 * Math.sin(T * 1.3);
      level += (target - level) * 0.18;
      const base = Math.min(w, h) * 0.2;
      const core = base * (1 + 0.16 * level);

      // outer glow
      const glow = ctx.createRadialGradient(cx, cy, core * 0.3, cx, cy, core * 3.2);
      cs(glow, 0, A(0.28 + 0.25 * level));
      cs(glow, 0.5, A(0.07));
      cs(glow, 1, A(0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // expanding rings while listening
      if (st === "listening" && Math.random() < 0.045) rings.push({ r: core, a: 0.5 });
      for (let i = rings.length - 1; i >= 0; i--) {
        const rg = rings[i];
        rg.r += 1.6;
        rg.a *= 0.975;
        if (rg.a < 0.02) {
          rings.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(cx, cy, rg.r, 0, Math.PI * 2);
        ctx.strokeStyle = A(rg.a);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      // waveform ring of bars
      const N = 56;
      const rot = T * (st === "speaking" ? 0.5 : 0.22);
      for (let i = 0; i < N; i++) {
        const ang = (i / N) * Math.PI * 2 + rot;
        const seed = Math.sin(i * 12.9 + T * (st === "idle" ? 1 : 6)) * 0.5 + 0.5;
        const amp = base * 0.34 * level * (0.35 + 0.65 * seed) + 1.5;
        const r1 = core * 1.18;
        const r2 = r1 + amp;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
        ctx.strokeStyle = A(0.28 + 0.5 * level);
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      // core sphere
      const sphere = ctx.createRadialGradient(
        cx - core * 0.35,
        cy - core * 0.4,
        core * 0.15,
        cx,
        cy,
        core,
      );
      cs(sphere, 0, `rgba(255,255,255,${0.9 - 0.2 * (1 - level)})`);
      cs(sphere, 0.35, A(0.95));
      cs(sphere, 1, `rgba(${(r * 0.55) | 0},${(g * 0.55) | 0},${(b * 0.55) | 0},0.95)`);
      ctx.beginPath();
      ctx.arc(cx, cy, core, 0, Math.PI * 2);
      ctx.fillStyle = sphere;
      ctx.fill();

      // rotating sheen
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, core, 0, Math.PI * 2);
      ctx.clip();
      const sh = ctx.createLinearGradient(cx - core, cy - core, cx + core, cy + core);
      // sheen offset clamp — keeps the three stops strictly inside (0,1)
      const shp = Math.max(0.001, Math.min(0.999, (T * 0.25) % 1));
      cs(sh, shp - 0.2, "rgba(255,255,255,0)");
      cs(sh, shp, "rgba(255,255,255,0.22)");
      cs(sh, shp + 0.2, "rgba(255,255,255,0)");
      ctx.fillStyle = sh;
      ctx.fillRect(cx - core, cy - core, core * 2, core * 2);
      ctx.restore();

      if (!reduced || st !== "idle") raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} style={{ width: size, height: size, display: "block" }} />;
}
