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
  const forced = localStorage.getItem(STORAGE_KEY) as RuntimeQuality | null;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = matchMedia("(pointer: coarse)").matches || window.innerWidth < 760;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cores = nav.hardwareConcurrency || 4;
  const memoryGb = nav.deviceMemory ?? null;
  let profile: RuntimeQuality = "HIGH";
  if (mobile || cores <= 4 || (memoryGb !== null && memoryGb <= 4)) profile = "MEDIUM";
  if ((mobile && cores <= 4) || (memoryGb !== null && memoryGb <= 2)) profile = "LOW";
  if (!mobile && cores >= 12 && (memoryGb === null || memoryGb >= 8)) profile = "ULTRA";
  return { profile: forced ?? profile, automatic: !forced, mobile, reducedMotion, cores, memoryGb, pixelRatio: devicePixelRatio };
}

export function setQualityOverride(profile: RuntimeQuality | "AUTO"): void {
  if (profile === "AUTO") localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, profile);
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

export class FrameMonitor {
  private averageMs = 16.67;
  private samples = 0;
  record(frameMs: number): void { this.averageMs = this.averageMs * .96 + Math.min(100, frameMs) * .04; this.samples += 1; }
  snapshot(): { fps: number; frameMs: number; samples: number; rating: "GOOD" | "LIMITED" | "POOR" } {
    const frameMs = Math.round(this.averageMs * 10) / 10;
    const fps = Math.round(1000 / Math.max(1, this.averageMs));
    return { fps, frameMs, samples: this.samples, rating: fps >= 52 ? "GOOD" : fps >= 28 ? "LIMITED" : "POOR" };
  }
}
