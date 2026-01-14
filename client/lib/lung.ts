// Lung sound synthesis utilities (ported and adapted from provided Python)
// Generates: normal breath, fine/coarse crackles overlay, rhythmic wheeze, with environment noise

export type BreathParams = {
  fs?: number;
  nCycles?: number;
  seed?: number;
  // breath cycle ranges
  insp_amp_range?: [number, number];
  exp_amp_range?: [number, number];
  insp_dur_range?: [number, number];
  exp_dur_range?: [number, number];
  mid_gap_range?: [number, number];
  post_pause_range?: [number, number];
  insp_band?: [number, number];
  exp_band?: [number, number];
  band_jitter_hz?: [number, number];
  jitter_amp?: number;
  crossfade_s?: number;
};

// ------------------------------------- helpers -------------------------------------
function rng(seed?: number) {
  if (seed == null) return Math.random;
  let s = (seed >>> 0) || 1;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function raisedCosine(n: number) {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * (1 - Math.cos((Math.PI * i) / n));
  return out;
}

// simple IIR one-pole filters, cascaded to approximate bandpass
function onepoleLP(x: number[], fc: number, fs: number) {
  if (fc <= 0) return x.slice();
  const a = Math.exp((-2 * Math.PI * fc) / fs);
  const y = new Array<number>(x.length).fill(0);
  for (let i = 1; i < x.length; i++) y[i] = a * y[i - 1] + (1 - a) * x[i];
  return y;
}
function onepoleHP(x: number[], fc: number, fs: number) {
  if (fc <= 0) return x.slice();
  const low = onepoleLP(x, fc, fs);
  const y = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] - low[i];
  return y;
}
function bandpassSafe(x: number[], fs: number, lo: number, hi: number, order = 4) {
  const hiClamped = Math.min(hi, 0.49 * fs);
  let y = x.slice();
  // cascade lowpass and highpass to mimic higher order
  for (let k = 0; k < order / 2; k++) y = onepoleLP(y, hiClamped, fs);
  for (let k = 0; k < order / 2; k++) y = onepoleHP(y, lo, fs);
  return y;
}

// -------------------------------- breath synthesis ---------------------------------
function oneCycleRandom(params: Required<BreathParams> & { rand: () => number }) {
  const {
    fs, insp_amp_range, exp_amp_range, insp_dur_range, exp_dur_range,
    mid_gap_range, post_pause_range, insp_band, exp_band, band_jitter_hz,
    jitter_amp, crossfade_s, rand
  } = params;

  const insp_amp = lerpRand(rand, insp_amp_range);
  const exp_amp = lerpRand(rand, exp_amp_range);
  const insp_dur = lerpRand(rand, insp_dur_range);
  const exp_dur = lerpRand(rand, exp_dur_range);
  const mid_gap = lerpRand(rand, mid_gap_range);
  const post_pause = lerpRand(rand, post_pause_range);

  const band_insp: [number, number] = [
    Math.max(10, insp_band[0] + lerpRand(rand, band_jitter_hz)),
    Math.min(fs / 2 - 50, insp_band[1] + lerpRand(rand, band_jitter_hz)),
  ];
  const band_exp: [number, number] = [
    Math.max(10, exp_band[0] + lerpRand(rand, band_jitter_hz)),
    Math.min(fs / 2 - 50, exp_band[1] + lerpRand(rand, band_jitter_hz)),
  ];

  const n_insp = Math.round(fs * insp_dur);
  const n_mid = Math.round(fs * mid_gap);
  const n_exp = Math.round(fs * exp_dur);
  const n_pause = Math.round(fs * post_pause);
  const N = n_insp + n_mid + n_exp + n_pause;

  const t = new Array<number>(N);
  for (let i = 0; i < N; i++) t[i] = i / fs;

  // base noise + slow amplitude drift
  const x = new Array<number>(N).fill(0).map(() => gaussian(rand));
  const slow = new Array<number>(N);
  for (let i = 0; i < N; i++) slow[i] = 1 + params.jitter_amp * Math.sin((2 * Math.PI * 0.4 * i) / fs);
  for (let i = 0; i < N; i++) x[i] *= slow[i];

  // envelopes
  const env = new Array<number>(N).fill(0);
  const inspHalf = raisedCosine(Math.max(1, Math.floor(n_insp / 2)));
  let insp_env = inspHalf.concat(inspHalf.slice().reverse());
  if (insp_env.length < n_insp) insp_env = insp_env.concat(new Array(n_insp - insp_env.length).fill(0));
  const inspMax = Math.max(...insp_env, 1e-9);
  for (let i = 0; i < n_insp; i++) env[i] = insp_amp * (insp_env[i] / inspMax);

  const expHalf = raisedCosine(Math.max(1, Math.floor(n_exp / 2)));
  let exp_env = expHalf.concat(expHalf.slice().reverse());
  if (exp_env.length < n_exp) exp_env = exp_env.concat(new Array(n_exp - exp_env.length).fill(0));
  const expStart = n_insp + n_mid;
  const expMax = Math.max(...exp_env, 1e-9);
  for (let i = 0; i < n_exp; i++) env[expStart + i] = exp_amp * (exp_env[i] / expMax);

  // band selection + crossfade
  const x_insp = bandpassSafe(x, fs, band_insp[0], band_insp[1]);
  const x_exp = bandpassSafe(x, fs, band_exp[0], band_exp[1]);

  const w = new Array<number>(N).fill(0);
  for (let i = 0; i < n_insp; i++) w[i] = 1;
  const cross = Math.round(crossfade_s * fs);
  const i1 = Math.max(0, n_insp - cross), i2 = Math.min(N, n_insp + cross);
  if (i2 > i1) {
    for (let i = i1; i < i2; i++) w[i] = 1 - (i - i1) / (i2 - i1);
  }

  const y = new Array<number>(N);
  for (let i = 0; i < N; i++) y[i] = (w[i] * x_insp[i] + (1 - w[i]) * x_exp[i]) * env[i];

  // normalize
  const peak = Math.max(...y.map((v) => Math.abs(v)), 1e-9);
  for (let i = 0; i < N; i++) y[i] = (0.95 * y[i]) / peak;

  return { y, t, env, params: { band_insp, band_exp, insp_amp, exp_amp, insp_dur, exp_dur } };
}

function lerpRand(rand: () => number, range: [number, number]) {
  return range[0] + rand() * (range[1] - range[0]);
}

export function synthBreathRandomCycles(p: BreathParams = {}) {
  const fs = p.fs ?? 1000;
  const nCycles = p.nCycles ?? 3;
  const rand = rng(p.seed);
  const base: Required<BreathParams> & { rand: () => number } = {
    fs,
    nCycles,
    seed: p.seed ?? 0,
    insp_amp_range: p.insp_amp_range ?? [0.9, 1.2],
    exp_amp_range: p.exp_amp_range ?? [0.8, 1.0],
    insp_dur_range: p.insp_dur_range ?? [1.6, 1.8],
    exp_dur_range: p.exp_dur_range ?? [1.8, 2.2],
    mid_gap_range: p.mid_gap_range ?? [0.2, 0.5],
    post_pause_range: p.post_pause_range ?? [1.8, 2.2],
    insp_band: p.insp_band ?? [120, 650],
    exp_band: p.exp_band ?? [100, 500],
    band_jitter_hz: p.band_jitter_hz ?? [-20, 40],
    jitter_amp: p.jitter_amp ?? 0.1,
    crossfade_s: p.crossfade_s ?? 0.08,
    rand,
  } as any;

  let y_all: number[] = [];
  let t_all: number[] = [];
  let env_all: number[] = [];
  let offset = 0;
  for (let i = 0; i < nCycles; i++) {
    const { y, t, env } = oneCycleRandom(base);
    y_all = y_all.concat(y);
    t_all = t_all.concat(t.map((v) => v + offset));
    env_all = env_all.concat(env);
    offset += y.length / fs;
  }
  return { y: y_all, t: t_all, env: env_all };
}

// ------------------------ noise and SNR ------------------------
function pinkNoise(N: number, rand: () => number) {
  const nRows = 16;
  const acc = new Array<number>(N).fill(0);
  for (let r = 0; r < nRows; r++) {
    let v = 0;
    for (let i = 0; i < N; i++) {
      v += rand() - 0.5;
      acc[i] += (1 / (1 << r)) * v;
    }
  }
  const maxAbs = Math.max(...acc.map((x) => Math.abs(x)), 1e-9);
  return acc.map((x) => x / maxAbs);
}

export function makeEnvNoise(fs: number, duration: number, seed = 2025, mix: [number, number] = [0.2, 0.8], band: [number, number] = [300, 800]) {
  const rand = rng(seed);
  const N = Math.max(1, Math.round(duration * fs));
  const pn = pinkNoise(N, rand);
  const nb = bandpassSafe(new Array<number>(N).fill(0).map(() => gaussian(rand)), fs, band[0], band[1]);
  const maxNb = Math.max(...nb.map((x) => Math.abs(x)), 1e-9);
  for (let i = 0; i < nb.length; i++) nb[i] = nb[i] / maxNb;
  const out = new Array<number>(N);
  for (let i = 0; i < N; i++) out[i] = mix[0] * pn[i] + mix[1] * nb[i];
  const maxAbs = Math.max(...out.map((x) => Math.abs(x)), 1e-9);
  for (let i = 0; i < N; i++) out[i] = out[i] / maxAbs;
  return out;
}

export function addNoiseSNR(sig: number[], fs: number, snrDb = 15, seed = 2025, mix: [number, number] = [0.2, 0.8], band: [number, number] = [300, 800]) {
  const noise = makeEnvNoise(fs, sig.length / fs, seed, mix, band);
  const sigPower = rms(sig);
  const noisePower = rms(noise);
  const scale = Math.sqrt((sigPower / Math.pow(10, snrDb / 10)) / (noisePower || 1));
  const y = new Array<number>(sig.length);
  for (let i = 0; i < sig.length; i++) y[i] = sig[i] + scale * noise[i];
  const peak = Math.max(...y.map((v) => Math.abs(v)), 1e-9);
  for (let i = 0; i < y.length; i++) y[i] = (0.95 * y[i]) / peak;
  return y;
}
function rms(arr: number[]) { return arr.reduce((s, v) => s + v * v, 0) / Math.max(1, arr.length); }

// ------------------------ crackles ------------------------
export function crackleKernel(fs: number, kind: "fine" | "coarse", rand = rng()) {
  const durMs = kind === "fine" ? lerp(6, 12, rand()) : lerp(14, 30, rand());
  const f0 = kind === "fine" ? lerp(450, 900, rand()) : lerp(180, 350, rand());
  const tauMs = durMs / (kind === "fine" ? lerp(2.0, 3.0, rand()) : lerp(2.2, 3.5, rand()));
  const N = Math.max(6, Math.round((fs * durMs) / 1000));
  const k = new Array<number>(N);
  const phi = lerp(-Math.PI / 4, Math.PI / 4, rand());
  for (let i = 0; i < N; i++) {
    const t = i / fs;
    k[i] = Math.exp(-t / (tauMs / 1000)) * Math.sin(2 * Math.PI * f0 * t + phi);
  }
  if (N >= 3) { k[0] *= 0.2; k[1] *= 0.6; }
  // band-limit and normalize
  let y = bandpassSafe(k, fs, 150, Math.min(1800, 0.49 * fs));
  const maxAbs = Math.max(...y.map((v) => Math.abs(v)), 1e-9);
  y = y.map((v) => v / maxAbs);
  return y;
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

export function overlayCrackles(y: number[], env: number[], fs: number, profile: "fine" | "coarse") {
  const out = y.slice();
  const events: { sample: number; time: number; amp: number; kind: string }[] = [];
  const N = y.length;
  const rnd = rng(77);

  const cfg = profile === "fine"
    ? { rateHz: 7.0, amp: [0.35, 0.65] as [number, number], burstProb: 0.28, burstK: [1, 2] as [number, number], fineRatio: 0.9, refractoryMs: 18, bias: "insp_late" as const }
    : { rateHz: 4.2, amp: [0.55, 0.75] as [number, number], burstProb: 0.55, burstK: [2, 5] as [number, number], fineRatio: 0.25, refractoryMs: 30, bias: "exp_early" as const };

  // phase bias from env
  let w = new Array<number>(N).fill(1);
  const eMax = Math.max(...env, 0);
  if (eMax > 0) {
    const e = env.map((v) => v / eMax);
    const mid = Math.floor(e.length / 2);
    if (cfg.bias === "insp_late") {
      const late = new Array<number>(e.length).fill(0);
      for (let i = Math.floor(mid / 2); i < mid; i++) late[i] = 1;
      w = e.map((v, i) => 0.25 + 0.75 * (0.5 * v + 0.5 * late[i]));
    } else {
      const early = new Array<number>(e.length).fill(0);
      for (let i = mid; i < mid + Math.floor((e.length - mid) / 2); i++) early[i] = 1;
      w = e.map((v, i) => 0.25 + 0.75 * (0.5 * v + 0.5 * early[i]));
    }
    const wm = Math.max(...w, 1e-9);
    w = w.map((v) => v / wm);
  }

  const p: number[] = new Array(N);
  for (let i = 0; i < N; i++) p[i] = (cfg.rateHz / fs) * w[i];
  const refractory = Math.round((cfg.refractoryMs * fs) / 1000);
  let lastPlaced = -refractory;

  // pre-generate kernels
  const Kfine = new Array(16).fill(0).map(() => crackleKernel(fs, "fine", rnd));
  const Kcoarse = new Array(16).fill(0).map(() => crackleKernel(fs, "coarse", rnd));

  let i = 0;
  while (i < N) {
    if (i - lastPlaced < refractory) { i++; continue; }
    if (rnd() < p[i]) {
      const pickFine = rnd() < cfg.fineRatio;
      const ker = pickFine ? Kfine[(Math.floor(rnd() * Kfine.length))] : Kcoarse[(Math.floor(rnd() * Kcoarse.length))];
      const amp = lerp(cfg.amp[0], cfg.amp[1], rnd());
      const j0 = i; const j1 = Math.min(N, j0 + ker.length);
      for (let k = 0; k < j1 - j0; k++) out[j0 + k] += amp * ker[k];
      events.push({ sample: j0, time: j0 / fs, amp, kind: pickFine ? "fine" : "coarse" });
      lastPlaced = i;
      if (rnd() < cfg.burstProb) {
        const addn = Math.floor(lerp(cfg.burstK[0], cfg.burstK[1] + 1, rnd()));
        let pos = j1;
        for (let b = 0; b < addn; b++) {
          const gap = lerp(0.015, 0.08, rnd());
          pos = Math.min(N - 1, Math.floor(pos + gap * fs));
          const ker2 = (rnd() < cfg.fineRatio ? Kfine : Kcoarse)[Math.floor(rnd() * 16)];
          const amp2 = clamp((amp * 0.85 + 0.08 * gaussian(rnd)), 0.2, 0.98);
          const k1 = Math.min(N, pos + ker2.length);
          for (let k = 0; k < k1 - pos; k++) out[pos + k] += amp2 * ker2[k];
          events.push({ sample: pos, time: pos / fs, amp: amp2, kind: "burst" });
        }
        lastPlaced = pos;
      }
      i += Math.round(0.008 * fs);
    } else {
      i++;
    }
  }
  const peak = Math.max(...out.map((v) => Math.abs(v)), 1e-9);
  for (let k = 0; k < out.length; k++) out[k] = (0.98 * out[k]) / peak;
  return { y: out, events };
}
function clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, x)); }

// ------------------------ wheeze synthesis ------------------------
function smoothRand(N: number, fs: number, tauS = 0.25, rand = rng()) {
  const a = 1.0 / Math.max(2, Math.round(tauS * fs));
  const y = new Array<number>(N);
  let val = 0;
  for (let n = 0; n < N; n++) { val = (1 - a) * val + a * (2 * rand() - 1); y[n] = val; }
  const maxAbs = Math.max(...y.map((v) => Math.abs(v)), 1e-9);
  return y.map((v) => v / maxAbs);
}
function gateFromEnv(env: number[], fs: number, thr = 0.12, releaseMs = 120, attackMs = 40) {
  const eMax = Math.max(...env, 1e-9);
  const e = env.map((v) => v / eMax);
  const att = Math.max(1, Math.round((attackMs * fs) / 1000));
  const rel = Math.max(1, Math.round((releaseMs * fs) / 1000));
  const g = new Array<number>(e.length);
  let state = 0;
  for (let i = 0; i < e.length; i++) {
    const target = e[i] >= thr ? 1 : 0;
    const k = target > state ? 1 / att : 1 / rel;
    state = state + k * (target - state);
    g[i] = state;
  }
  return g;
}

export function synthWheezeRhythmic(t: number[], env: number[], fs: number, opts: {
  f0_range?: [number, number]; per_cycle_glide?: [number, number]; n_harm_choices?: [number, number]; harmonic_decay?: number; fm_dev_hz?: [number, number]; fm_tau?: [number, number]; am_depth?: [number, number]; am_tau?: [number, number]; gate_thr?: number; gate_attack_ms?: number; gate_release_ms?: number; exp_bias?: number; amp_scale?: number; seed?: number;
} = {}) {
  const cfg = {
    f0_range: opts.f0_range ?? [400, 800] as [number, number],
    per_cycle_glide: opts.per_cycle_glide ?? [-180, 60] as [number, number],
    n_harm_choices: opts.n_harm_choices ?? [2, 3] as [number, number],
    harmonic_decay: opts.harmonic_decay ?? 0.55,
    fm_dev_hz: opts.fm_dev_hz ?? [6, 18] as [number, number],
    fm_tau: opts.fm_tau ?? [0.15, 0.35] as [number, number],
    am_depth: opts.am_depth ?? [0.2, 0.45] as [number, number],
    am_tau: opts.am_tau ?? [0.2, 0.5] as [number, number],
    gate_thr: opts.gate_thr ?? 0.1,
    gate_attack_ms: opts.gate_attack_ms ?? 40,
    gate_release_ms: opts.gate_release_ms ?? 160,
    exp_bias: opts.exp_bias ?? 0.75,
    amp_scale: opts.amp_scale ?? 0.28,
    seed: opts.seed ?? 0,
  };
  const rand = rng(cfg.seed);
  const N = t.length; const wz = new Array<number>(N).fill(0);
  const e = env.slice();
  const eMax = Math.max(...e, 1e-9); for (let i = 0; i < e.length; i++) e[i] /= eMax;
  // cycle boundaries by low-energy gaps
  const low = e.map((v) => (v < 0.04 ? 1 : 0));
  const gaps: number[] = [];
  for (let i = 1; i < low.length; i++) if (low[i - 1] === 1 && low[i] === 0) gaps.push(i);
  if (gaps.length < 2) { gaps.splice(0, gaps.length, 0, Math.floor(N / 2), N - 1); }

  const fmTau = lerp(cfg.fm_tau[0], cfg.fm_tau[1], rand());
  const amTau = lerp(cfg.am_tau[0], cfg.am_tau[1], rand());
  const fm = smoothRand(N, fs, fmTau, rand).map((v) => v * lerp(cfg.fm_dev_hz[0], cfg.fm_dev_hz[1], rand()));
  const am = smoothRand(N, fs, amTau, rand).map((v) => 1 + v * lerp(cfg.am_depth[0], cfg.am_depth[1], rand()));

  let phi = 0;
  for (let k = 0; k < gaps.length - 1; k++) {
    const i0 = gaps[k], i1 = gaps[k + 1]; if (i1 <= i0 + 5) continue;
    const f0 = lerp(cfg.f0_range[0], cfg.f0_range[1], rand());
    const glide = lerp(cfg.per_cycle_glide[0], cfg.per_cycle_glide[1], rand());
    const nh = Math.floor(lerp(cfg.n_harm_choices[0], cfg.n_harm_choices[1] + 1, rand()));
    const mid = Math.floor((i0 + i1) / 2);
    const gate = gateFromEnv(e.slice(i0, i1), fs, cfg.gate_thr, cfg.gate_release_ms, cfg.gate_attack_ms);
    const phaseBias = new Array<number>(i1 - i0).fill(1);
    for (let i = 0; i < phaseBias.length; i++) if (i < mid - i0) phaseBias[i] *= 1 - cfg.exp_bias;
    const ampEnv = normalize(gate.map((v, i) => v * phaseBias[i]));

    const Nseg = i1 - i0; const y = new Array<number>(Nseg).fill(0);
    const f0lin = new Array<number>(Nseg);
    for (let i = 0; i < Nseg; i++) f0lin[i] = f0 + (glide * i) / Math.max(1, Nseg - 1);
    const fInst = new Array<number>(Nseg);
    for (let i = 0; i < Nseg; i++) fInst[i] = Math.max(30, f0lin[i] + fm[i0 + i]);
    const phiSeg = new Array<number>(Nseg);
    for (let i = 0; i < Nseg; i++) { phi += (2 * Math.PI * fInst[i]) / fs; phiSeg[i] = phi; }
    for (let h = 1; h <= nh; h++) {
      const gain = Math.pow(cfg.harmonic_decay, h - 1);
      for (let i = 0; i < Nseg; i++) y[i] += gain * Math.sin(h * phiSeg[i]);
    }
    for (let i = 0; i < Nseg; i++) wz[i0 + i] += cfg.amp_scale * am[i0 + i] * ampEnv[i] * y[i];
  }
  const peak = Math.max(...wz.map((v) => Math.abs(v)), 1e-9);
  for (let i = 0; i < wz.length; i++) wz[i] = (0.95 * wz[i]) / peak;
  return wz;
}
function normalize(arr: number[]) { const m = Math.max(...arr, 1e-9); return arr.map((v) => v / m); }

// ------------------------ public entry points for UI ------------------------
export function genNormalLungSignal(count: number, cycles: number) {
  const fs = 1000; // match UI scale
  const base = synthBreathRandomCycles({ fs, nCycles: Math.max(1, Math.floor(cycles)), seed: 2025 });
  const y = addNoiseSNR(base.y, fs, 12, 2025, [0.2, 0.8], [80, 3000]);
  return resampleTo(y, count);
}
export function genFineCracklesSignal(count: number, cycles: number) {
  const fs = 1000;
  const base = synthBreathRandomCycles({ fs, nCycles: Math.max(1, Math.floor(cycles)), seed: 2026 });
  const over = overlayCrackles(base.y, base.env, fs, "fine").y;
  const y = addNoiseSNR(over, fs, 10, 2026, [0.2, 0.8], [100, 700]);
  return resampleTo(y, count);
}
export function genCoarseCracklesSignal(count: number, cycles: number) {
  const fs = 1000;
  const base = synthBreathRandomCycles({ fs, nCycles: Math.max(1, Math.floor(cycles)), seed: 2027 });
  const over = overlayCrackles(base.y, base.env, fs, "coarse").y;
  const y = addNoiseSNR(over, fs, 10, 2027, [0.2, 0.8], [100, 700]);
  return resampleTo(y, count);
}
export function genWheezeSignal(count: number, cycles: number) {
  const fs = 1000;
  const base = synthBreathRandomCycles({ fs, nCycles: Math.max(1, Math.floor(cycles)), seed: 2028 });
  const wz = synthWheezeRhythmic(base.t, base.env, fs, { f0_range: [420, 820], per_cycle_glide: [-200, 80], n_harm_choices: [2, 3], harmonic_decay: 0.6, fm_dev_hz: [8, 16], fm_tau: [0.18, 0.35], am_depth: [0.25, 0.45], am_tau: [0.25, 0.45], gate_thr: 0.1, exp_bias: 0.8, amp_scale: 0.32, seed: 9 });
  const mix = new Array<number>(base.y.length);
  for (let i = 0; i < mix.length; i++) mix[i] = base.y[i] + wz[i];
  const y = addNoiseSNR(mix, fs, 10, 2028, [0.2, 0.8], [100, 700]);
  return resampleTo(y, count);
}

function resampleTo(y: number[], count: number) {
  if (y.length === count) return y.slice();
  const out = new Array<number>(count);
  const n = y.length - 1;
  for (let i = 0; i < count; i++) {
    const idx = (i * n) / Math.max(1, count - 1);
    const i0 = Math.floor(idx), i1 = Math.min(n, i0 + 1);
    const w = idx - i0;
    out[i] = y[i0] * (1 - w) + y[i1] * w;
  }
  return out;
}
