export function clamp(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safe));
}

export function isHexColor(value: string): boolean { return /^#[0-9a-f]{6}$/i.test(value); }

export class SeededFactoryRandom {
  constructor(private state: number) { this.state >>>= 0; }
  next(): number { this.state = (this.state * 1664525 + 1013904223) >>> 0; return this.state / 4_294_967_296; }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
}

export function pick<T>(values: readonly T[], random: SeededFactoryRandom): T {
  return values[Math.min(values.length - 1, Math.floor(random.next() * values.length))]!;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function hashDefinition(value: unknown): string {
  const source = stable(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function serializeDefinition(value: unknown): string { return stable(value); }
