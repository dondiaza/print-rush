import { describe, expect, it } from "vitest";
import {
  AssetRegistry, CharacterPresets, HairLibrary, characterComplexityScore, createDefaultCharacter, createDefaultKart,
  createPropCatalog, hashDefinition, migrateCharacter, randomCharacter, randomKart, serializeDefinition, validateCharacter, validateKart,
} from "../src/index.js";

describe("3D Factory determinism", () => {
  it("generates identical characters and karts from equal seeds", () => {
    expect(randomCharacter(994)).toEqual(randomCharacter(994));
    expect(randomKart(221)).toEqual(randomKart(221));
    expect(hashDefinition(randomCharacter(994))).toBe(hashDefinition(randomCharacter(994)));
  });
  it("serializes keys in stable order", () => {
    expect(serializeDefinition({ b: 2, a: 1 })).toBe(serializeDefinition({ a: 1, b: 2 }));
  });
});

describe("definition validation", () => {
  it("accepts shipped presets and exposes 30 hairstyles", () => {
    expect(CharacterPresets).toHaveLength(8);
    expect(HairLibrary).toHaveLength(30);
    expect(CharacterPresets.every((preset) => validateCharacter(preset).every((issue) => issue.severity !== "ERROR"))).toBe(true);
  });
  it("rejects unsafe colors and normalizes old definitions", () => {
    const character = createDefaultCharacter();
    character.face.skinTone = "red";
    expect(validateCharacter(character).some((issue) => issue.path === "face.skinTone")).toBe(true);
    expect(migrateCharacter({ schemaVersion: 1, id: "old", name: "Legacy" }).schemaVersion).toBe(2);
  });
  it("validates kart compatibility", () => {
    const kart = createDefaultKart();
    kart.number = 700;
    expect(validateKart(kart).some((issue) => issue.path === "number")).toBe(true);
  });
});

describe("content systems", () => {
  it("creates 50 deterministic styled props", () => {
    const first = createPropCatalog();
    expect(first).toHaveLength(50);
    expect(first).toEqual(createPropCatalog());
    expect(new Set(first.map((prop) => prop.kind)).size).toBe(10);
  });
  it("registers versioned assets by definition hash", () => {
    const registry = new AssetRegistry();
    const asset = registry.register({ id: "a", type: "CHARACTER", name: "A", version: 1, published: true, definition: createDefaultCharacter() });
    expect(registry.get("a")?.hash).toBe(asset.hash);
    expect(registry.list("CHARACTER")).toHaveLength(1);
  });
  it("assigns a measurable runtime complexity", () => {
    expect(characterComplexityScore(createDefaultCharacter())).toBeGreaterThanOrEqual(1);
  });
});
