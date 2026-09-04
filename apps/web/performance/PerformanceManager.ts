import { QualityProfiles, type RuntimeQuality } from "@print-rush/3d-factory";

const STORAGE_KEY = "print-rush.quality.v3";

export type DeviceReport = {
  profile: RuntimeQuality;
  automatic: boolean;
  mobile: boolean;
  reducedMotion: boolean;
  cores: number;
  memoryGb: number | null;
  pixelRatio: number;
};

export function getDeviceReport(): DeviceReport {
  if (typeof window === "undefined") return { profile: "MEDIUM", automatic: true, mobile: false, reducedMotion: false, cores: 4, memoryGb: null, pixelRatio: 1 };
  let forced: RuntimeQuality | null = null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as RuntimeQuality | null;
    forced = stored && stored in QualityProfiles ? stored : null;
  } catch {
    // Sandboxed/private contexts can deny storage. Device detection itself remains usable.
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = matchMedia("(pointer: coarse)").matches || window.innerWidth < 760;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cores = nav.hardwareConcurrency || 4;
  const memoryGb = nav.deviceMemory ?? null;
  /**
   * Which tier a device lands on.
   *
   * The old rule dropped to LOW on `mobile && cores <= 4`, and that was the single biggest cause of
   * "on mobile the texturing looks bad and the background is empty". Safari caps
   * `hardwareConcurrency` and plenty of capable Android phones report exactly 4, so most phones
   * landed on LOW — where the poster, crowd, dressing and decal budgets were all zero and
   * anisotropic filtering was off. The phone was not struggling; it was being told to render an
   * empty world.
   *
   * LOW now means what it says: a device that has actually told us it is small. Everything else gets
   * MEDIUM, which keeps the dressing and the filtering, and `FrameMonitor` is there to catch a
   * device that turns out to be slower than it claimed.
   */
  let profile: RuntimeQuality = "HIGH";
  if (mobile || cores <= 4 || (memoryGb !== null && memoryGb <= 4)) profile = "MEDIUM";
  if (memoryGb !== null && memoryGb <= 2) profile = "LOW";
  if (mobile && cores <= 2) profile = "LOW";
  if (!mobile && cores >= 12 && (memoryGb === null || memoryGb >= 8)) profile = "ULTRA";
  return { profile: forced ?? profile, automatic: !forced, mobile, reducedMotion, cores, memoryGb, pixelRatio: devicePixelRatio };
}

export function setQualityOverride(profile: RuntimeQuality | "AUTO"): void {
  try {
    if (profile === "AUTO") localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, profile);
  } catch {
    // A preference is optional; denied storage must not prevent the diagnostics screen from working.
  }
}

/**
 * Maps the device profile onto the render quality tier used by the lighting rig, material library
 * and VFX budgets. Kept as one function so the four systems can never disagree about what "MEDIUM"
 * means — V4 decided quality independently in three places, twice from `window.innerWidth`.
 */
export function qualityForProfile(profile: RuntimeQuality): "LOW" | "MEDIUM" | "HIGH" | "ULTRA" {
  return profile;
}

export function getHardwareScalingLevel(profile: RuntimeQuality): number {
  const scale = QualityProfiles[profile].renderScale;
  return Math.max(1, Math.min(2.25, devicePixelRatio / Math.max(.55, scale * 1.35)));
}

export type FrameSnapshot = {
  fps: number;
  frameMs: number;
  p95Ms: number;
  p99Ms: number;
  worstMs: number;
  samples: number;
  stutters: number;
  longTasks: number;
  rating: "GOOD" | "LIMITED" | "POOR";
};

/** Rolling frame-pacing monitor. Average FPS alone deliberately is not the success metric. */
export class FrameMonitor {
  private readonly window = new Float32Array(600);
  private cursor = 0;
  private count = 0;
  private totalSamples = 0;
  private averageMs = 16.67;
  private worstMs = 0;
  private stutters = 0;
  private longTasks = 0;
  private observer: PerformanceObserver | null = null;

  constructor() {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      this.observer = new PerformanceObserver((list) => {
        this.longTasks += list.getEntries().filter((entry) => entry.duration >= 50).length;
      });
      this.observer.observe({ entryTypes: ["longtask"] });
    } catch {
      this.observer = null;
    }
  }

  record(frameMs: number): void {
    const sample = Math.max(0, Math.min(250, frameMs));
    this.averageMs = this.averageMs * 0.96 + sample * 0.04;
    this.window[this.cursor] = sample;
    this.cursor = (this.cursor + 1) % this.window.length;
    this.count = Math.min(this.window.length, this.count + 1);
    this.totalSamples += 1;
    this.worstMs = Math.max(this.worstMs, sample);
    if (sample > 40) this.stutters += 1;
  }

  resetTransient(): void {
    this.cursor = 0;
    this.count = 0;
    this.averageMs = 16.67;
  }

  snapshot(): FrameSnapshot {
    const samples = Array.from(this.window.subarray(0, this.count)).sort((a, b) => a - b);
    const frameMs = round(this.averageMs);
    const fps = Math.round(1_000 / Math.max(1, this.averageMs));
    return {
      fps,
      frameMs,
      p95Ms: round(atPercentile(samples, 0.95, frameMs)),
      p99Ms: round(atPercentile(samples, 0.99, frameMs)),
      worstMs: round(this.worstMs),
      samples: this.totalSamples,
      stutters: this.stutters,
      longTasks: this.longTasks,
      rating: fps >= 52 ? "GOOD" : fps >= 28 ? "LIMITED" : "POOR",
    };
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

function atPercentile(samples: number[], ratio: number, fallback: number): number {
  if (samples.length === 0) return fallback;
  return samples[Math.min(samples.length - 1, Math.ceil(samples.length * ratio) - 1)] ?? fallback;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
