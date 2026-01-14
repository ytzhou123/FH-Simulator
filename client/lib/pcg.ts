// Human Phonocardiogram (PCG) simulation
// Port of Python implementation with normal and abnormal (4-class) support

import type { HeartSimOutput } from "@shared/api";

type RNG = () => number;

function seededRandom(seed: number): RNG {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: RNG): number {
  let u = 0,
    v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ===================== 基础滤波器 =====================

function bandpassFilter(
  x: number[],
  fs: number,
  low: number,
  high: number,
  order: number = 4
): number[] {
  // Simple cascaded one-pole filters to approximate bandpass
  const y = x.slice();
  const lowClamped = Math.min(low, fs / 2 - 1);
  const highClamped = Math.min(high, fs / 2 - 1);

  // Lowpass
  for (let ord = 0; ord < order / 2; ord++) {
    const a = Math.exp((-2 * Math.PI * highClamped) / fs);
    const out = new Array<number>(y.length).fill(0);
    for (let i = 1; i < y.length; i++) {
      out[i] = a * out[i - 1] + (1 - a) * y[i];
    }
    for (let i = 0; i < y.length; i++) y[i] = out[i];
  }

  // Highpass
  for (let ord = 0; ord < order / 2; ord++) {
    const a = Math.exp((-2 * Math.PI * lowClamped) / fs);
    const low_filtered = new Array<number>(y.length).fill(0);
    for (let i = 1; i < y.length; i++) {
      low_filtered[i] = a * low_filtered[i - 1] + (1 - a) * y[i];
    }
    const out = new Array<number>(y.length);
    for (let i = 0; i < y.length; i++) out[i] = y[i] - low_filtered[i];
    for (let i = 0; i < y.length; i++) y[i] = out[i];
  }

  return y;
}

function lowpassFilter(
  x: number[],
  fs: number,
  cutoff: number,
  order: number = 4
): number[] {
  const y = x.slice();
  const cutoffClamped = Math.min(cutoff, fs / 2 - 1);

  for (let ord = 0; ord < order; ord++) {
    const a = Math.exp((-2 * Math.PI * cutoffClamped) / fs);
    const out = new Array<number>(y.length).fill(0);
    for (let i = 1; i < y.length; i++) {
      out[i] = a * out[i - 1] + (1 - a) * y[i];
    }
    for (let i = 0; i < y.length; i++) y[i] = out[i];
  }

  return y;
}

function resonator(
  x: number[],
  fs: number,
  f0: number,
  zeta: number
): number[] {
  const w0 = (2 * Math.PI * f0) / fs;
  const a1 = -2 * Math.exp(-zeta * w0) * Math.cos(w0);
  const a2 = Math.exp(-2 * zeta * w0);
  const b0 = 1 - Math.exp(-zeta * w0);

  const y = new Array<number>(x.length).fill(0);
  for (let i = 0; i < x.length; i++) {
    y[i] = b0 * x[i];
    if (i >= 1) y[i] += a1 * y[i - 1];
    if (i >= 2) y[i] += a2 * y[i - 2];
  }
  return y;
}

// ===================== 噪声构造 =====================

function bandpassNoise(
  n: number,
  fs: number,
  low: number = 10,
  high: number = 40,
  rng: RNG = Math.random
): number[] {
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) w[i] = gaussian(rng);
  return bandpassFilter(w, fs, low, high);
}

function addNoiseSNR(
  x: number[],
  snrDb: number,
  fs: number = 4000,
  rng: RNG = Math.random
): number[] {
  const pSig = x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length);
  const snrLin = Math.pow(10, snrDb / 10);
  const pNoise = pSig / snrLin;

  const noise = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) noise[i] = gaussian(rng);

  let filtered = lowpassFilter(noise, fs, 100);
  const noisePower = Math.sqrt(
    filtered.reduce((s, v) => s + v * v, 0) / Math.max(1, filtered.length) + 1e-8
  );
  for (let i = 0; i < filtered.length; i++)
    filtered[i] = filtered[i] / (noisePower + 1e-8);

  const result = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++)
    result[i] = x[i] + filtered[i] * Math.sqrt(pNoise);

  return result;
}

// ===================== 包络 × 载波 =====================

function envelopedBurst(
  n: number,
  fs: number,
  center: number,
  width: number,
  amp: number,
  rng: RNG = Math.random
): number[] {
  const t = new Array<number>(n);
  for (let i = 0; i < n; i++) t[i] = i / fs;

  const env = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const diff = (t[i] - center) / width;
    env[i] = Math.exp(-0.5 * diff * diff);
  }

  // Generate sinusoidal carrier in heart sound frequency range (50-400 Hz)
  const f0 = 60 + 40 * gaussian(rng);  // 60 ± 40 Hz
  const result = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const phase = (2 * Math.PI * f0 * t[i]) + gaussian(rng) * 0.2;
    const sine = Math.sin(phase);
    const noise = gaussian(rng) * 0.3;
    result[i] = amp * env[i] * (sine + noise);
  }
  return result;
}

function valveEvent(
  n: number,
  fs: number,
  center: number,
  width: number,
  ampMain: number,
  ampSub: number,
  delayMs: number,
  rng: RNG = Math.random
): number[] {
  const delay = delayMs / 1000;
  const main = envelopedBurst(n, fs, center, width, ampMain, rng);
  const sub = envelopedBurst(n, fs, center + delay, width, ampSub, rng);

  const result = new Array<number>(n);
  for (let i = 0; i < n; i++) result[i] = main[i] + sub[i];
  return result;
}

// ===================== 单周期 PCG（支持拟合参数） =====================

interface PCGParams {
  width_s1: number;
  width_s2: number;
  amp_main: number;
  amp_sub: number;
  t_s1_ratio: number;
  t_s2_ratio: number;
  f0: number;
  zeta: number;
}

function simulateSingleBeat(
  fs: number,
  duration: number,
  params: PCGParams,
  abnormal?: string,
  rng: RNG = Math.random
): { beat: number[]; s1Time: number; s2Time: number } {
  const n = Math.floor(duration * fs);

  const tS1 = params.t_s1_ratio * duration;
  const tS2 = params.t_s2_ratio * duration;

  let s1 = valveEvent(
    n,
    fs,
    tS1,
    params.width_s1,
    params.amp_main * 2.0,  // Increase amplitude
    params.amp_sub * 2.0,
    12,
    rng
  );

  let s2 = valveEvent(
    n,
    fs,
    tS2,
    params.width_s2,
    params.amp_main * 1.6,  // Increase amplitude
    params.amp_sub * 1.6,
    18,
    rng
  );

  let beat = new Array<number>(n);
  for (let i = 0; i < n; i++) beat[i] = s1[i] + s2[i];

  // 异常心音注入
  if (abnormal === "systolic_murmur") {
    const murmur = addSystolicMurmur(n, fs, tS1, tS2, rng);
    for (let i = 0; i < n; i++) beat[i] += murmur[i];
  } else if (abnormal === "diastolic_murmur") {
    const nextTS1 = duration + params.t_s1_ratio * duration;
    const murmur = addDiastolicMurmur(n, fs, tS2, nextTS1, rng);
    for (let i = 0; i < n; i++) beat[i] += murmur[i];
  } else if (abnormal === "s2_split") {
    const s2Split = addS2Split(n, fs, tS2, s2, 60, rng);
    for (let i = 0; i < n; i++) beat[i] = s1[i] + s2Split[i];
  } else if (abnormal === "s3") {
    const s3 = addS3Sound(n, fs, tS2, rng);
    for (let i = 0; i < n; i++) beat[i] += s3[i];
  }

  // 胸腔共振 - reduce order for less attenuation
  beat = resonator(beat, fs, params.f0 * 0.8, params.zeta * 0.6);

  // 简化滤波：只保留单层低通
  beat = lowpassFilter(beat, fs, 150);

  return { beat, s1Time: tS1, s2Time: tS2 };
}

// ===================== 异常心音函数 =====================

function addSystolicMurmur(
  n: number,
  fs: number,
  tS1: number,
  tS2: number,
  rng: RNG = Math.random
): number[] {
  const murmur = new Array<number>(n).fill(0);
  const startIdx = Math.floor(tS1 * fs);
  const endIdx = Math.floor(tS2 * fs);

  if (endIdx > startIdx) {
    const len = endIdx - startIdx;
    for (let i = 0; i < len && startIdx + i < n; i++) {
      const t = i / fs;
      const env = Math.exp(-3 * (t / ((endIdx - startIdx) / fs)));
      const noise = gaussian(rng);
      murmur[startIdx + i] = 0.25 * env * noise;
    }
  }

  return bandpassFilter(murmur, fs, 100, 400);
}

function addDiastolicMurmur(
  n: number,
  fs: number,
  tS2: number,
  nextTS1: number,
  rng: RNG = Math.random
): number[] {
  const murmur = new Array<number>(n).fill(0);
  const startIdx = Math.floor(tS2 * fs);
  const endIdx = Math.min(n, Math.floor(nextTS1 * fs));

  if (endIdx > startIdx) {
    const len = endIdx - startIdx;
    for (let i = 0; i < len && startIdx + i < n; i++) {
      const t = i / fs;
      const env = Math.sin((Math.PI * t) / ((endIdx - startIdx) / fs));
      const noise = gaussian(rng);
      murmur[startIdx + i] = 0.2 * env * noise;
    }
  }

  return bandpassFilter(murmur, fs, 80, 300);
}

function addS2Split(
  n: number,
  fs: number,
  tS2: number,
  s2Original: number[],
  splitMs: number,
  rng: RNG = Math.random
): number[] {
  const splitDelay = (splitMs / 1000) * fs;
  const result = new Array<number>(n);
  for (let i = 0; i < n; i++) result[i] = s2Original[i];

  const s2Split = valveEvent(
    n,
    fs,
    tS2 + splitMs / 1000,
    0.03,
    0.4,
    0.2,
    18,
    rng
  );

  for (let i = 0; i < n; i++) result[i] += 0.6 * s2Split[i];

  return result;
}

function addS3Sound(
  n: number,
  fs: number,
  tS2: number,
  rng: RNG = Math.random
): number[] {
  const s3 = new Array<number>(n).fill(0);
  const s3Time = tS2 + 0.15;
  const idx = Math.floor(s3Time * fs);

  if (idx < n) {
    const s3Burst = envelopedBurst(
      Math.min(200, n - idx),
      fs,
      0.05,
      0.04,
      0.3,
      rng
    );
    for (let i = 0; i < s3Burst.length && idx + i < n; i++) {
      s3[idx + i] = s3Burst[i];
    }
  }

  return bandpassFilter(s3, fs, 20, 150);
}

// ===================== 多周期 PCG =====================

export function simulateMultibeat(
  numBeats: number,
  fs: number,
  beatLengthSec: number,
  params: PCGParams,
  abnormal?: string,
  snrDb: number = 5,
  rng: RNG = Math.random
): { pcg: number[]; s1Times: number[]; s2Times: number[] } {
  const beats: number[][] = [];
  const s1Times: number[] = [];
  const s2Times: number[] = [];

  for (let b = 0; b < numBeats; b++) {
    const { beat, s1Time, s2Time } = simulateSingleBeat(
      fs,
      beatLengthSec,
      params,
      abnormal,
      rng
    );

    let processed = addNoiseSNR(beat, snrDb, fs, rng);

    // Ensure signal is not all zeros
    const peak = Math.max(
      ...processed.map((v) => Math.abs(v)),
      1e-8
    );

    // Guard against very small peaks (indicates filter issue)
    if (peak < 1e-6) {
      // If signal is nearly zero, amplify it
      for (let i = 0; i < processed.length; i++) {
        processed[i] = processed[i] * 100;
      }
    }

    // Normalize to 0.95
    const finalPeak = Math.max(
      ...processed.map((v) => Math.abs(v)),
      1e-8
    );
    for (let i = 0; i < processed.length; i++) {
      processed[i] = (0.95 * processed[i]) / finalPeak;
    }

    beats.push(processed);
    s1Times.push(s1Time + b * beatLengthSec);
    s2Times.push(s2Time + b * beatLengthSec);
  }

  const pcg = beats.flat();

  // Ensure signal is not empty and has reasonable amplitude
  if (pcg.length === 0 || Math.max(...pcg.map(v => Math.abs(v)), 0) < 0.01) {
    // Generate fallback signal if something went wrong
    console.warn(`[simulateMultibeat] Weak signal detected, applying amplification`);
    for (let i = 0; i < pcg.length; i++) {
      pcg[i] = pcg[i] * 10;  // Amplify weak signal
    }
  }

  return { pcg, s1Times, s2Times };
}

// ===================== 默认参数 =====================

const defaultParams: PCGParams = {
  width_s1: 0.045,
  width_s2: 0.035,
  amp_main: 0.8,
  amp_sub: 0.4,
  t_s1_ratio: 0.12,
  t_s2_ratio: 0.45,
  f0: 120,
  zeta: 0.4,
};

// ===================== 公开 UI 入口 =====================

export function simulateHeartDataset(opts: {
  cycles?: number;
  fs?: number;
  abnormal?: string;
} = {}): { t: number[]; y: number[] } {
  const cycles = opts.cycles ?? 10;
  const fs = opts.fs ?? 1000;
  const beatLengthSec = 1.2;

  const rng = seededRandom(2025);
  const { pcg, s1Times, s2Times } = simulateMultibeat(
    cycles,
    fs,
    beatLengthSec,
    defaultParams,
    opts.abnormal,
    6,
    rng
  );

  const t = new Array<number>(pcg.length);
  for (let i = 0; i < pcg.length; i++) t[i] = i / fs;


  return { t, y: pcg };
}

export function resampleToLength(
  t: number[],
  y: number[],
  targetLength: number
): number[] {
  if (y.length === targetLength) return y.slice();
  if (targetLength <= 0) return [];

  const out = new Array<number>(targetLength);
  const n = y.length - 1;

  for (let i = 0; i < targetLength; i++) {
    const idx = (i * n) / Math.max(1, targetLength - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(n, i0 + 1);
    const w = idx - i0;
    out[i] = y[i0] * (1 - w) + y[i1] * w;
  }

  return out;
}
