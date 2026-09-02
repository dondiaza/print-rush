/**
 * Dubins joins for track authoring.
 *
 * Driving a cursor around a circuit gives excellent local control over corner shapes, but nothing
 * guarantees the cursor arrives back where it started — the first grey-box attempt closed 717 m and
 * 20 degrees away from its own start line, and a quarter of the lap became auto-generated filler.
 *
 * A Dubins path is the shortest curve joining two poses using only arcs of a fixed radius and
 * straight lines. Using one for the return leg means the designer authors the interesting 80 % of a
 * circuit and the join is exact, made of real corners and a real straight, with a radius they pick.
 *
 * Heading convention matches the rest of the codebase: direction is `(sin h, cos h)`, and a positive
 * turn is to the right.
 */

export type Pose = { x: number; z: number; heading: number };

export type DubinsSegment =
  | { kind: "ARC"; degrees: number; radius: number; length: number }
  | { kind: "STRAIGHT"; length: number };

export type DubinsPath = { type: "RSR" | "LSL" | "RSL" | "LSR"; segments: DubinsSegment[]; length: number };

const TAU = Math.PI * 2;

/** Right-hand normal of a heading: the direction the turn centre lies in for a right turn. */
function rightVector(heading: number): { x: number; z: number } {
  return { x: Math.cos(heading), z: -Math.sin(heading) };
}

/** Amount of right turn needed to get from `from` to `to`, always in [0, 2pi). */
function rightTurn(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta < 0) delta += TAU;
  return delta;
}

function leftTurn(from: number, to: number): number {
  return rightTurn(to, from);
}

function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/**
 * Solves the four same-radius Dubins families and returns the shortest valid one.
 * `radius` is the arc radius in metres for both turns.
 */
export function dubins(start: Pose, goal: Pose, radius: number): DubinsPath | null {
  const candidates: DubinsPath[] = [];
  const r = Math.max(1, radius);

  const startRight = rightVector(start.heading);
  const goalRight = rightVector(goal.heading);
  const centres = {
    startR: { x: start.x + startRight.x * r, z: start.z + startRight.z * r },
    startL: { x: start.x - startRight.x * r, z: start.z - startRight.z * r },
    goalR: { x: goal.x + goalRight.x * r, z: goal.z + goalRight.z * r },
    goalL: { x: goal.x - goalRight.x * r, z: goal.z - goalRight.z * r },
  };

  // ---------------------------------------------------------------- RSR: external tangent
  {
    const dx = centres.goalR.x - centres.startR.x;
    const dz = centres.goalR.z - centres.startR.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 1e-6) {
      const straightHeading = headingOf(dx, dz);
      const first = rightTurn(start.heading, straightHeading);
      const second = rightTurn(straightHeading, goal.heading);
      candidates.push(arcStraightArc("RSR", first, distance, second, r, 1));
    }
  }

  // ---------------------------------------------------------------- LSL: external tangent
  {
    const dx = centres.goalL.x - centres.startL.x;
    const dz = centres.goalL.z - centres.startL.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 1e-6) {
      const straightHeading = headingOf(dx, dz);
      const first = leftTurn(start.heading, straightHeading);
      const second = leftTurn(straightHeading, goal.heading);
      candidates.push(arcStraightArc("LSL", first, distance, second, r, -1));
    }
  }

  // ---------------------------------------------------------------- RSL: internal tangent
  {
    const dx = centres.goalL.x - centres.startR.x;
    const dz = centres.goalL.z - centres.startR.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= 2 * r) {
      const straight = Math.sqrt(distance * distance - 4 * r * r);
      const centreHeading = headingOf(dx, dz);
      // The tangent leaves the first circle offset by the angle subtended by the 2r separation.
      const offset = Math.atan2(2 * r, straight);
      const straightHeading = centreHeading + offset;
      const first = rightTurn(start.heading, straightHeading);
      const second = leftTurn(straightHeading, goal.heading);
      candidates.push({
        type: "RSL",
        segments: [
          { kind: "ARC", degrees: toDegrees(first), radius: r, length: first * r },
          { kind: "STRAIGHT", length: straight },
          { kind: "ARC", degrees: -toDegrees(second), radius: r, length: second * r },
        ],
        length: first * r + straight + second * r,
      });
    }
  }

  // ---------------------------------------------------------------- LSR: internal tangent
  {
    const dx = centres.goalR.x - centres.startL.x;
    const dz = centres.goalR.z - centres.startL.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= 2 * r) {
      const straight = Math.sqrt(distance * distance - 4 * r * r);
      const centreHeading = headingOf(dx, dz);
      const offset = Math.atan2(2 * r, straight);
      const straightHeading = centreHeading - offset;
      const first = leftTurn(start.heading, straightHeading);
      const second = rightTurn(straightHeading, goal.heading);
      candidates.push({
        type: "LSR",
        segments: [
          { kind: "ARC", degrees: -toDegrees(first), radius: r, length: first * r },
          { kind: "STRAIGHT", length: straight },
          { kind: "ARC", degrees: toDegrees(second), radius: r, length: second * r },
        ],
        length: first * r + straight + second * r,
      });
    }
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => (candidate.length < best.length ? candidate : best));
}

function arcStraightArc(
  type: "RSR" | "LSL",
  first: number,
  straight: number,
  second: number,
  radius: number,
  sign: 1 | -1,
): DubinsPath {
  return {
    type,
    segments: [
      { kind: "ARC", degrees: sign * toDegrees(first), radius, length: first * radius },
      { kind: "STRAIGHT", length: straight },
      { kind: "ARC", degrees: sign * toDegrees(second), radius, length: second * radius },
    ],
    length: first * radius + straight + second * radius,
  };
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}
