import type { SurfaceName } from "./config.js";
import type { TrackControlPoint } from "./blueprint.js";
import { dubins, type DubinsPath } from "./dubins.js";

/**
 * Turtle-graphics circuit authoring.
 *
 * Hand-placing forty 3D control points per circuit is unworkable and produces unreadable diffs.
 * Instead a designer drives a cursor: go straight 120 m, sweep 90 degrees left over a 40 m radius,
 * climb 9 m while turning, drop into a hairpin. The cursor emits control points as it moves and the
 * baker turns those into a spline.
 *
 * This is what makes a 3 km circuit with crossovers something a person can actually write down and
 * later adjust after a playtest.
 */

export type PathAttributes = {
  width?: number;
  banking?: number;
  surface?: SurfaceName;
  sector?: number;
  wallLeft?: boolean;
  wallRight?: boolean;
  note?: string;
};

const DEG = Math.PI / 180;

export class TrackPath {
  private x: number;
  private z: number;
  private y: number;
  /** Heading in radians, measured the same way as kart rotation: 0 is +Z, positive turns toward +X. */
  private heading: number;
  private readonly points: TrackControlPoint[] = [];
  private attributes: Required<Omit<PathAttributes, "note">>;
  private readonly startPose: { x: number; y: number; z: number; heading: number };

  constructor(start: { x?: number; y?: number; z?: number; heading?: number } = {}, defaults: PathAttributes = {}) {
    this.x = start.x ?? 0;
    this.y = start.y ?? 0;
    this.z = start.z ?? 0;
    this.heading = (start.heading ?? 0) * DEG;
    this.startPose = { x: this.x, y: this.y, z: this.z, heading: this.heading };
    this.attributes = {
      width: defaults.width ?? 14,
      banking: defaults.banking ?? 0,
      surface: defaults.surface ?? "ASPHALT",
      sector: defaults.sector ?? 1,
      wallLeft: defaults.wallLeft ?? true,
      wallRight: defaults.wallRight ?? true,
    };
    this.emit(defaults.note);
  }

  /** Changes the attributes applied to every point emitted from here on. */
  set(attributes: PathAttributes): this {
    this.attributes = { ...this.attributes, ...stripUndefined(attributes) };
    return this;
  }

  /** Opens a new sector. Sectors follow the space, so this is called where the space changes. */
  sector(index: number, attributes: PathAttributes = {}): this {
    return this.set({ ...attributes, sector: index });
  }

  private emit(note?: string): void {
    this.points.push({
      x: round(this.x),
      y: round(this.y),
      z: round(this.z),
      width: this.attributes.width,
      banking: this.attributes.banking,
      surface: this.attributes.surface,
      sector: this.attributes.sector,
      wallLeft: this.attributes.wallLeft,
      wallRight: this.attributes.wallRight,
      ...(note ? { note } : {}),
    });
  }

  private advance(distance: number, rise: number): void {
    this.x += Math.sin(this.heading) * distance;
    this.z += Math.cos(this.heading) * distance;
    this.y += rise;
  }

  /** Straight run. `rise` is the total height gained over the run. */
  straight(length: number, options: PathAttributes & { rise?: number; steps?: number } = {}): this {
    const { rise = 0, steps, ...attributes } = options;
    if (Object.keys(attributes).length > 0) this.set(attributes);
    // One control point per 30 m keeps long straights from bowing under Catmull-Rom.
    const count = steps ?? Math.max(1, Math.round(length / 30));
    for (let step = 0; step < count; step += 1) {
      this.advance(length / count, rise / count);
      this.emit(step === count - 1 ? attributes.note : undefined);
    }
    return this;
  }

  /**
   * Circular arc. Positive `degrees` turns right (toward +X from +Z), negative turns left.
   * `radius` is the centreline radius in metres.
   */
  turn(degrees: number, radius: number, options: PathAttributes & { rise?: number; steps?: number } = {}): this {
    const { rise = 0, steps, ...attributes } = options;
    if (Object.keys(attributes).length > 0) this.set(attributes);
    const total = degrees * DEG;
    // Roughly one point every 12 degrees, and never fewer than three across an arc.
    const count = steps ?? Math.max(3, Math.round(Math.abs(degrees) / 12));
    const stepAngle = total / count;
    const chord = 2 * radius * Math.sin(Math.abs(stepAngle) / 2);
    for (let step = 0; step < count; step += 1) {
      this.heading += stepAngle / 2;
      this.advance(chord, rise / count);
      this.heading += stepAngle / 2;
      this.emit(step === count - 1 ? attributes.note : undefined);
    }
    return this;
  }

  /** A left-right-left sequence at a given amplitude. The classic drift-chaining shape. */
  chicane(amplitude: number, length: number, direction: -1 | 1 = 1, options: PathAttributes = {}): this {
    const angle = Math.atan2(amplitude, length / 2) / DEG;
    const radius = Math.max(18, length / 4);
    this.turn(angle * direction, radius, options);
    this.turn(-angle * 2 * direction, radius);
    this.turn(angle * direction, radius);
    return this;
  }

  /** Hairpin: a tight 180 with a short entry and exit, optionally banked. */
  hairpin(radius: number, direction: -1 | 1 = 1, options: PathAttributes & { rise?: number } = {}): this {
    return this.turn(180 * direction, radius, { banking: 0.14 * direction, ...options });
  }

  /** Helical climb or descent. Used for ramps between floors without a long straight. */
  spiral(degrees: number, radius: number, rise: number, options: PathAttributes = {}): this {
    return this.turn(degrees, radius, { ...options, rise, steps: Math.max(6, Math.round(Math.abs(degrees) / 10)) });
  }

  /** Current cursor pose. Useful when placing a second floor above a known point. */
  pose(): { x: number; y: number; z: number; heading: number } {
    return { x: this.x, y: this.y, z: this.z, heading: (this.heading / DEG) % 360 };
  }

  /**
   * Joins the cursor back to the start pose with a cubic Hermite, so the loop closes smoothly
   * instead of leaving a kink at the finish line. Returns the finished control points.
   */
  close(options: PathAttributes & { tension?: number; steps?: number } = {}): TrackControlPoint[] {
    const { tension, steps = 8, ...attributes } = options;
    if (Object.keys(attributes).length > 0) this.set(attributes);

    const gap = Math.hypot(this.startPose.x - this.x, this.startPose.z - this.z);
    const strength = tension ?? Math.max(gap * 0.42, 12);

    const p0 = { x: this.x, y: this.y, z: this.z };
    const p1 = { x: this.startPose.x, y: this.startPose.y, z: this.startPose.z };
    const m0 = { x: Math.sin(this.heading) * strength, y: 0, z: Math.cos(this.heading) * strength };
    const m1 = {
      x: Math.sin(this.startPose.heading) * strength,
      y: 0,
      z: Math.cos(this.startPose.heading) * strength,
    };

    for (let step = 1; step <= steps; step += 1) {
      const t = step / (steps + 1);
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      this.x = h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x;
      this.y = h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y;
      this.z = h00 * p0.z + h10 * m0.z + h01 * p1.z + h11 * m1.z;
      this.emit();
    }
    return this.points;
  }

  /**
   * Drives the cursor to an exact pose using a Dubins join — two arcs of `radius` with a straight
   * between them. This is the workhorse of circuit authoring: it gives global control ("be at the
   * top-right corner of the building heading west") while still producing real corners and real
   * straights, and every leg lands exactly where it was asked to.
   */
  driveTo(
    target: { x: number; z: number; heading: number; y?: number },
    radius = 60,
    options: PathAttributes & { maxArcDegrees?: number } = {},
  ): DubinsPath | null {
    const { maxArcDegrees = 150, ...attributes } = options;
    if (Object.keys(attributes).length > 0) this.set(attributes);
    const goalHeading = target.heading * DEG;
    const from = { x: this.x, z: this.z, heading: this.heading };
    const to = { x: target.x, z: target.z, heading: goalHeading };

    /**
     * The shortest Dubins path is not always the best-driving one: when the target sits inside the
     * turning circle, the shortest solution loops right around, which reads as an unintended
     * 400-degree spiral rather than a corner. So candidates are scored rather than just measured —
     * length plus a penalty for arcs beyond `maxArcDegrees` — across a small spread of radii.
     */
    let join: DubinsPath | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const attempt of [radius * 0.6, radius * 0.8, radius, radius * 1.3, radius * 1.7]) {
      const candidate = dubins(from, to, attempt);
      if (!candidate) continue;
      const worstArc = Math.max(
        ...candidate.segments.map((segment) => (segment.kind === "ARC" ? Math.abs(segment.degrees) : 0)),
      );
      const score = candidate.length + Math.max(0, worstArc - maxArcDegrees) * 12;
      if (score < bestScore) {
        bestScore = score;
        join = candidate;
      }
    }
    if (!join) return null;

    const rise = (target.y ?? this.y) - this.y;
    const total = join.length || 1;
    for (const segment of join.segments) {
      if (segment.length < 0.5) continue;
      const share = (segment.length / total) * rise;
      if (segment.kind === "STRAIGHT") this.straight(segment.length, { rise: share });
      else this.turn(segment.degrees, segment.radius, { rise: share });
    }
    // Absorb the sub-centimetre residue from rounding so successive legs never accumulate drift.
    this.x = target.x;
    this.z = target.z;
    this.y = target.y ?? this.y;
    this.heading = goalHeading;
    return join;
  }

  /**
   * Closes the loop exactly using a Dubins join: two arcs of `radius` and a straight between them.
   * Unlike `close()`, the result is made of real corners and a real straight, so the return leg is
   * drivable track rather than a smoothing artefact. Returns the join it used so the caller can
   * report it.
   */
  closeWithArcs(radius = 55, options: PathAttributes = {}): { points: TrackControlPoint[]; join: DubinsPath | null } {
    if (Object.keys(options).length > 0) this.set(options);
    const join = dubins(
      { x: this.x, z: this.z, heading: this.heading },
      { x: this.startPose.x, z: this.startPose.z, heading: this.startPose.heading },
      radius,
    );
    if (!join) return { points: this.points, join: null };

    // Spread any residual height difference across the join so it lands level with the start line.
    const rise = this.startPose.y - this.y;
    const totalLength = join.length || 1;
    for (const segment of join.segments) {
      const share = (segment.length / totalLength) * rise;
      if (segment.length < 0.5) continue;
      if (segment.kind === "STRAIGHT") this.straight(segment.length, { rise: share });
      else this.turn(segment.degrees, segment.radius, { rise: share });
    }
    return { points: this.points, join };
  }

  /** Control points without closing. For circuits authored to meet their own start exactly. */
  build(): TrackControlPoint[] {
    return this.points;
  }

  /** Distance and height error between the cursor and the start. A good circuit closes tight. */
  closureError(): { planar: number; vertical: number; heading: number } {
    let headingError = ((this.heading - this.startPose.heading) / DEG) % 360;
    if (headingError > 180) headingError -= 360;
    if (headingError < -180) headingError += 360;
    return {
      planar: Number(Math.hypot(this.startPose.x - this.x, this.startPose.z - this.z).toFixed(1)),
      vertical: Number((this.startPose.y - this.y).toFixed(2)),
      heading: Number(headingError.toFixed(1)),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
