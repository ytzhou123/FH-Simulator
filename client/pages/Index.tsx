import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Baby, Download, FileText, Footprints, Github, Heart, HeartPulse, Hourglass, Loader2, Play, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { simulateFpcgDataset, resampleToLength, type SimOptions } from "@/lib/fpcg";

const PAPER_URL = "https://arxiv.org/abs/2601.16792";
const REPO_URL = "https://github.com/ytzhou123/FH-Simulator";
const LOGO_URL =
  "https://cdn.builder.io/api/v1/image/assets%2F48e66d8efd9b4605abd90c97e923384d%2Fc920a09c86384c88aff437ac5866d971?format=webp&width=800";

// simulateFpcgDataset runs at its default fs (1000 Hz); the result is then resampled to "Data points"
const SIM_FS = 1000;
// Mean beat length at the simulator's default FHR (140 bpm), only used for the duration hint
const MEAN_RR_S = 60 / 140;

type Scenario = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  options: SimOptions;
};

const scenarios: Scenario[] = [
  { id: "fhs_normal", name: "Normal", description: "Standard fetal cardiac sounds", icon: Heart, options: { movement_enabled: false, uc_enabled: false } },
  { id: "fhs_arrhythmia", name: "Arrhythmia", description: "Irregular RR intervals", icon: HeartPulse, options: { movement_enabled: false, uc_enabled: false, rr_std_frac: 0.15 } },
  { id: "fhs_move_strong", name: "Strong Movement", description: "Enhanced movement artifacts", icon: Footprints, options: { movement_enabled: true, movement_intensity: 2.0, movement_rate_per_min: 12, uc_enabled: false } },
  { id: "fhs_move_weak", name: "Weak Movement", description: "Reduced movement artifacts", icon: Baby, options: { movement_enabled: true, movement_intensity: 0.4, movement_rate_per_min: 4, uc_enabled: false } },
  { id: "fhs_uc_fast", name: "Fast Contractions", description: "Frequent uterine contractions", icon: Waves, options: { movement_enabled: false, uc_enabled: true, uc_rate_per_10min: 6.0, uc_duration_range: [10, 20] } },
  { id: "fhs_uc_slow", name: "Slow Contractions", description: "Infrequent/longer contractions", icon: Hourglass, options: { movement_enabled: false, uc_enabled: true, uc_rate_per_10min: 1.0, uc_duration_range: [20, 40] } },
];

const seriesColors = ["#fb7185", "#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#22d3ee", "#a3e635", "#fb923c", "#818cf8"];

type Result = {
  scenarioId: string;
  cycles: number;
  points: number;
  datasets: number;
  duration: number; // seconds, taken from the first dataset
  series: number[][];
};

function noise(n: number) {
  return (Math.random() * 2 - 1) * n;
}

function fmt(v: number, digits: number) {
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function generateDataset(scenario: Scenario, cycles: number, points: number) {
  const { t, y } = simulateFpcgDataset({ cycles_per_sample: Math.max(1, Math.floor(cycles)), ...scenario.options });
  return { values: resampleToLength(t, y, points), duration: t[t.length - 1] - t[0] };
}

// Min/max per bucket keeps the peaks visible when a series has more points than the chart has pixels
function waveformPoints(values: number[], buckets = 1200) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const span = Math.max(1e-8, max - min);
  const y = (v: number) => (95 - ((v - min) / span) * 90).toFixed(2);
  const zeroY = min <= 0 && max >= 0 ? Number(y(0)) : null;
  const n = values.length;
  if (n <= buckets * 2) {
    return { zeroY, points: values.map((v, i) => `${((i / Math.max(1, n - 1)) * 1000).toFixed(1)},${y(v)}`).join(" ") };
  }
  const pts: string[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * n) / buckets);
    const end = Math.floor(((b + 1) * n) / buckets);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end; i++) {
      lo = Math.min(lo, values[i]);
      hi = Math.max(hi, values[i]);
    }
    const x = ((b / (buckets - 1)) * 1000).toFixed(1);
    pts.push(`${x},${y(hi)}`, `${x},${y(lo)}`);
  }
  return { zeroY, points: pts.join(" ") };
}

function HeaderLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-3"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </a>
  );
}

function Panel({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-secondary text-[11px] font-medium text-muted-foreground">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ParamSlider(props: { label: string; value: number[]; onChange: (v: number[]) => void; min: number; max: number; step: number }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{props.label}</span>
        <span className="font-medium tabular-nums">{props.value[0].toLocaleString("en-US")}</span>
      </div>
      <Slider value={props.value} onValueChange={props.onChange} min={props.min} max={props.max} step={props.step} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-3 sm:px-5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-semibold tabular-nums sm:text-base">{value}</dd>
    </div>
  );
}

export default function Index() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [cycles, setCycles] = useState([10]);
  const [dataCount, setDataCount] = useState([5000]);
  const [seriesCount, setSeriesCount] = useState([3]);
  const [datasetCount, setDatasetCount] = useState([3]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];

  const handleGenerate = () => {
    setIsGenerating(true);
    // Let the spinner paint before the (synchronous) simulation starts
    setTimeout(() => {
      const series: number[][] = [];
      let duration = 0;
      for (let s = 0; s < Math.max(1, datasetCount[0]); s++) {
        try {
          const ds = generateDataset(scenario, cycles[0], dataCount[0]);
          if (!duration) duration = ds.duration;
          series.push(ds.values.map((v) => v * (1 + s * 0.05) + noise(0.02 * s)));
        } catch (e) {
          console.error(`Error generating ${scenario.id} series ${s}:`, e);
        }
      }
      setResult({ scenarioId: scenario.id, cycles: cycles[0], points: dataCount[0], datasets: datasetCount[0], duration, series });
      setIsGenerating(false);
    }, 50);
  };

  // Show a first signal right away instead of an empty preview
  useEffect(() => {
    handleGenerate();
  }, []);

  const handleDownload = () => {
    if (!result) return;
    const rows = ["timestamp,value,type,series"];
    result.series.forEach((values, s) => values.forEach((v, i) => rows.push(`${i},${v},${result.scenarioId},${s}`)));
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `auscultsim_${result.scenarioId}_data.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const estDuration = cycles[0] * MEAN_RR_S + 0.5;
  const estRate = dataCount[0] / estDuration;
  const resultScenario = result ? scenarios.find((s) => s.id === result.scenarioId) : undefined;
  const isStale =
    !!result &&
    (result.scenarioId !== scenarioId || result.cycles !== cycles[0] || result.points !== dataCount[0] || result.datasets !== datasetCount[0]);
  const waveforms = useMemo(
    () => (result ? result.series.slice(0, seriesCount[0]).map((values) => waveformPoints(values)) : []),
    [result, seriesCount],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src={LOGO_URL} alt="" className="h-7 w-auto shrink-0" />
            <span className="truncate text-sm font-semibold tracking-tight sm:text-base">Fetal Heart Sound Simulator</span>
            <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground md:inline">
              IEEE EMBC 2026
            </span>
          </div>
          <nav className="flex shrink-0 items-center gap-2">
            <HeaderLink href={PAPER_URL} icon={FileText} label="Paper" />
            <HeaderLink href={REPO_URL} icon={Github} label="GitHub" />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Simulate abdominal fetal heart sounds</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            Pick a scenario, choose how long the signal should be, and generate synthetic fetal phonocardiogram (fPCG) data.
            Everything runs in your browser.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Panel step="1" title="Scenario">
              <div role="radiogroup" aria-label="Scenario" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {scenarios.map((s) => {
                  const Icon = s.icon;
                  const selected = s.id === scenarioId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setScenarioId(s.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected ? "border-rose-400/50 bg-rose-400/[0.08]" : "border-border hover:bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors",
                          selected ? "bg-rose-400 text-neutral-950" : "bg-secondary text-muted-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{s.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{s.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel step="2" title="Parameters">
              <div className="space-y-5">
                <ParamSlider label="Heart cycles" value={cycles} onChange={setCycles} min={5} max={1000} step={5} />
                <ParamSlider label="Data points per dataset" value={dataCount} onChange={setDataCount} min={100} max={20000} step={100} />
                <ParamSlider label="Datasets" value={datasetCount} onChange={setDatasetCount} min={1} max={50} step={1} />
                <ParamSlider label="Datasets shown" value={seriesCount} onChange={setSeriesCount} min={1} max={10} step={1} />
              </div>
              <p className="mt-5 text-xs leading-5 text-muted-foreground">
                About {fmt(estDuration, 1)} s of signal, resampled to about {fmt(estRate, 0)} Hz.
              </p>
              {estRate < 200 && (
                <p className="mt-2 rounded-md bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-200">
                  Too few points for this length: the heart sounds (about 40–60 Hz) will look distorted. Add data points or use
                  fewer cycles.
                </p>
              )}
              <div className="mt-5 flex gap-2">
                <Button onClick={handleGenerate} disabled={isGenerating} className="flex-1 rounded-full">
                  {isGenerating ? <Loader2 className="animate-spin" /> : <Play />}
                  {isGenerating ? "Generating…" : "Generate"}
                </Button>
                <Button onClick={handleDownload} disabled={!result || isGenerating} variant="outline" className="rounded-full">
                  <Download />
                  CSV
                </Button>
              </div>
            </Panel>
          </div>

          <section className="overflow-hidden rounded-xl border border-border bg-card lg:sticky lg:top-20">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 sm:px-5">
              <div>
                <h2 className="text-sm font-semibold">Waveform preview</h2>
                <p className="text-xs text-muted-foreground">
                  {result && resultScenario
                    ? `${resultScenario.name} · ${result.series.length} ${result.series.length === 1 ? "dataset" : "datasets"}`
                    : "Generating the first signal…"}
                </p>
              </div>
              {isStale && !isGenerating && (
                <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-xs text-amber-200">Settings changed · press Generate</span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-px border-y border-border bg-border sm:grid-cols-4">
              <Stat label="Points / dataset" value={result ? result.points.toLocaleString("en-US") : "–"} />
              <Stat label="Datasets" value={result ? String(result.series.length) : "–"} />
              <Stat label="Duration" value={result ? `${fmt(result.duration, 1)} s` : "–"} />
              <Stat label="Sample rate" value={result && result.duration > 0 ? `${fmt(result.points / result.duration, 0)} Hz` : "–"} />
            </dl>

            <div className={cn("space-y-4 p-4 transition-opacity sm:p-5", isGenerating && "opacity-50")}>
              {result ? (
                <>
                  {waveforms.map((wave, i) => (
                    <div key={i}>
                      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seriesColors[i % seriesColors.length] }} />
                        Dataset {i + 1}
                      </div>
                      <div className="h-28 overflow-hidden rounded-lg border border-border bg-background sm:h-32">
                        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
                          {wave.zeroY !== null && (
                            <line
                              x1="0"
                              y1={wave.zeroY}
                              x2="1000"
                              y2={wave.zeroY}
                              className="stroke-muted-foreground/30"
                              strokeDasharray="4 4"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          <polyline
                            points={wave.points}
                            fill="none"
                            stroke={seriesColors[i % seriesColors.length]}
                            strokeWidth={1}
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        </svg>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
                    <span>0 s</span>
                    <span>{fmt(result.duration / 2, 1)} s</span>
                    <span>{fmt(result.duration, 1)} s</span>
                  </div>
                </>
              ) : (
                <div className="grid h-60 place-items-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
            </div>

            <p className="border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
              Each line is scaled to fit its box. Signals are simulated at {SIM_FS.toLocaleString("en-US")} Hz, then resampled to the
              chosen number of points.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs leading-5 text-muted-foreground sm:px-6">
          Based on{" "}
          <a href={PAPER_URL} target="_blank" rel="noreferrer" className="text-foreground/80 underline underline-offset-2 hover:text-foreground">
            A Dynamic Parametric Simulator for Fetal Heart Sounds
          </a>{" "}
          (Zhou et al., IEEE EMBC 2026). For research and teaching only, not for clinical use.
        </div>
      </footer>
    </div>
  );
}
