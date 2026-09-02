import { bakeTrack, type BakedTrack, type TrackBlueprint } from "../blueprint.js";
import { TrackPath } from "../path.js";

/**
 * HANDLING LAB — the grey box.
 *
 * The V5 brief gates everything behind one rule: the kart has to be fun on a grey circuit before a
 * single texture is written. This is that circuit. No art, no theme, no props — it exists so the
 * vehicle model can be judged on feel alone, and it stays in the build afterwards as the reference
 * circuit for any future handling change.
 *
 * Every corner archetype the brief lists appears once, in an order that lets each be read on its
 * own: fast sweeper, long straight, hairpin, linked S, double apex, chicane, banked corner, climb,
 * crossover, descent.
 *
 * Layout is a 380 x 320 m ring with an overpass excursion through the middle. Legs are authored to
 * explicit global poses so the loop closes exactly rather than being smoothed shut.
 */
function buildPath(): TrackPath {
  const path = new TrackPath({ x: 0, y: 0, z: 0, heading: 0 }, { width: 16, surface: "ASPHALT", sector: 1 });

  // -------------------------------------------------------------- S1 INTRO — read the car
  // Start / finish straight up the west side.
  path.straight(200, { note: "start-finish straight" });

  // -------------------------------------------------------------- S2 SPEED — top end and braking
  path.sector(2, { width: 18 });
  // Sweep into the north straight and run it flat out.
  path.driveTo({ x: 70, z: 300, heading: 90 }, 62, { note: "turn 1, fast entry" });
  path.straight(265, { note: "north straight" });
  // Long right-hand sweeper onto the east side.
  path.driveTo({ x: 370, z: 250, heading: 150 }, 120, { note: "sweeper" });
  path.set({ width: 15 });
  // Hairpin at the north-east corner, hardest braking point on the lap.
  path.driveTo({ x: 330, z: 205, heading: 340 }, 26, { note: "hairpin" });

  // -------------------------------------------------------------- S4 SET PIECE — climb and overpass
  path.sector(4, { width: 15 });
  // Ramp climbs west, crosses over the start straight at height, and spirals back down.
  path.driveTo({ x: 250, z: 250, heading: 270, y: 6 }, 48, { note: "ramp entry" });
  path.straight(180, { rise: 8, note: "climb over the infield" });
  path.spiral(-170, 44, 4, { banking: -0.16, note: "upper spiral" });
  path.straight(150, { rise: -2, note: "bridge over start straight" });
  path.spiral(170, 46, -5, { banking: 0.15, note: "descent spiral" });
  path.driveTo({ x: 300, z: 90, heading: 200, y: 0 }, 52, { note: "back to grade" });

  // -------------------------------------------------------------- S3 TECHNICAL — linked drifts
  path.sector(3, { width: 13 });
  // Linked S down the south side, then a double apex and a chicane.
  // The south side dips and climbs back out, so the lap has a compression as well as a crest.
  path.driveTo({ x: 230, z: 40, heading: 250, y: -4 }, 34, { note: "S entry, downhill" });
  path.driveTo({ x: 150, z: 70, heading: 290, y: 0 }, 34, { note: "S exit, uphill" });
  path.driveTo({ x: 95, z: 35, heading: 235 }, 40, { note: "double apex 1" });
  path.driveTo({ x: 60, z: 60, heading: 300 }, 28, { note: "double apex 2" });
  path.chicane(9, 70, 1, { note: "chicane" });

  // -------------------------------------------------------------- S5 CLIMAX — banked run to the line
  path.sector(5, { width: 17 });
  path.set({ banking: 0.2 });

  return path;
}

export const HandlingLabBlueprint: TrackBlueprint = (() => {
  const path = buildPath();
  // The final banked sweep back onto the start line is the closing join itself.
  path.closeWithArcs(58, { note: "banked climax" });
  return {
    schemaVersion: 5,
    id: "handling-lab",
    name: "Handling Lab",
    theme: "GREYBOX",
    recommendedLaps: 3,
    character: {
      summary: "Circuito gris de referencia. Cada arquetipo de curva aparece una vez.",
      emphasis: "TECHNICAL",
    },
    controlPoints: path.build(),
    sectors: [
      { index: 1, name: "Read", role: "INTRO" },
      { index: 2, name: "Top End", role: "SPEED" },
      { index: 3, name: "Linked", role: "TECHNICAL" },
      { index: 4, name: "Overpass", role: "SET_PIECE" },
      { index: 5, name: "Banked Run", role: "CLIMAX" },
    ],
    features: [
      { kind: "LANDMARK", progress: 0.02, side: 1, label: "START" },
      { kind: "LANDMARK", progress: 0.2, side: -1, label: "SWEEPER" },
      { kind: "LANDMARK", progress: 0.3, side: 1, label: "HAIRPIN" },
      { kind: "LANDMARK", progress: 0.46, side: -1, label: "RAMP" },
      { kind: "LANDMARK", progress: 0.56, side: 1, label: "BRIDGE" },
      { kind: "LANDMARK", progress: 0.78, side: -1, label: "ESSES" },
      { kind: "LANDMARK", progress: 0.94, side: 1, label: "BANKING" },
      { kind: "BOOST", progress: 0.14, lane: 0 },
      { kind: "BOOST", progress: 0.5, lane: 0 },
      { kind: "BOOST", progress: 0.88, lane: 0 },
      { kind: "JUMP", progress: 0.6, lane: 0, power: 1 },
      { kind: "ITEM_ROW", progress: 0.08, lanes: [-4, 0, 4] },
      { kind: "ITEM_ROW", progress: 0.4, lanes: [-4, 0, 4] },
      { kind: "ITEM_ROW", progress: 0.72, lanes: [-4, 0, 4] },
      { kind: "SHORTCUT", from: 0.76, to: 0.82, risk: "MEDIUM", access: "SKILL", label: "Corte interior" },
      // A proving ground should also let impact response and a risk line be judged, not only grip.
      { kind: "SHORTCUT", from: 0.36, to: 0.41, risk: "HIGH", access: "RISK", label: "Corte de riesgo" },
      { kind: "HAZARD", progress: 0.28, lane: 0, hazard: "PRESS" },
      { kind: "HAZARD", progress: 0.68, lane: -4, hazard: "FALLING_BOXES" },
      { kind: "SET_PIECE", progress: 0.48, label: "Ramp and spiral" },
      { kind: "SET_PIECE", progress: 0.56, label: "Bridge crossover" },
    ],
  };
})();

let cached: BakedTrack | null = null;

export function getHandlingLab(): BakedTrack {
  cached ??= bakeTrack(HandlingLabBlueprint);
  return cached;
}

/** Exposed so the handling page can report how tightly the authored loop closes. */
export function handlingLabClosure(): { planar: number; vertical: number; heading: number } {
  const path = buildPath();
  path.closeWithArcs(58);
  return path.closureError();
}
