import type { GameInput } from "./types.js";

const clamp = (value: unknown, min: number, max: number): number => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(max, Math.max(min, numeric));
};

export function sanitizeInput(value: unknown): GameInput {
  const candidate = value && typeof value === "object" ? value as Partial<GameInput> : {};
  return {
    sequence: Math.max(0, Math.floor(clamp(candidate.sequence, 0, Number.MAX_SAFE_INTEGER))),
    steer: clamp(candidate.steer, -1, 1),
    throttle: clamp(candidate.throttle, 0, 1),
    brake: clamp(candidate.brake, 0, 1),
    drift: candidate.drift === true,
    useItem: candidate.useItem === true,
    respawn: candidate.respawn === true,
  };
}

export class InputRateLimiter {
  private windowStartedAt = 0;
  private count = 0;

  constructor(private readonly limit: number, private readonly windowMs = 1_000) {}

  accept(now: number): boolean {
    if (now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.limit;
  }
}
