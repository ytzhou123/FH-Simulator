# Fetal Heart Sound Simulator

A web demo for the paper **A Dynamic Parametric Simulator for Fetal Heart Sounds** (IEEE EMBC 2026).
It makes synthetic abdominal fetal phonocardiogram (fPCG) signals right in your browser. No data is uploaded.

- **Live demo:** https://ytzhou123.github.io/FH-Simulator/
- **Paper:** [arXiv:2601.16792](https://arxiv.org/abs/2601.16792)
- **Authors:** Yingtong Zhou, Yiang Zhou, Zhengxian Qu, Kang Liu, Ting Tan

## What you can do

1. Pick one of six scenarios:

   | Scenario | What changes |
   |---|---|
   | Normal | Baseline signal with no fetal movement or contractions |
   | Arrhythmia | Irregular beat-to-beat (RR) intervals |
   | Strong Movement | Strong, frequent fetal movement artifacts |
   | Weak Movement | Mild, rare fetal movement artifacts |
   | Fast Contractions | Frequent, short uterine contractions |
   | Slow Contractions | Fewer, longer uterine contractions |

2. Set the number of heart cycles, data points and datasets.
3. Press **Generate** to see the waveforms, then download them as CSV.

## How the signal is made

The simulator code is in [`client/lib/fpcg.ts`](client/lib/fpcg.ts). It is a TypeScript port of the preset-based Python simulator. Each signal has:

- fetal S1/S2 heart sounds (default fetal heart rate 140 bpm)
- weak maternal heart sounds (default 80 bpm)
- abdominal transmission, modeled as two decaying exponential kernels
- fetal movement artifacts and uterine contractions (depending on the scenario)
- Gaussian white noise at a set SNR (default 10 dB)

The signal is simulated at 1000 Hz. It is then resampled by linear interpolation to the chosen number of data points. The page shows the resulting sample rate, so you can check that you kept enough points.

The calibration and fitting steps from the paper are not part of this web demo.

## CSV format

| Column | Meaning |
|---|---|
| `timestamp` | sample index (0, 1, 2, …), not seconds |
| `value` | signal amplitude |
| `type` | scenario id, for example `fhs_normal` |
| `series` | dataset number, starting at 0 |

Each dataset is a new random run. Dataset *k* is also scaled by (1 + 0.05·*k*) and gets a little extra noise. Movement and contraction events use fixed random seeds, so they happen at the same times in every dataset.

## Run it locally

You need Node.js 20.19 or newer (Vite 7 needs it).

```bash
npm ci
npm run dev
```

Then open http://localhost:8080/FH-Simulator/.

## Deploy

GitHub Pages serves the `gh-pages` branch. To publish:

1. Push your source changes to `main`.
2. Run `npm run deploy`. This builds the site and pushes `dist/spa` to `gh-pages`.

The site lives under `/FH-Simulator/` (see `base` in `vite.config.ts`). The router reads the same base path, so keep the two in sync if the repo is renamed.

## Tech stack

React 18, TypeScript, Vite, Tailwind CSS and Radix UI, based on the Builder.io Fusion Starter template. The `server/` folder comes from the template. GitHub Pages only serves the static site, so the demo does not use it.

## Citation

```bibtex
@misc{zhou2026fetal,
  title         = {A Dynamic Parametric Simulator for Fetal Heart Sounds},
  author        = {Zhou, Yingtong and Zhou, Yiang and Qu, Zhengxian and Liu, Kang and Tan, Ting},
  year          = {2026},
  eprint        = {2601.16792},
  archivePrefix = {arXiv},
  primaryClass  = {eess.SP}
}
```

## License

This repository does not have a license yet. Please contact the authors before reusing the code.

This demo is for research and teaching only. It is not for clinical use.
