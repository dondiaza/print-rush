import { Sprite, SpriteManager, Vector3, type Scene } from "@babylonjs/core";
import type { AssetCatalog } from "./AssetCatalog";

/**
 * CROWD SPRITES.
 *
 * Billboarded people, drawn from a grid atlas in one draw call.
 *
 * The circuit that needs this is the convention hall, and the arithmetic is the whole argument: the
 * existing `CROWD` prop is a lofted torso, an ellipsoid head and four limb segments — roughly 200
 * triangles and one draw call each. Two hundred spectators that way is 40,000 triangles and 200
 * draw calls, which is more than the entire rest of the scene. The same two hundred as sprites is
 * 400 triangles and *one* draw call.
 *
 * The 3D crowd prop stays, at low weight, for the figures nearest the track — where a flat sprite
 * would be caught out. That is the art bible's three scales of detail applied to people: modelled
 * up close, sprites for the mass, nothing at all beyond the point where a person is two pixels.
 */

export type Crowd = {
  /** Manifest ids in use, for the asset report. */
  usedAssetIds: string[];
  count: number;
  dispose: () => void;
};

/**
 * Per-quality budgets.
 *
 * `LOW` was zero, which was the wrong call twice over: a whole crowd is *one* draw call through the
 * sprite manager, so it is close to the cheapest content in the scene, and an empty grandstand is
 * far more noticeable than a thinner one. Fewer people on a small device, not none.
 */
const BUDGET: Record<string, number> = { LOW: 40, MEDIUM: 90, HIGH: 160, ULTRA: 260 };

/** Which family dresses which theme. Absent means this circuit has no ambient crowd. */
const FAMILY_BY_THEME: Record<string, string> = {
  MANGA: "crowd_attendee",
  FLAGSHIP: "crowd_shopper",
};

/**
 * Non-people sprite dressing, per theme.
 *
 * Plants and hanging stock are the textbook alpha-sprite case: a fern silhouette is most of what
 * makes it a fern, and modelling one costs hundreds of triangles for a shape a cut-out gives away
 * for free. They go through the same sprite manager as the crowd, so the whole ambient layer of a
 * circuit is a couple of draw calls.
 *
 * `spread` is how far back from the barrier a family sits: plants line the edge of the track,
 * garments hang further back where a rail would be.
 */
const DRESSING_BY_THEME: Record<
  string,
  Array<{ family: string; count: number; height: number; spread: [number, number] }>
> = {
  FLAGSHIP: [
    { family: "hanging_shirt", count: 30, height: 1.5, spread: [5, 11] },
    { family: "plant", count: 12, height: 1.1, spread: [3, 6] },
  ],
  OFFICE: [{ family: "plant", count: 22, height: 1.25, spread: [3, 7] }],
  MANGA: [{ family: "hanging_shirt", count: 16, height: 1.5, spread: [6, 12] }],
  PRINT_FACTORY: [{ family: "hanging_shirt", count: 20, height: 1.5, spread: [4, 9] }],
};

/**
 * Places a crowd.
 *
 * `sample` returns a point beside the track at a given lap fraction and lateral offset, so the
 * crowd follows the circuit instead of a bounding box — spectators inside a wall are worse than no
 * spectators. `random` is the track's seeded generator, so a circuit's crowd is always the same
 * crowd and a screenshot is reproducible.
 */
export function createCrowd(
  scene: Scene,
  theme: string,
  quality: string,
  catalog: AssetCatalog | null,
  random: () => number,
  sample: (fraction: number, offset: number) => Vector3 | null,
): Crowd {
  const family = FAMILY_BY_THEME[theme];
  const budget = BUDGET[quality] ?? 0;
  if (!family || budget === 0 || !catalog) {
    return { usedAssetIds: [], count: 0, dispose: () => {} };
  }

  const asset = catalog.get(`sprite_${family}_atlas`);
  const url = asset ? catalog.url(asset.id) : null;
  if (!asset || !url || !asset.grid) {
    return { usedAssetIds: [], count: 0, dispose: () => {} };
  }

  const { cellWidth, cellHeight, count: cells } = asset.grid;
  const manager = new SpriteManager(
    `crowd-${family}`,
    url,
    budget,
    { width: cellWidth, height: cellHeight },
    scene,
  );
  // A crowd is background: it must never write depth over the track or cast a shadow, and it must
  // not be pickable — the items system raycasts, and a spectator is not a target.
  manager.isPickable = false;
  manager.texture.hasAlpha = true;
  manager.texture.getAlphaFromRGB = false;
  /**
   * Fogged with everything else.
   *
   * This was off, which was defensible when the fog was thick enough to erase a spectator whole —
   * but it left the crowd as the one thing in the scene at full contrast at any distance, so the
   * far grandstand read as a decal pasted over the picture. Now that the fog is a light haze rather
   * than a curtain (see `ThemeLightingZones`), letting it touch the crowd is what puts the crowd
   * *in* the world.
   *
   * Babylon's sprite renderer does an alpha-tested depth pre-pass and then a blended colour pass, so
   * a hundred sprites still sort correctly against each other — the flicker this flag used to be
   * blamed for was never the fog's doing.
   */
  manager.fogEnabled = true;

  const sprites: Sprite[] = [];
  for (let index = 0; index < budget; index += 1) {
    // Spread around the lap, then jittered, so the crowd is uneven the way a real one is.
    const fraction = (index / budget + random() * 0.02) % 1;
    // Standing back from the barrier, in two loose ranks.
    const side = random() > 0.5 ? 1 : -1;
    const offset = side * (7 + random() * 9);
    const position = sample(fraction, offset);
    if (!position) continue;

    const sprite = new Sprite(`crowd-${index}`, manager);
    // Adult range, and the sprite's own art is drawn to fill its cell to the feet.
    const height = 1.62 + random() * 0.26;
    sprite.width = (height * cellWidth) / cellHeight;
    sprite.height = height;
    sprite.position = new Vector3(position.x, position.y + height / 2, position.z);
    sprite.cellIndex = Math.floor(random() * cells);
    // A little variation in brightness, so identical cells beside each other still differ.
    const shade = 0.82 + random() * 0.28;
    sprite.color.set(shade, shade, shade, 1);
    sprites.push(sprite);
  }

  return {
    usedAssetIds: sprites.length > 0 ? [asset.id] : [],
    count: sprites.length,
    dispose: () => {
      sprites.forEach((sprite) => sprite.dispose());
      manager.dispose();
    },
  };
}

/**
 * Places the non-people sprite dressing for a theme.
 *
 * Returns the same shape as the crowd so the caller disposes one thing, and for the same reason:
 * plants and garments are not people, but they are the same rendering problem.
 */
export function createSpriteDressing(
  scene: Scene,
  theme: string,
  quality: string,
  catalog: AssetCatalog | null,
  random: () => number,
  sample: (fraction: number, offset: number) => Vector3 | null,
): Crowd {
  const families = DRESSING_BY_THEME[theme] ?? [];
  // Scaled down on a small device rather than switched off, for the same reason as the crowd: this
  // is one draw call per family and the plants are what make a corner look like a place.
  const factor = quality === "LOW" ? 0.4 : quality === "MEDIUM" ? 0.7 : quality === "ULTRA" ? 1.3 : 1;
  if (!catalog || families.length === 0) {
    return { usedAssetIds: [], count: 0, dispose: () => {} };
  }

  const managers: SpriteManager[] = [];
  const sprites: Sprite[] = [];
  const usedAssetIds: string[] = [];

  for (const entry of families) {
    const asset = catalog.get(`sprite_${entry.family}_atlas`);
    const url = asset ? catalog.url(asset.id) : null;
    if (!asset || !url || !asset.grid) continue;

    const total = Math.round(entry.count * factor);
    if (total === 0) continue;

    const manager = new SpriteManager(
      `dressing-${entry.family}`,
      url,
      total,
      { width: asset.grid.cellWidth, height: asset.grid.cellHeight },
      scene,
    );
    manager.isPickable = false;
    manager.texture.hasAlpha = true;
    // Fogged, as the crowd is, and for the same reason.
    manager.fogEnabled = true;
    managers.push(manager);
    usedAssetIds.push(asset.id);

    const [near, far] = entry.spread;
    for (let index = 0; index < total; index += 1) {
      const fraction = (index / total + random() * 0.03) % 1;
      const side = random() > 0.5 ? 1 : -1;
      const position = sample(fraction, side * (near + random() * (far - near)));
      if (!position) continue;

      const sprite = new Sprite(`${entry.family}-${index}`, manager);
      const height = entry.height * (0.88 + random() * 0.28);
      sprite.width = (height * asset.grid.cellWidth) / asset.grid.cellHeight;
      sprite.height = height;
      // Garments hang from a rail; plants stand on the floor.
      const lift = entry.family === "hanging_shirt" ? 1.15 : 0;
      sprite.position = new Vector3(position.x, position.y + lift + height / 2, position.z);
      sprite.cellIndex = Math.floor(random() * asset.grid.count);
      const shade = 0.86 + random() * 0.24;
      sprite.color.set(shade, shade, shade, 1);
      sprites.push(sprite);
    }
  }

  return {
    usedAssetIds,
    count: sprites.length,
    dispose: () => {
      sprites.forEach((sprite) => sprite.dispose());
      managers.forEach((manager) => manager.dispose());
    },
  };
}
