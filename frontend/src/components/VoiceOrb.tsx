import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { readOrbTheme } from "./voiceOrbTheme";

export type VoiceOrbState = "idle" | "listening" | "recording" | "thinking" | "speaking";

export interface VoiceOrbProps {
  /** Current orb state. */
  state: VoiceOrbState;
  /**
   * Optional audio source driving amplitude. Pass a Web Audio AnalyserNode for
   * real reactivity, OR a number 0..1 (e.g. from a level meter). When omitted,
   * the orb falls back to the prototypes' simulated per-state drivers so it
   * still animates in a demo.
   */
  analyser?: AnalyserNode | null;
  level?: number;
  /**
   * Per-frame amplitude source (0..1), called once per rAF tick. Preferred over
   * `analyser`/`level`: it lets the host read whichever live level is relevant
   * (input while listening, output while speaking) without the orb depending on
   * a specific AnalyserNode surviving across conversation turns.
   */
  getLevel?: () => number | null;
  /** Pixel size of the (square) orb canvas. Defaults to filling the parent. */
  size?: number;
  /**
   * Bump this (e.g. the active theme id) to force a re-read of --q-* tokens.
   * Not required — the orb also re-reads on mount and via a MutationObserver on
   * <html>, but a key makes theme switches instant + deterministic.
   */
  themeKey?: string;
  className?: string;
  style?: React.CSSProperties;
}

// ---- shaders (ported verbatim from the prototypes) -----------------------

const VERT = `
uniform float uTime, uAudio, uAmp, uFreq, uExpand;
varying float vN; varying vec3 vNormal, vView;
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod(i,289.0);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
void main(){
  float t=uTime*0.45;
  float amp=uAmp+uAudio*0.85;
  float n=snoise(normal*uFreq + vec3(t)) ;
  n+=0.5*snoise(normal*uFreq*2.3 + vec3(t*1.4));
  float disp=n*amp;
  vN=n;
  vec3 pos=position+normal*disp;
  // WI-5.1: trim the audio-driven geometry expansion (0.12→0.10) so the loud
  // speaking peaks don't push the mesh past the pane frame. uExpand term kept.
  pos*=1.0+uExpand*0.18+uAudio*0.10;
  vNormal=normalize(normalMatrix*normal);
  vec4 mv=modelViewMatrix*vec4(pos,1.0);
  vView=normalize(-mv.xyz);
  gl_Position=projectionMatrix*mv;
}`;

// Two frag variants: dark (fresnel*0.7, audio*0.28) and light (fresnel*1.5,
// audio*0.5) — exactly as tuned in voice-orb.html / voice-orb-quietlight.html.
const FRAG = (fresnel: number, audioMix: number) => `
precision highp float;
uniform vec3 uColA, uColB; uniform float uAudio;
varying float vN; varying vec3 vNormal, vView;
void main(){
  float fres=pow(1.0-max(dot(normalize(vView),normalize(vNormal)),0.0),2.3);
  vec3 base=mix(uColA,uColB,smoothstep(-0.6,0.8,vN));
  vec3 col=base+uColB*fres*${fresnel.toFixed(2)};
  col+=uColB*uAudio*${audioMix.toFixed(2)};
  gl_FragColor=vec4(col,1.0);
}`;

// ---- per-state targets (carried over from the prototypes) ----------------
// Note: listening is intentionally calm (not a flare); speaking is the flare.
// `expandLight` is the lower light-theme listening expansion.

interface StateTarget {
  amp: number;
  freq: number;
  expand: number;
  expandLight?: number;
  rot: number;
  /** which theme accent role drives this state's glow color */
  role: "accent" | "speak" | "think" | "record" | "dim";
}

const TARGETS: Record<VoiceOrbState, StateTarget> = {
  idle: { amp: 0.07, freq: 1.4, expand: 0.0, rot: 0.08, role: "dim" },
  // Listening is calm at rest but voice-reactive: a slightly higher base amp +
  // expansion than the prototype so the mic-driven uAudio motion is clearly
  // visible. Kept well under `speaking` (amp 0.155 / expand 0.34) and within the
  // pane frame (the audio-driven geometry term is uAudio*0.10; see VERT).
  listening: { amp: 0.15, freq: 1.9, expand: 0.27, expandLight: 0.16, rot: 0.18, role: "accent" },
  // Recording = listening pinned open by the user: same mic-reactive feel but a
  // warmer/red accent (--q-error role) and a slightly stronger base pulse so
  // it's unmistakably "armed". Still under the speaking flare's envelope.
  recording: { amp: 0.165, freq: 2.0, expand: 0.3, expandLight: 0.18, rot: 0.2, role: "record" },
  thinking: { amp: 0.1, freq: 2.8, expand: 0.12, rot: 0.55, role: "think" },
  // WI-5.1: speaking is the flare. Reined in ~12-15% from the prototype values
  // (amp 0.18→0.155, expand 0.40→0.34) so the bloom + geometry expansion stay
  // inside the pane frame while keeping the dramatic look.
  speaking: { amp: 0.155, freq: 2.2, expand: 0.34, rot: 0.22, role: "speak" },
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Darken a color toward black to make the noise-trough base ("uColA"). */
function darkBase(c: THREE.Color, isLight: boolean): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // In light themes the prototype bases are dim mid-tones; in dark themes they
  // are near-black with a hint of the hue.
  const l = isLight ? Math.min(0.18, hsl.l * 0.45) : Math.max(0.04, hsl.l * 0.16);
  const s = isLight ? hsl.s * 0.7 : hsl.s * 0.85;
  return new THREE.Color().setHSL(hsl.h, s, l);
}

export default function VoiceOrb({
  state,
  analyser,
  level,
  getLevel,
  size,
  themeKey,
  className,
  style,
}: VoiceOrbProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  // Light/dark recipe for the mount-div backing AND the WebGL scene. In DARK
  // themes the scene's background is painted opaque (matching --q-bg) and covers
  // the mount div, so we let the mount div be the plain app background (no purple
  // tint). In LIGHT themes the renderer is transparent over this div, so the neon
  // orb needs a dark "well" here to stay legible.
  //
  // This is the only STRUCTURAL signal: it determines renderer alpha, scene bg,
  // fresnel/audioMix, bloom params and the mount-div backing. The heavy build
  // effect is keyed on it so that only a light<->dark FLIP rebuilds the scene;
  // same-type theme switches refresh colors live via applyTokens() (see the
  // themeKey effect below). Initialised from the current theme; updated on every
  // themeKey change so a type flip triggers exactly one rebuild.
  const [isLight, setIsLight] = useState<boolean>(() =>
    typeof document !== "undefined" ? readOrbTheme().isLight : false
  );

  // Live refs so the rAF loop reads current props without restarting WebGL.
  const stateRef = useRef(state);
  const analyserRef = useRef(analyser);
  const levelRef = useRef(level);
  const getLevelRef = useRef(getLevel);
  const themeReadRef = useRef<() => void>(() => {});
  stateRef.current = state;
  analyserRef.current = analyser;
  levelRef.current = level;
  getLevelRef.current = getLevel;

  // On every theme change: refresh the orb's colors LIVE (applyTokens, via
  // themeReadRef) WITHOUT tearing down the WebGL scene. This is the user-reported
  // live-reload fix and must always run on a theme switch.
  //
  // Separately, detect a structural light<->dark FLIP and push it into `isLight`
  // state. That (and only that) re-runs the heavy build effect to rebuild the
  // scene with the other recipe. Same-type switches (dark->dark / light->light)
  // leave `isLight` unchanged, so no rebuild happens — colors still update above.
  useEffect(() => {
    themeReadRef.current();
    const nextIsLight = readOrbTheme().isLight;
    setIsLight((prev) => (prev === nextIsLight ? prev : nextIsLight));
  }, [themeKey]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const tokens0 = readOrbTheme();
    // `isLight` is the structural recipe from component state (a dep of this
    // effect), so a light<->dark flip rebuilds with the correct recipe. Color
    // roles below are still read fresh from tokens0 and stay live via applyTokens.

    const W = () => (size ?? mount.clientWidth) || 320;
    const H = () => (size ?? mount.clientHeight) || 320;

    // Light recipe: transparent renderer over a CSS dark "well"; bloom the
    // orb's COLORED output. Dark recipe: opaque scene background.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    if (isLight) renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    if (!isLight) {
      // Dark theme: paint the scene with the theme bg so the well matches.
      const bg = new THREE.Color();
      try {
        bg.set(tokens0.bg);
      } catch {
        bg.set("#0A0A0A");
      }
      scene.background = bg;
    }

    const camera = new THREE.PerspectiveCamera(45, W() / H(), 0.1, 100);
    // Slightly further back than the fullscreen prototypes (z=4.2) so the orb
    // reads as a contained centerpiece inside a square pane with a visible well.
    camera.position.z = 4.9;

    // Color roles, derived from theme tokens.
    const accentB = new THREE.Color(tokens0.accent);
    const speakB = new THREE.Color(tokens0.speakAccent);
    const thinkB = new THREE.Color(tokens0.thinkAccent);
    const recordB = new THREE.Color(tokens0.recordAccent);

    const colors = {
      accent: { a: darkBase(accentB, isLight), b: accentB.clone() },
      speak: { a: darkBase(speakB, isLight), b: speakB.clone() },
      think: { a: darkBase(thinkB, isLight), b: thinkB.clone() },
      record: { a: darkBase(recordB, isLight), b: recordB.clone() },
      dim: { a: darkBase(accentB, isLight), b: accentB.clone().multiplyScalar(isLight ? 0.7 : 0.55) },
    };

    const uniforms = {
      uTime: { value: 0 },
      uAudio: { value: 0 },
      uAmp: { value: 0.12 },
      uFreq: { value: 1.6 },
      uColA: { value: colors.accent.a.clone() },
      uColB: { value: colors.accent.b.clone() },
      uExpand: { value: 0 },
    };

    const fresnel = isLight ? 1.5 : 0.7;
    const audioMix = isLight ? 0.5 : 0.28;

    const geo = new THREE.IcosahedronGeometry(1.2, 48);
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG(fresnel, audioMix),
    });
    const orb = new THREE.Mesh(geo, mat);
    scene.add(orb);

    // Faint particle halo / starfield. The orb canvas now fills the full pane
    // width (not a square), so the field is spread WIDER and denser than the
    // original tight halo: a larger radius range reaches the horizontal edges of
    // a wide pane (so there's dust edge-to-edge, no dark voids beside the orb),
    // and the X coordinate is stretched 1.6× so the scatter follows the pane's
    // landscape aspect rather than pooling in a circle around the sphere.
    const N = 1500;
    const pg = new THREE.BufferGeometry();
    const pp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 1.7 + Math.random() * 2.7;
      const th = Math.acos(2 * Math.random() - 1);
      const ph = Math.random() * 6.283;
      pp[i * 3] = r * Math.sin(th) * Math.cos(ph) * 1.6;
      pp[i * 3 + 1] = r * Math.sin(th) * Math.sin(ph);
      pp[i * 3 + 2] = r * Math.cos(th);
    }
    pg.setAttribute("position", new THREE.BufferAttribute(pp, 3));
    const pmat = new THREE.PointsMaterial({
      color: accentB.clone(),
      size: isLight ? 0.02 : 0.018,
      transparent: true,
      opacity: isLight ? 0.55 : 0.5,
    });
    const halo = new THREE.Points(pg, pmat);
    scene.add(halo);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Light: stronger bloom, threshold 0 (bloom the colored orb, never white).
    // Dark: gentler bloom with a threshold.
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(W(), H()),
      isLight ? 0.85 : 0.5,
      isLight ? 0.62 : 0.5,
      isLight ? 0.0 : 0.32
    );
    composer.addPass(bloom);

    // ---- theme re-read (used on themeKey change + MutationObserver) ----
    const target = {
      col: colors.accent,
      halo: colors.accent.b.clone(),
    };
    const applyTokens = () => {
      const t = readOrbTheme();
      // Only color roles are re-read live; the light/dark structural recipe is
      // fixed at mount (it determines renderer alpha / scene bg). A full theme
      // type flip remounts via themeKey in practice.
      colors.accent.b.set(t.accent);
      colors.accent.a.copy(darkBase(colors.accent.b, isLight));
      colors.speak.b.set(t.speakAccent);
      colors.speak.a.copy(darkBase(colors.speak.b, isLight));
      colors.think.b.set(t.thinkAccent);
      colors.think.a.copy(darkBase(colors.think.b, isLight));
      colors.record.b.set(t.recordAccent);
      colors.record.a.copy(darkBase(colors.record.b, isLight));
      colors.dim.b.copy(new THREE.Color(t.accent).multiplyScalar(isLight ? 0.7 : 0.55));
      colors.dim.a.copy(darkBase(new THREE.Color(t.accent), isLight));
    };
    themeReadRef.current = applyTokens;

    const obs = new MutationObserver(() => applyTokens());
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme-type"],
    });

    // ---- audio level ----
    let audioData: Uint8Array | null = null;
    const micLevel = (): number | null => {
      const an = analyserRef.current;
      if (!an) return null;
      if (!audioData || audioData.length !== an.frequencyBinCount) {
        audioData = new Uint8Array(an.frequencyBinCount);
      }
      an.getByteFrequencyData(audioData);
      let s = 0;
      for (let i = 0; i < audioData.length; i++) s += audioData[i];
      return Math.min(1, s / audioData.length / 90);
    };

    // ---- loop ----
    const clock = new THREE.Clock();
    let audioS = 0;
    let raf = 0;
    const tick = () => {
      const dt = clock.getDelta();
      const t = clock.elapsedTime;
      const s = stateRef.current;
      const tg = TARGETS[s];

      // Resolve the active color role.
      const roleCol =
        tg.role === "speak"
          ? colors.speak
          : tg.role === "think"
          ? colors.think
          : tg.role === "record"
          ? colors.record
          : tg.role === "dim"
          ? colors.dim
          : colors.accent;
      target.col = roleCol;
      target.halo = roleCol.b;

      // amp/expand: use the light-tuned listening expansion in light themes.
      const expand = isLight && tg.expandLight !== undefined ? tg.expandLight : tg.expand;

      // audio source: a per-frame getLevel() callback wins (most robust), then
      // a static level prop, then the analyser; null → simulated envelope.
      let raw: number;
      let providedRaw: number | null = null;
      const fn = getLevelRef.current;
      if (fn) {
        providedRaw = fn();
      } else if (levelRef.current !== undefined && levelRef.current !== null) {
        providedRaw = levelRef.current;
      } else {
        providedRaw = micLevel();
      }
      const provided =
        providedRaw === null ? null : Math.max(0, Math.min(1, providedRaw));
      // True only when a real live level (mic/output) is driving the orb. The
      // simulated/fallback path (harness, idle, thinking, missing getLevel) keeps
      // the original symmetric smoothing so its visual baselines are unchanged.
      const driven =
        provided !== null && (s === "listening" || s === "recording" || s === "speaking");
      if (driven) {
        raw = provided as number;
      } else if (s === "speaking") {
        raw = 0.45 + 0.4 * Math.abs(Math.sin(t * 7.0)) * Math.abs(Math.sin(t * 2.3));
      } else if (s === "thinking") {
        raw = 0.12 + 0.12 * Math.sin(t * 9.0);
      } else if (s === "listening") {
        raw = isLight
          ? 0.07 + 0.08 * Math.abs(Math.sin(t * 3.1))
          : 0.18 + 0.16 * Math.abs(Math.sin(t * 3.1));
      } else if (s === "recording") {
        // Fallback envelope (harness/no mic): like listening, a touch stronger.
        raw = isLight
          ? 0.1 + 0.1 * Math.abs(Math.sin(t * 3.4))
          : 0.22 + 0.18 * Math.abs(Math.sin(t * 3.4));
      } else {
        raw = 0.04 + 0.03 * Math.sin(t * 1.2);
      }

      // Smoothing. For a live-driven level (real mic/output), use ASYMMETRIC
      // smoothing: a fast attack so the orb snaps up the instant the user speaks,
      // and a slower release so it settles back without flickering on the gaps
      // between syllables. Frame-rate-normalised against a 60fps baseline so the
      // feel is consistent regardless of refresh rate (and never overshoots: the
      // per-frame factor is clamped to ≤1). The simulated/fallback path keeps the
      // original symmetric lerp(…, 0.12) so the harness baselines don't move.
      if (driven) {
        const ATTACK = 0.45; // per-60fps-frame rise toward a louder level
        const RELEASE = 0.16; // per-60fps-frame fall toward a quieter level
        const base = raw > audioS ? ATTACK : RELEASE;
        const k = Math.min(1, base * dt * 60);
        audioS = lerp(audioS, raw, k);
      } else {
        audioS = lerp(audioS, raw, 0.12);
      }
      uniforms.uAudio.value = audioS;
      uniforms.uAmp.value = lerp(uniforms.uAmp.value, tg.amp, 0.05);
      uniforms.uFreq.value = lerp(uniforms.uFreq.value, tg.freq, 0.05);
      uniforms.uExpand.value = lerp(uniforms.uExpand.value, expand, 0.05);
      uniforms.uColA.value.lerp(target.col.a, 0.06);
      uniforms.uColB.value.lerp(target.col.b, 0.06);
      pmat.color.lerp(target.halo, 0.06);
      pmat.opacity = 0.22 + audioS * 0.35;

      // WI-5.1: dial back the audio-driven bloom strength ~12% (light 1.15→1.0,
      // dark 0.7→0.6) so the speaking flare's bloom no longer overflows the
      // pane frame. Idle/listening base strength is unchanged.
      const bloomBase = isLight ? 0.4 + audioS * 1.0 : 0.32 + audioS * 0.6;
      bloom.strength = lerp(bloom.strength, bloomBase, 0.08);

      uniforms.uTime.value = t;
      orb.rotation.y += dt * tg.rot;
      orb.rotation.x += dt * tg.rot * 0.35;
      halo.rotation.y -= dt * tg.rot * 0.5;
      halo.scale.setScalar(1 + audioS * 0.18 + uniforms.uExpand.value * 0.1);

      composer.render();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // ---- resize ----
    const onResize = () => {
      const w = W();
      const h = H();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      obs.disconnect();
      window.removeEventListener("resize", onResize);
      composer.dispose();
      geo.dispose();
      mat.dispose();
      pg.dispose();
      pmat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      themeReadRef.current = () => {};
    };
    // Rebuild only when the structural recipe could change: the canvas `size`
    // or a light<->dark flip (`isLight`). A SAME-type theme switch does NOT land
    // here — it refreshes colors live via the themeKey effect + applyTokens().
    // State/analyser/level are read live via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, isLight]);

  return (
    <div
      ref={mountRef}
      className={className}
      style={{
        width: size ?? "100%",
        height: size ?? "100%",
        // Backing for the orb. DARK themes: the opaque scene background (painted
        // to --q-bg) covers this div, so use the plain app bg here too — no
        // purple tint. LIGHT themes: the renderer is transparent over this div,
        // so keep a dark "well" gradient (neon needs a dark stage to read).
        background: isLight
          ? "radial-gradient(circle at 50% 47%, #140e22 0%, #15121f 22%, #0c0a14 55%, #07060c 100%)"
          : "var(--q-bg)",
        borderRadius: "inherit",
        overflow: "hidden",
        ...style,
      }}
    />
  );
}
