// Fetal Phonocardiogram (fPCG) simulation utilities
// Ported from user's Python code to TypeScript for in-browser/local generation

export type UcEvent = { start: number; end: number; peak: number };
export type FpcgMeta = { movement_events: Array<[number, number]>; uc_events: UcEvent[] };

export type SimOptions = {
  num_samples?: number;
  cycles_per_sample?: number;
  fs?: number;
  fhr?: number; // fetal heart rate (bpm)
  mhr?: number; // maternal heart rate (bpm)
  snr_db?: number;
  // transmission
  r1?: number; c1?: number; beta1?: number; A1?: number;
  r2?: number; c2?: number; beta2?: number; A2?: number;
  // movement
  movement_enabled?: boolean;
  movement_intensity?: number;
  movement_rate_per_min?: number;
  movement_duration_range?: [number, number];
  movement_band?: [number, number];
  movement_thump_prob?: number;
  movement_seed?: number | null;
  // uterine contraction (UC)
  uc_enabled?: boolean;
  uc_rate_per_10min?: number;
  uc_duration_range?: [number, number];
  uc_rise_fall_frac?: [number, number];
  uc_attenuation?: number;
  uc_noise_band?: [number, number];
  uc_noise_intensity?: number;
  uc_seed?: number | null;
  // arrhythmia control (std of RR as fraction of mean)
  rr_std_frac?: number;
};

export type SimOutput = {
  t: number[];
  y: number[];
  meta: FpcgMeta;
};

// Utilities
function rngFactory(seed?: number | null) {
  if (seed == null) return Math.random;
  // Mulberry32
  let s = (seed >>> 0) || 123456789;
  return function() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function linspace(start: number, end: number, n: number) {
  const arr = new Array<number>(n);
  const step = (end - start) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) arr[i] = start + i * step;
  return arr;
}

function sinc(x: number) {
  if (x === 0) return 1;
  const pix = Math.PI * x;
  return Math.sin(pix) / pix;
}

// -----------------------------
// Heart sound kernel
// -----------------------------
function generate_heart_sound(center_freq: number, duration: number, fs: number, amplitude: number) {
  const n = Math.max(1, Math.floor(fs * duration));
  const t = linspace(-duration / 2, duration / 2, n);
  const signal = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = 2 * center_freq * t[i];
    signal[i] = amplitude * sinc(x);
  }
  return { t, signal };
}

// -----------------------------
// 1st-order filters
// -----------------------------
function onepole_lowpass(x: number[], fc: number, fs: number) {
  if (fc <= 0) return x.slice();
  const a = Math.exp((-2 * Math.PI * fc) / fs);
  const y = new Array<number>(x.length).fill(0);
  for (let i = 1; i < x.length; i++) y[i] = a * y[i - 1] + (1 - a) * x[i];
  return y;
}
function onepole_highpass(x: number[], fc: number, fs: number) {
  if (fc <= 0) return x.slice();
  const low = onepole_lowpass(x, fc, fs);
  const y = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] - low[i];
  return y;
}
function simple_bandpass(x: number[], f_lo: number, f_hi: number, fs: number) {
  let y = x;
  if (!(f_hi == null || f_hi >= fs / 2)) y = onepole_lowpass(y, f_hi, fs);
  if (!(f_lo == null || f_lo <= 0)) y = onepole_highpass(y, f_lo, fs);
  return y;
}

// -----------------------------
// Propagation kernel
// -----------------------------
function expo_conv_kernel(r: number, c: number, fs: number, beta: number, A = 1.0) {
  const t0 = r / c;
  const N0 = Math.round(t0 * fs);
  const tau = 1 / beta;
  const Nmax = Math.round(N0 + 5 * tau * fs);
  const n = new Array<number>(Nmax + 1).fill(0);
  const h = new Array<number>(Nmax + 1).fill(0);
  for (let i = N0; i < h.length; i++) h[i] = A * Math.exp(-(i - N0) * (beta / fs));
  return h;
}

// -----------------------------
// Movement artifacts
// -----------------------------
function generate_movement_artifacts(total_len: number, fs: number, opts: {
  rate_per_min?: number; duration_range?: [number, number]; band?: [number, number]; intensity?: number; thump_prob?: number; seed?: number | null;
} = {}) {
  const {
    rate_per_min = 6,
    duration_range = [0.2, 0.6],
    band = [15, 200],
    intensity = 1.0,
    thump_prob = 0.25,
    seed = null,
  } = opts;
  const rand = rngFactory(seed);
  const movement = new Array<number>(total_len).fill(0);
  const events: Array<[number, number]> = [];
  const total_sec = total_len / fs;
  const lam = rate_per_min / 60.0;
  let t = 0;
  const starts: number[] = [];
  while (true) {
    const gap = lam > 0 ? -Math.log(1 - rand()) / lam : Infinity; // exponential
    t += gap;
    if (t >= total_sec) break;
    starts.push(t);
  }
  for (const st of starts) {
    const dur = duration_range[0] + rand() * (duration_range[1] - duration_range[0]);
    const s_idx = Math.floor(st * fs);
    const e_idx = Math.min(total_len, s_idx + Math.max(1, Math.floor(dur * fs)));
    if (e_idx - s_idx < 4) continue;
    const seg_len = e_idx - s_idx;
    const seg = new Array<number>(seg_len);
    for (let i = 0; i < seg_len; i++) seg[i] = gaussian(rand);
    let y = simple_bandpass(seg, band[0], band[1], fs);
    // raised cosine fade in/out
    const Lr = Math.max(2, Math.floor(0.08 * seg_len));
    for (let i = 0; i < Lr; i++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / (Lr - 1));
      y[i] *= w;
      y[seg_len - 1 - i] *= w;
    }
    if (rand() < thump_prob) {
      const th_center = Math.floor((0.1 + 0.8 * rand()) * seg_len);
      const th_dur = Math.max(8, Math.floor(0.015 * fs));
      for (let k = 0; k < th_dur && th_center + k < seg_len; k++) {
        y[th_center + k] += Math.exp((-4.0 * k) / Math.max(1, th_dur));
      }
    }
    for (let i = 0; i < seg_len; i++) y[i] *= 0.25 * intensity;
    for (let i = s_idx, j = 0; i < e_idx; i++, j++) movement[i] += y[j];
    events.push([s_idx, e_idx]);
  }
  return { movement, events };
}

// -----------------------------
// Uterine contraction envelope
// -----------------------------
function generate_uc_envelope(total_len: number, fs: number, opts: {
  rate_per_10min?: number; duration_range?: [number, number]; rise_fall_frac?: [number, number]; attenuation?: number; noise_band?: [number, number]; noise_intensity?: number; seed?: number | null;
} = {}) {
  const {
    rate_per_10min = 3.0,
    duration_range = [30.0, 90.0],
    rise_fall_frac = [0.3, 0.3] as [number, number],
    attenuation = 0.45,
    noise_band = [0.5, 20.0] as [number, number],
    noise_intensity = 0.8,
    seed = null,
  } = opts;
  const rand = rngFactory(seed);
  const uc_env = new Array<number>(total_len).fill(0);
  const uc_events: UcEvent[] = [];
  const total_sec = total_len / fs;
  const lam = rate_per_10min / 600.0;
  let t = 0;
  const starts: number[] = [];
  while (true) {
    const gap = lam > 0 ? -Math.log(1 - rand()) / lam : Infinity;
    t += gap;
    if (t >= total_sec) break;
    starts.push(t);
  }
  for (const st of starts) {
    const dur = duration_range[0] + rand() * (duration_range[1] - duration_range[0]);
    const s_idx = Math.floor(st * fs);
    const e_idx = Math.min(total_len, s_idx + Math.max(1, Math.floor(dur * fs)));
    const L = e_idx - s_idx;
    if (L < 8) continue;
    const r_frac = rise_fall_frac[0];
    const f_frac = rise_fall_frac[1];
    const Lr = Math.max(2, Math.floor(r_frac * L));
    const Lf = Math.max(2, Math.floor(f_frac * L));
    const Lp = Math.max(0, L - Lr - Lf);
    const env_seg = new Array<number>(L);
    // up
    for (let i = 0; i < Lr; i++) env_seg[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / Lr);
    for (let i = 0; i < Lp; i++) env_seg[Lr + i] = 1;
    for (let i = 0; i < Lf; i++) env_seg[Lr + Lp + i] = 0.5 + 0.5 * Math.cos((Math.PI * i) / Lf);
    // trim
    for (let i = s_idx, j = 0; i < e_idx; i++, j++) uc_env[i] = Math.max(uc_env[i], env_seg[j] ?? 0);
    const peak = s_idx + Lr + Math.floor(Math.max(0, Lp - 1) / 2);
    uc_events.push({ start: s_idx, end: e_idx, peak });
  }

  // low-frequency noise multiplied by envelope
  let base = new Array<number>(total_len);
  for (let i = 0; i < total_len; i++) base[i] = gaussian(rand);
  base = simple_bandpass(base, noise_band[0], noise_band[1], fs);
  base = onepole_lowpass(base, 2.0, fs);
  const base_rms = rms(base);
  if (base_rms > 0) for (let i = 0; i < base.length; i++) base[i] /= base_rms;
  const uc_noise = base.map((v, i) => v * (noise_intensity * uc_env[i]));

  return { uc_env, uc_noise, uc_events, params: { rate_per_10min, duration_range, rise_fall_frac, attenuation, noise_band, noise_intensity } };
}

// -----------------------------
// Helpers
// -----------------------------
function rms(arr: number[]) { return Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / Math.max(1, arr.length)); }
function gaussian(rand: () => number) {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// -----------------------------
// Main simulator
// -----------------------------
export function simulateFpcgDataset(opts: SimOptions = {}): SimOutput {
  const {
    num_samples = 1,
    cycles_per_sample = 10,
    fs = 1000,
    fhr = 140,
    mhr = 80,
    snr_db = 10,
    r1 = 0.01, c1 = 1500, beta1 = 100, A1 = 1.0,
    r2 = 0.03, c2 = 1540, beta2 = 300, A2 = 0.8,
    movement_enabled = true,
    movement_intensity = 1.2,
    movement_rate_per_min = 8.0,
    movement_duration_range = [0.12, 0.45] as [number, number],
    movement_band = [15, 200] as [number, number],
    movement_thump_prob = 0.35,
    movement_seed = 2025,
    uc_enabled = true,
    uc_rate_per_10min = 3.0,
    uc_duration_range = [12.0, 30.0] as [number, number],
    uc_rise_fall_frac = [0.35, 0.35] as [number, number],
    uc_attenuation = 0.4,
    uc_noise_band = [0.5, 20.0] as [number, number],
    uc_noise_intensity = 0.7,
    uc_seed = 1234,
    rr_std_frac = 0.05,
  } = opts;

  // We only return first sample for UI usage
  // Build fetal heart beats to determine total duration
  const mean_rr = 60 / fhr; // seconds per beat
  const rand = rngFactory(null);
  const T: number[] = [];
  for (let k = 0; k < cycles_per_sample; k++) {
    const jitter = rr_std_frac * mean_rr * rand();
    T.push(mean_rr + jitter);
  }
  let total_duration = T.reduce((s, v) => s + v, 0) + 0.5;
  const nSamples = Math.max(1, Math.floor(fs * total_duration));
  const t = linspace(0, total_duration, nSamples);
  const signal_f = new Array<number>(nSamples).fill(0);
  // fetal heart S1/S2
  let idx = 0;
  const SSID_sec = (210 - 0.5 * fhr) / 1000;
  for (const rr of T) {
    const beat_len = Math.floor(rr * fs);
    const amp_s1 = 0.8 + 0.08 * gaussian(rand);
    const amp_s2 = 0.5 + 0.08 * gaussian(rand);
    const freq_s1 = 50 + 2 * gaussian(rand);
    const freq_s2 = 60 + 2 * gaussian(rand);
    const dur_s1 = Math.max(0.02, 0.08 + 0.01 * gaussian(rand));
    const dur_s2 = Math.max(0.02, 0.05 + 0.01 * gaussian(rand));
    const SSID = Math.max(0.02, SSID_sec + 0.01 * gaussian(rand));
    const { signal: s1 } = generate_heart_sound(freq_s1, dur_s1, fs, amp_s1);
    const { signal: s2 } = generate_heart_sound(freq_s2, dur_s2, fs, amp_s2);
    const s1_start = idx;
    const s2_start = idx + Math.floor(SSID * fs);
    for (let i = 0; i < s1.length && s1_start + i < signal_f.length; i++) signal_f[s1_start + i] += s1[i];
    for (let i = 0; i < s2.length && s2_start + i < signal_f.length; i++) signal_f[s2_start + i] += s2[i];
    idx += beat_len;
  }
  // maternal heart
  const mSSID_sec = (0.2 * (60000 / mhr) - 160) / 1000;
  const Tm: number[] = [];
  for (let k = 0; k < T.length; k++) Tm.push(60 / mhr + rr_std_frac * mean_rr * rand());
  const signal_m = new Array<number>(nSamples).fill(0);
  idx = 0;
  for (const rr of Tm) {
    const beat_len = Math.floor(rr * fs);
    const amp_ms1 = 0.03 + 0.02 * gaussian(rand);
    const amp_ms2 = 0.02 + 0.02 * gaussian(rand);
    const freq_ms1 = 15 + 2 * gaussian(rand);
    const freq_ms2 = 20 + 2 * gaussian(rand);
    const dur_ms1 = Math.max(0.02, 0.08 + 0.01 * gaussian(rand));
    const dur_ms2 = Math.max(0.02, 0.05 + 0.01 * gaussian(rand));
    const mSSID = Math.max(0.01, mSSID_sec + 0.005 * gaussian(rand));
    const { signal: ms1 } = generate_heart_sound(freq_ms1, dur_ms1, fs, amp_ms1);
    const { signal: ms2 } = generate_heart_sound(freq_ms2, dur_ms2, fs, amp_ms2);
    const ms1_start = idx + Math.floor(0.3 * fs);
    const ms2_start = ms1_start + Math.floor(mSSID * fs);
    for (let i = 0; i < ms1.length && ms1_start + i < signal_m.length; i++) signal_m[ms1_start + i] += ms1[i];
    for (let i = 0; i < ms2.length && ms2_start + i < signal_m.length; i++) signal_m[ms2_start + i] += ms2[i];
    idx += beat_len;
  }

  // Propagation model
  const h1 = expo_conv_kernel(r1, c1, fs, beta1, A1);
  const h2 = expo_conv_kernel(r2, c2, fs, beta2, A2);
  const h_total = convolve(h1, h2);
  const h_norm = h_total.reduce((s, v) => s + v, 0);
  for (let i = 0; i < h_total.length; i++) h_total[i] = h_total[i] / (h_norm || 1);
  const signal_f_prop = convolve(signal_f, h_total).slice(0, signal_f.length);

  // UC
  let uc_env = new Array<number>(nSamples).fill(0);
  let uc_noise = new Array<number>(nSamples).fill(0);
  let uc_events: UcEvent[] = [];
  if (uc_enabled) {
    const res = generate_uc_envelope(nSamples, fs, { rate_per_10min: uc_rate_per_10min, duration_range: uc_duration_range, rise_fall_frac: uc_rise_fall_frac, attenuation: uc_attenuation, noise_band: uc_noise_band, noise_intensity: uc_noise_intensity, seed: uc_seed });
    uc_env = res.uc_env; uc_noise = res.uc_noise; uc_events = res.uc_events;
  }
  const signal_f_env = signal_f_prop.map((v, i) => v * (1.0 - (uc_enabled ? uc_attenuation * uc_env[i] : 0)));

  // Movement
  let movement = new Array<number>(nSamples).fill(0);
  let mv_events: Array<[number, number]> = [];
  if (movement_enabled) {
    const mv = generate_movement_artifacts(nSamples, fs, { rate_per_min: movement_rate_per_min, duration_range: movement_duration_range, band: movement_band, intensity: movement_intensity, thump_prob: movement_thump_prob, seed: movement_seed });
    movement = mv.movement; mv_events = mv.events;
  }

  // Combine + AWGN for SNR
  const signal_base = new Array<number>(nSamples);
  for (let i = 0; i < nSamples; i++) signal_base[i] = signal_f_env[i] + signal_m[i] + uc_noise[i] + movement[i];
  const signal_r = rms(signal_base);
  const noise_r = signal_r / Math.pow(10, snr_db / 20);
  const noise = new Array<number>(nSamples).fill(0).map(() => gaussian(rand));
  const noise_norm = rms(noise) || 1;
  for (let i = 0; i < nSamples; i++) noise[i] = (noise[i] / noise_norm) * noise_r;
  const signal_skin_total = signal_base.map((v, i) => v + noise[i]);

  return { t, y: signal_skin_total, meta: { movement_events: mv_events, uc_events } };
}

// Simple convolution
function convolve(a: number[], b: number[]) {
  const n = a.length, m = b.length;
  const out = new Array<number>(n + m - 1).fill(0);
  for (let i = 0; i < n; i++) {
    const ai = a[i];
    for (let j = 0; j < m; j++) out[i + j] += ai * b[j];
  }
  return out;
}

// Utility to resample signal to a fixed length using linear interpolation
export function resampleToLength(xs: number[], ys: number[], targetLen: number) {
  if (ys.length === targetLen) return ys.slice();
  const out = new Array<number>(targetLen);
  const tMin = xs[0], tMax = xs[xs.length - 1];
  for (let i = 0; i < targetLen; i++) {
    const t = tMin + ((tMax - tMin) * i) / Math.max(1, targetLen - 1);
    // find index
    const u = (t - tMin) / (tMax - tMin);
    const idx = u * (ys.length - 1);
    const i0 = Math.floor(idx), i1 = Math.min(ys.length - 1, i0 + 1);
    const w = idx - i0;
    out[i] = ys[i0] * (1 - w) + ys[i1] * w;
  }
  return out;
}
