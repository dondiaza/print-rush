import { describe, expect, it } from "vitest";
import { ThemeLightingZones, zonesForTheme } from "@/render/LightingRig";

/**
 * THE GRADE.
 *
 * One number in this table was responsible for the report that "background elements come out
 * half-invisible" and "there are parts where things disappear", and it was the fog density. The
 * scene runs `FOGMODE_EXP2`, whose visibility falls off as `exp(-(distance * density)^2)`, and the
 * authored densities went up to 0.013 — which is 18% visibility at a hundred metres and effectively
 * nothing at a hundred and fifty, against a camera far plane of nine hundred. Every spectator,
 * poster and prop past the next corner was being deleted by the atmosphere, and no amount of work on
 * the assets themselves could have shown up while that was true.
 *
 * It is worth a test rather than a comment because it is invisible in review: a fog density is a
 * small number in a long line of small numbers, and the failure it causes looks like missing content
 * rather than like a lighting mistake. So the assertions below are written in terms of what a player
 * can see, not in terms of the constants.
 */

/** Babylon's EXP2 fog: the fraction of a surface's own colour still visible at `metres`. */
const visibility = (density: number, metres: number) => Math.exp(-((metres * density) ** 2));

const everyZone = Object.entries(ThemeLightingZones).flatMap(([theme, zones]) =>
  zones.map((zone) => [`${theme} / ${zone.name}`, zone] as const),
);

describe("fog is atmosphere, not a curtain", () => {
  it.each(everyZone)("%s keeps the far side of the circuit visible", (_label, zone) => {
    // 300 m is roughly the diagonal of a circuit: the grandstand across the infield, the gantry two
    // corners ahead. Those have to read as distant, not as absent.
    expect(visibility(zone.fogDensity, 300)).toBeGreaterThan(0.6);
    // 700 m is where the ground plane ends and the backdrop begins. Still hazy, still there.
    expect(visibility(zone.fogDensity, 700)).toBeGreaterThan(0.1);
  });

  it.each(everyZone)("%s still hazes near enough to give depth", (_label, zone) => {
    // The opposite failure: fog turned off entirely flattens the scene into a cut-out. Every zone
    // must take a measurable bite out of something 500 m away.
    expect(visibility(zone.fogDensity, 500)).toBeLessThan(0.995);
  });
});

describe("nothing in the frame is unlit", () => {
  it.each(everyZone)("%s fills the shadow side", (_label, zone) => {
    /**
     * The second half of the restyling. A kart racer models form with hue — warm key against cool
     * fill — rather than with darkness, because the player is reading the track at speed and cannot
     * afford a dark side of anything. At the authored ratios (fill 0.34 against a key of 3.0) every
     * surface facing away from the key light fell to near-black.
     */
    expect(zone.fillIntensity / zone.keyIntensity).toBeGreaterThan(0.2);
  });

  it.each(everyZone)("%s is bright enough to read", (_label, zone) => {
    // No zone may be the gloomy one any more. Relative differences survive — a stairwell is still
    // darker than a shop window — but the floor is a floor.
    expect(zone.keyIntensity).toBeGreaterThanOrEqual(2.1);
    // ACES needs headroom. The visual QA pass found that forcing every zone to 1+ erased the
    // material separation in the bright retail/office worlds, despite looking "safe" numerically.
    expect(zone.exposure).toBeGreaterThanOrEqual(0.85);
    expect(zone.exposure).toBeLessThanOrEqual(1.25);
    expect(zone.environment).toBeGreaterThanOrEqual(0.45);
  });
});

describe("the table itself", () => {
  it("gives every circuit theme its own zones", () => {
    for (const theme of ["FLAGSHIP", "WAREHOUSE", "PRINT_FACTORY", "OFFICE", "MANGA"]) {
      expect(ThemeLightingZones[theme], theme).toBeDefined();
      expect(zonesForTheme(theme)).toBe(ThemeLightingZones[theme]);
    }
    // An unknown theme falls back rather than crashing a race.
    expect(zonesForTheme("NOT_A_THEME")).toBe(ThemeLightingZones.FLAGSHIP);
  });

  it("orders each theme's zones around the lap and starts at the line", () => {
    for (const [theme, zones] of Object.entries(ThemeLightingZones)) {
      expect(zones[0]!.from, theme).toBe(0);
      for (let index = 1; index < zones.length; index += 1) {
        expect(zones[index]!.from, `${theme} zone ${index}`).toBeGreaterThan(zones[index - 1]!.from);
        expect(zones[index]!.from).toBeLessThan(1);
      }
    }
  });

  it("keeps each theme's zones distinguishable from one another", () => {
    // The restyling lifted every zone, and the risk in doing that uniformly is that the lap stops
    // being a journey through different spaces. Each theme must still have a real spread of light.
    for (const [theme, zones] of Object.entries(ThemeLightingZones)) {
      const keys = zones.map((zone) => zone.keyIntensity);
      expect(Math.max(...keys) - Math.min(...keys), theme).toBeGreaterThan(0.4);
      const colors = new Set(zones.map((zone) => zone.keyColor));
      expect(colors.size, `${theme} key colours`).toBe(zones.length);
    }
  });
});
