import type { Engine } from "@babylonjs/core";
import type { RuntimeQuality } from "@print-rush/3d-factory";
import { getDeviceReport, getHardwareScalingLevel, type DeviceReport } from "./PerformanceManager";

const AUTO_RECOMMENDATION_KEY = "print-rush.quality.auto.v1";
const ORDER: readonly RuntimeQuality[] = ["LOW", "MEDIUM", "HIGH", "ULTRA"];

type StoredRecommendation = {
  profile: RuntimeQuality;
  measuredAt: number;
};

/**
 * Selects quality once, before world construction, and only benchmarks during hidden warmup.
 *
 * Deep quality changes never happen while driving. A slow warmup may safely increase render scaling
 * for the current race and stores a tier recommendation for the next one; geometry density, shadow
 * topology and post effects stay immutable until the next load.
 */
export class QualityManager {
  readonly device: DeviceReport;
  readonly profile: RuntimeQuality;
  readonly hardwareScaling: number;

  private constructor(device: DeviceReport, profile: RuntimeQuality) {
    this.device = device;
    this.profile = profile;
    this.hardwareScaling = getHardwareScalingLevel(profile);
  }

  static select(): QualityManager {
    const device = getDeviceReport();
    let profile = device.profile;
    if (device.automatic) {
      const recommendation = readRecommendation();
      // Hardware and browsers move on. A month-old benchmark is evidence from another machine state.
      if (recommendation && Date.now() - recommendation.measuredAt < 30 * 24 * 60 * 60 * 1_000) {
        profile = recommendation.profile;
      }
    }
    return new QualityManager(device, profile);
  }

  /**
   * Applies the only safe same-race adaptation: a small resolution reduction before presentation.
   * Returns true when the engine buffers should be rendered once more before removing the loader.
   */
  commitWarmup(engine: Engine, frameTimes: readonly number[]): boolean {
    if (!this.device.automatic || frameTimes.length === 0) return false;
    const p75 = percentile(frameTimes, 0.75);
    const nextProfile = this.recommend(p75);
    writeRecommendation({ profile: nextProfile, measuredAt: Date.now() });

    if (p75 < 28) return false;
    const previous = engine.getHardwareScalingLevel();
    const next = Math.min(2.25, previous * (p75 >= 42 ? 1.16 : 1.08));
    if (next - previous < 0.03) return false;
    engine.setHardwareScalingLevel(next);
    return true;
  }

  private recommend(warmupMs: number): RuntimeQuality {
    const index = ORDER.indexOf(this.profile);
    if (warmupMs >= 42) return ORDER[Math.max(0, index - 1)]!;
    if (warmupMs >= 28 && (this.profile === "HIGH" || this.profile === "ULTRA")) {
      return ORDER[Math.max(0, index - 1)]!;
    }
    if (
      warmupMs <= 11
      && !this.device.mobile
      && this.device.cores >= 8
      && (this.device.memoryGb === null || this.device.memoryGb >= 8)
    ) {
      return ORDER[Math.min(ORDER.length - 1, index + 1)]!;
    }
    return this.profile;
  }
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 16.67;
}

function readRecommendation(): StoredRecommendation | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(AUTO_RECOMMENDATION_KEY) ?? "null") as Partial<StoredRecommendation> | null;
    if (!value || !ORDER.includes(value.profile as RuntimeQuality) || typeof value.measuredAt !== "number") return null;
    return value as StoredRecommendation;
  } catch {
    return null;
  }
}

function writeRecommendation(value: StoredRecommendation): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(AUTO_RECOMMENDATION_KEY, JSON.stringify(value));
  } catch {
    // Storage can be denied in private/embedded contexts. A benchmark preference is optional and
    // must never turn an otherwise ready race into a loading failure.
  }
}
