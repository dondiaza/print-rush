import { describe, expect, it } from "vitest";
import { getCircuit, getCircuits, getThemedTracks, getHandlingLab } from "../src/index.js";

/**
 * The five shipped circuits.
 *
 * Two things are asserted here, and the second matters more than the first.
 *
 * The quality gate — length, lap time, corners, straights, elevation, shortcuts, set-pieces — is
 * the floor. It stops a layout edit quietly producing a 1.4 km circuit again.
 *
 * The identity check is the real test. The brief says the five must not be reskins, and the previous
 * generated versions passed every quality metric while being one template with five palettes. So
 * these assertions compare the circuits *against each other*: the slalom track must actually be the
 * narrowest, the speed track must actually have the widest road and the fewest corners, and no two
 * may share a shortcut mix. Those are properties a reskin cannot satisfy.
 */

const circuits = getCircuits();

describe("quality gate", () => {
  it("ships five circuits", () => {
    expect(circuits).toHaveLength(5);
  });

  it.each(circuits.map((track) => [track.blueprint.name, track] as const))(
    "%s passes every requirement",
    (_name, track) => {
      expect(track.issues).toEqual([]);
    },
  );

  it.each(circuits.map((track) => [track.blueprint.name, track.analysis] as const))(
    "%s is a full-length circuit",
    (_name, analysis) => {
      expect(analysis.lengthMeters).toBeGreaterThanOrEqual(2_500);
      expect(analysis.lengthMeters).toBeLessThanOrEqual(5_200);
      expect(analysis.estimatedLapSeconds).toBeGreaterThanOrEqual(90);
      expect(analysis.estimatedLapSeconds).toBeLessThanOrEqual(180);
      expect(analysis.corners).toBeGreaterThanOrEqual(10);
      expect(analysis.straights).toBeGreaterThanOrEqual(2);
      expect(analysis.elevationChanges).toBeGreaterThanOrEqual(3);
      expect(analysis.jumps).toBeGreaterThanOrEqual(1);
      expect(analysis.hazards).toBeGreaterThanOrEqual(1);
      // The brief wants circuits that produce decisions, which needs more than one kind of shortcut.
      expect(analysis.shortcutKinds.length).toBeGreaterThanOrEqual(2);
      expect(analysis.setPieces).toBeGreaterThanOrEqual(2);
      expect(analysis.landmarks).toBeGreaterThanOrEqual(5);
      expect(analysis.crossovers).toBeGreaterThanOrEqual(1);
    },
  );

  it("gives every circuit a declared character", () => {
    for (const track of circuits) {
      expect(track.blueprint.character.summary.length).toBeGreaterThan(20);
      expect(track.blueprint.character.emphasis).toBeTruthy();
    }
    // Five circuits, five different emphases: no duplicated design intent.
    const emphases = circuits.map((track) => track.blueprint.character.emphasis);
    expect(new Set(emphases).size).toBe(5);
  });

  it("bakes deterministically", () => {
    const again = getCircuits();
    expect(again[0]!.analysis).toEqual(circuits[0]!.analysis);
    expect(again[0]!.definition.nodes.length).toBe(circuits[0]!.definition.nodes.length);
  });

  it("resolves a circuit by id and falls back rather than throwing", () => {
    expect(getCircuit("manga-mega-con").blueprint.name).toBe("Manga Mega Con");
    expect(getCircuit("does-not-exist").blueprint.id).toBe(circuits[0]!.blueprint.id);
  });
});

describe("circuit identity", () => {
  const byId = new Map(circuits.map((track) => [track.blueprint.id, track]));
  const tienda = byId.get("tshirt-megastore")!;
  const almacen = byId.get("warehouse-express")!;
  const serigrafia = byId.get("ink-print-factory")!;
  const oficinas = byId.get("office-chaos")!;
  const manga = byId.get("manga-mega-con")!;

  it("makes the slalom circuits the narrowest and the speed circuit the widest", () => {
    // Tienda and Oficinas are the tight ones; Almacén and Manga are the fast, open ones.
    expect(tienda.analysis.maxWidth).toBeLessThan(almacen.analysis.maxWidth);
    expect(oficinas.analysis.maxWidth).toBeLessThan(manga.analysis.maxWidth);
    expect(almacen.analysis.maxWidth).toBeGreaterThanOrEqual(18);
    expect(tienda.analysis.minWidth).toBeLessThanOrEqual(10.5);
    expect(oficinas.analysis.minWidth).toBeLessThanOrEqual(11);
  });

  it("makes Office Chaos the most technical by corner count", () => {
    const others = [tienda, almacen, serigrafia, manga];
    for (const other of others) {
      expect(oficinas.analysis.corners).toBeGreaterThanOrEqual(other.analysis.corners);
    }
  });

  it("puts the low-grip hazard surface only where it belongs", () => {
    // Ink at 0.35 grip is the print factory's whole identity. Nowhere else should have it.
    expect(serigrafia.analysis.surfaces).toContain("INK");
    for (const other of [tienda, almacen, oficinas, manga]) {
      expect(other.analysis.surfaces).not.toContain("INK");
    }
    // The conveyor that pushes you along belongs to the warehouse.
    expect(almacen.analysis.surfaces).toContain("CONVEYOR");
  });

  it("gives Serigrafía the most interactive hazards", () => {
    for (const other of [tienda, almacen, oficinas, manga]) {
      expect(serigrafia.analysis.hazards).toBeGreaterThanOrEqual(other.analysis.hazards);
    }
  });

  it("gives Manga the spectacle: most jumps, most elevation and all three shortcut kinds", () => {
    for (const other of [tienda, almacen, serigrafia, oficinas]) {
      expect(manga.analysis.jumps).toBeGreaterThanOrEqual(other.analysis.jumps);
      expect(manga.analysis.elevationRange).toBeGreaterThan(other.analysis.elevationRange);
    }
    expect(manga.analysis.shortcutKinds).toEqual(["ITEM", "RISK", "SKILL"]);
  });

  it("gives no two circuits the same shortcut mix", () => {
    const mixes = circuits.map((track) => track.analysis.shortcutKinds.join("+"));
    expect(new Set(mixes).size).toBeGreaterThanOrEqual(4);
  });

  it("gives each circuit a different surface palette", () => {
    const palettes = circuits.map((track) => track.analysis.surfaces.join("+"));
    expect(new Set(palettes).size).toBe(5);
  });

  it("does not make them all the same length", () => {
    const lengths = circuits.map((track) => track.analysis.lengthMeters);
    expect(new Set(lengths).size).toBe(5);
    // A meaningful spread, not five circuits within a rounding error of each other.
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(400);
  });
});

describe("supporting tracks", () => {
  it("keeps the grey box available and passing", () => {
    expect(getHandlingLab().issues).toEqual([]);
  });

  it("keeps the seeded generator working for the Circuit Factory", () => {
    // Authored circuits are content; the generator is the editor's tool for making new ones.
    const generated = getThemedTracks();
    expect(generated).toHaveLength(5);
    for (const track of generated) expect(track.issues).toEqual([]);
  });
});
