import { NullEngine, Scene } from "@babylonjs/core";
import { KartPresets, CharacterPresets, KartDefinition } from "@print-rush/3d-factory";
import { beforeAll, describe, expect, it } from "vitest";
import { animateKart, buildKart } from "@/render/KartBuilder";
import { animateCharacter, buildCharacter } from "@/render/CharacterBuilder";

/**
 * Assembly tests for the kart and the driver.
 *
 * These are the two most complex procedural assemblies in the project and the two most visible
 * objects on screen. A mistake in either — a station with a NaN, a merge that drops a group, a wheel
 * baked onto the wrong axis — produces a silently wrong render rather than an error, and there is no
 * way to catch that from a typecheck.
 *
 * Every assertion here is about something that would be a visible defect: the kart being the wrong
 * size, wheels not rolling, the steering wheel not turning, suspension not compressing, the driver
 * having no eyelids to blink with.
 */

let scene: Scene;

beforeAll(() => {
  scene = new Scene(new NullEngine());
});

function bounds(nodeName: string, meshes: ReturnType<Scene["getMeshByName"]>[]) {
  void nodeName;
  void meshes;
}

describe("kart assembly", () => {
  it("builds every group and lands close to the art bible's 2.9 x 1.9 x 1.4 m", () => {
    const visual = buildKart(scene, KartPresets[0]!, "kart-a", "HIGH");
    const meshes = visual.root.getChildMeshes(false);
    expect(meshes.length).toBeGreaterThan(4);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo({});
      const box = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, box.minimumWorld.x);
      maxX = Math.max(maxX, box.maximumWorld.x);
      minY = Math.min(minY, box.minimumWorld.y);
      maxY = Math.max(maxY, box.maximumWorld.y);
      minZ = Math.min(minZ, box.minimumWorld.z);
      maxZ = Math.max(maxZ, box.maximumWorld.z);
    }

    // Length and width to the art bible's kart scale; height allows for the roll bar and antenna.
    expect(maxZ - minZ).toBeGreaterThan(2.6);
    expect(maxZ - minZ).toBeLessThan(4.2);
    expect(maxX - minX).toBeGreaterThan(1.6);
    expect(maxX - minX).toBeLessThan(2.6);
    // The kart must sit on the ground, not float or sink.
    expect(minY).toBeGreaterThan(-0.15);
    expect(minY).toBeLessThan(0.2);
    expect(maxY).toBeLessThan(2.2);
  });

  it("produces four wheels tagged front and rear on both sides", () => {
    const visual = buildKart(scene, KartPresets[0]!, "kart-b", "HIGH");
    expect(visual.wheels).toHaveLength(4);

    const tags = visual.wheels.map((wheel) => wheel.metadata as { front: boolean; side: number; restY: number });
    expect(tags.filter((tag) => tag.front)).toHaveLength(2);
    expect(tags.filter((tag) => !tag.front)).toHaveLength(2);
    expect(new Set(tags.map((tag) => `${tag.front}|${tag.side}`)).size).toBe(4);
    for (const tag of tags) expect(tag.restY).toBeGreaterThan(0);
  });

  it("rolls, steers and compresses when animated", () => {
    const visual = buildKart(scene, KartPresets[0]!, "kart-c", "HIGH");
    const front = visual.wheels.find((wheel) => (wheel.metadata as { front: boolean }).front)!;
    const rear = visual.wheels.find((wheel) => !(wheel.metadata as { front: boolean }).front)!;
    const restY = (rear.metadata as { restY: number }).restY;

    animateKart(visual, 1.5, 0.8, 0);
    // The wheel spins about X, which is the axle after the wheel is baked onto it.
    expect(front.rotation.x).toBeCloseTo(1.5, 5);
    // Only the front wheels steer.
    expect(Math.abs(front.rotation.y)).toBeGreaterThan(0.2);
    expect(rear.rotation.y).toBe(0);
    // The steering wheel turns further than the wheels, and the opposite way in screen terms.
    expect(Math.abs(visual.steeringWheel!.rotation.y)).toBeGreaterThan(Math.abs(front.rotation.y));

    animateKart(visual, 1.5, 0, 1);
    expect(rear.position.y).toBeLessThan(restY);
  });

  it("builds at every quality tier without failing", () => {
    for (const quality of ["LOW", "MEDIUM", "HIGH", "ULTRA"] as const) {
      const visual = buildKart(scene, KartPresets[0]!, `kart-q-${quality}`, quality);
      expect(visual.wheels).toHaveLength(4);
    }
  });

  it("builds every body, wheel, rim, spoiler and antenna variant", () => {
    const bodies: KartDefinition["body"][] = ["CLASSIC", "PACKAGE", "SPRINT", "ROLLER", "INK_TANK"];
    const wheels: KartDefinition["wheel"][] = ["CLASSIC", "CHUNKY", "SLICK", "OFFROAD", "ROLLER"];
    const rims: KartDefinition["rim"][] = ["DISC", "FIVE_SPOKE", "STAR", "INK_SPLAT"];
    const spoilers: KartDefinition["spoiler"][] = ["NONE", "LOW", "WING", "DOUBLE"];
    const antennas: KartDefinition["antenna"][] = ["NONE", "BALL", "SHIRT", "FLAG"];

    // Every combination the schema allows has to build; a variant nobody tested is a variant that
    // crashes the race the first time a player equips it.
    let built = 0;
    for (let index = 0; index < 5; index += 1) {
      const definition: KartDefinition = {
        ...KartPresets[0]!,
        body: bodies[index]!,
        wheel: wheels[index]!,
        rim: rims[index % rims.length]!,
        spoiler: spoilers[index % spoilers.length]!,
        antenna: antennas[index % antennas.length]!,
      };
      const visual = buildKart(scene, definition, `kart-v-${index}`, "MEDIUM");
      expect(visual.wheels).toHaveLength(4);
      built += 1;
    }
    expect(built).toBe(5);
  });

  it("shares materials between karts of the same finish", () => {
    // A fresh scene, because the palette cache is per-scene and the other tests have warmed it.
    const isolated = new Scene(new NullEngine());

    const before = isolated.materials.length;
    buildKart(isolated, KartPresets[0]!, "kart-share-1", "MEDIUM");
    const afterFirst = isolated.materials.length;
    expect(afterFirst, "the first kart creates its palette").toBeGreaterThan(before);

    buildKart(isolated, KartPresets[0]!, "kart-share-2", "MEDIUM");
    // The second kart must add nothing: the art bible caps the race scene at 40 unique materials,
    // and four detailed karts would otherwise consume most of that budget on their own.
    expect(isolated.materials.length).toBe(afterFirst);

    // A different finish is a different palette and is allowed to add one.
    buildKart(isolated, { ...KartPresets[0]!, finish: "MATTE" }, "kart-share-3", "MEDIUM");
    expect(isolated.materials.length).toBeGreaterThan(afterFirst);
  });
});

describe("character assembly", () => {
  it("stands roughly 1.7 m tall with its feet on the ground", () => {
    const visual = buildCharacter(scene, CharacterPresets[0]!, "char-a", { pose: "STANDING", quality: "HIGH" });
    const meshes = visual.root.getChildMeshes(false);
    expect(meshes.length).toBeGreaterThan(3);

    let minY = Infinity;
    let maxY = -Infinity;
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo({});
      const box = mesh.getBoundingInfo().boundingBox;
      minY = Math.min(minY, box.minimumWorld.y);
      maxY = Math.max(maxY, box.maximumWorld.y);
    }
    expect(maxY).toBeGreaterThan(1.4);
    expect(maxY).toBeLessThan(2.1);
    expect(minY).toBeGreaterThan(-0.25);
  });

  it("has an eyelid mesh above LOW, and drops it at LOW as a real level of detail", () => {
    const detailed = buildCharacter(scene, CharacterPresets[0]!, "char-b", { quality: "HIGH" });
    // Both lids are merged into one mesh: they always blink together, so a second draw buys nothing.
    expect(detailed.eyelids).toHaveLength(1);
    // The lid moves by a recorded travel distance, because merging baked its transform away.
    expect((detailed.eyelids[0]!.metadata as { travel: number }).travel).toBeGreaterThan(0);

    // At LOW the driver is a distant opponent on a phone; the blink is invisible and is dropped,
    // which is what makes the tier cheaper rather than merely lower-poly.
    const cheap = buildCharacter(scene, CharacterPresets[0]!, "char-b-low", { quality: "LOW" });
    expect(cheap.eyelids).toHaveLength(0);
  });

  it("moves head, spine, arms and eyelids when animated", () => {
    const visual = buildCharacter(scene, CharacterPresets[0]!, "char-c", { quality: "HIGH" });
    const lid = visual.eyelids[0]!;

    animateCharacter(visual, { steer: 1, lean: 0.3, time: 0 });
    expect(visual.head.rotation.y).toBeGreaterThan(0.2);
    expect(visual.spine.rotation.z).toBeGreaterThan(0.1);
    expect(visual.leftArm.rotation.x).not.toBe(visual.rightArm.rotation.x);

    // Find a moment in the blink cycle where the lid is closed, to prove the clock drives it.
    let closedAt = -1;
    for (let step = 0; step < 4_000; step += 1) {
      animateCharacter(visual, { steer: 0, lean: 0, time: step * 0.01 });
      if (lid.position.y < 0) {
        closedAt = step;
        break;
      }
    }
    expect(closedAt, "the driver blinks within 40 seconds").toBeGreaterThan(-1);
  });

  it("builds all three poses and every quality tier", () => {
    for (const pose of ["STANDING", "DRIVING", "CELEBRATE"] as const) {
      for (const quality of ["LOW", "MEDIUM", "HIGH", "ULTRA"] as const) {
        const visual = buildCharacter(scene, CharacterPresets[0]!, `char-${pose}-${quality}`, { pose, quality });
        expect(visual.root.getChildMeshes(false).length).toBeGreaterThan(3);
        expect(visual.eyelids).toHaveLength(quality === "LOW" ? 0 : 1);
      }
    }
  });

  it("builds every shipped character preset", () => {
    for (const [index, preset] of CharacterPresets.entries()) {
      const visual = buildCharacter(scene, preset, `char-preset-${index}`, { quality: "MEDIUM" });
      expect(visual.root.getChildMeshes(false).length).toBeGreaterThan(3);
    }
  });
});

void bounds;
