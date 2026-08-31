import type { PropDefinition, PropKind } from "./types.js";
import { hashDefinition, pick, SeededFactoryRandom } from "./utils.js";

const kinds: readonly PropKind[] = ["BOX", "RACK", "TABLE", "SHELF", "SIGN", "BARRIER", "LAMP", "PLANT", "MACHINE", "CONVEYOR"];

export function generateProp(seed: number, forcedKind?: PropKind): PropDefinition {
  const random = new SeededFactoryRandom(seed);
  const kind = forcedKind ?? pick(kinds, random);
  const definition: PropDefinition = {
    schemaVersion: 1, generatorVersion: "1.0.0", id: "", kind, seed: seed >>> 0,
    palette: pick(["flagship", "factory", "warehouse"], random),
    width: random.range(.75, 2.4), height: random.range(.65, 3.2), depth: random.range(.55, 2.1),
    detail: Math.floor(random.range(1, 5)), collision: kind === "LAMP" || kind === "PLANT" ? "CYLINDER" : "BOX",
  };
  definition.id = `prop-${kind.toLowerCase()}-${hashDefinition(definition)}`;
  return definition;
}

export function createPropCatalog(count = 50, seed = 7301): PropDefinition[] {
  return Array.from({ length: count }, (_, index) => generateProp(seed + index * 97, kinds[index % kinds.length]));
}
