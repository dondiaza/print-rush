import { fill, intersect, outline, over, sdBox, sdCircle, sdPolygon, sdSegment, subtract, union } from "./shapes.mjs";
import { fbm, makeRandom } from "./noise.mjs";
import { hex, mixColor, scaleColor } from "./raster.mjs";

/**
 * Ambient 2.5D sprites: crowd, plants, hanging stock.
 *
 * The brief's reasoning here is the correct engineering call, so it is worth restating: a convention
 * hall needs to look full, and a hundred articulated characters is not how you make it look full. It
 * is how you make it run at twelve frames per second. A billboard sprite costs one quad.
 *
 * What was there before: the manga circuit's crowd was a lofted torso, an ellipsoid head and four
 * limbs — a real mesh, about 200 triangles each, which put a hard ceiling on how many could exist.
 * These sprites cost two triangles, so the stands can be genuinely crowded.
 *
 * Every figure is built from the same skeleton with varied clothing, hair, height, stance and
 * accessories, which is what stops a crowd reading as one person cloned. Two facings — front and
 * back — because a crowd seen from a kart is mostly looking at the track or away from it, and a
 * billboard that always faces the camera makes a side view look wrong rather than absent.
 *
 * All have alpha and a transparent margin, so nothing shows its own bounding rectangle. That is
 * asserted in the test suite, because a halo on a crowd sprite is the defect the brief names.
 */

const SKIN_TONES = ["#f0c8a8", "#e0a878", "#c98a5e", "#8d5a3b", "#6b4228", "#f7dcc0"].map(hex);
const HAIR_TONES = ["#2b2118", "#4a3423", "#6b4a2a", "#1b1622", "#8a6a3f", "#c9a45e", "#ff3da6", "#65d8ff"].map(hex);
const CLOTH_TONES = [
  "#ff3da6", "#65d8ff", "#b9ff45", "#ffd43b", "#8f5cff", "#ff6b2c",
  "#f7f2e8", "#2b2732", "#3e6e9e", "#4c7a4e", "#c9563f", "#e8dfd0",
].map(hex);

function layer(coverage, color) {
  return { r: color.r, g: color.g, b: color.b, a: coverage };
}

function stack(...layers) {
  let result = { r: 0, g: 0, b: 0, a: 0 };
  for (const item of layers) result = over(result, item);
  return result;
}

/**
 * One standing figure.
 *
 * `facing` is "front" or "back": the difference is the face and the hair's fall, which is all that
 * distinguishes them at the distance these are seen from. Everything else is shared, so the two
 * facings of one person are recognisably the same person.
 */
function figure({ seed, facing }) {
  const random = makeRandom(seed);
  const skin = SKIN_TONES[Math.floor(random() * SKIN_TONES.length)];
  const hair = HAIR_TONES[Math.floor(random() * HAIR_TONES.length)];
  const top = CLOTH_TONES[Math.floor(random() * CLOTH_TONES.length)];
  const bottom = CLOTH_TONES[Math.floor(random() * CLOTH_TONES.length)];

  // Proportions vary within adult range: height, build, and how wide the shoulders sit.
  const height = 0.88 + random() * 0.11;
  const build = 0.9 + random() * 0.25;
  const hairStyle = Math.floor(random() * 4);
  const hasBag = random() > 0.55;
  const hasCap = random() > 0.72;
  const armSwing = (random() - 0.5) * 0.05;
  const stance = (random() - 0.5) * 0.04;

  /**
    * Feet at 0.93, not 0.97.
    *
    * The legs are round-capped segments, so the silhouette extends half a leg-width *below* the
    * point the segment ends at. At 0.97 that put coverage at y = 0.994, which lands in the sprite's
    * last two rows — measured at 200 of alpha on the bottom edge, a hard-edged halo across the
    * whole crowd. The margin has to clear the cap, not the centreline.
    */
  const feet = 0.93;
  const headR = 0.058 * height;
  const headY = feet - 0.78 * height;
  const shoulderY = headY + headR * 1.9;
  const hipY = feet - 0.42 * height;

  return (x, y, s) => {
    const halfShoulder = 0.075 * build;
    const halfHip = 0.062 * build;

    // Torso as a tapered quad, so the silhouette is a body and not a rectangle.
    const torso = sdPolygon(x, y, [
      [0.5 - halfShoulder, shoulderY],
      [0.5 + halfShoulder, shoulderY],
      [0.5 + halfHip, hipY],
      [0.5 - halfHip, hipY],
    ]);
    const neck = sdBox(x, y, 0.5, headY + headR * 1.3, headR * 0.34, headR * 0.5, 0);
    const head = sdCircle(x, y, 0.5, headY, headR);

    // Arms hang beside the torso with a slight swing.
    const arms = union(
      sdSegment(x, y, 0.5 - halfShoulder * 0.9, shoulderY + 0.01, 0.5 - halfHip - 0.012 + armSwing, hipY + 0.05, 0.019 * build),
      sdSegment(x, y, 0.5 + halfShoulder * 0.9, shoulderY + 0.01, 0.5 + halfHip + 0.012 - armSwing, hipY + 0.05, 0.019 * build),
    );

    // Legs, with a small stance offset so nobody stands perfectly to attention.
    const legs = union(
      sdSegment(x, y, 0.5 - halfHip * 0.5, hipY, 0.5 - halfHip * 0.6 + stance, feet, 0.024 * build),
      sdSegment(x, y, 0.5 + halfHip * 0.5, hipY, 0.5 + halfHip * 0.6 + stance, feet, 0.024 * build),
    );

    // Hair: a cap over the skull, with a style-dependent fall.
    // `intersect` is max, so a point is inside only where both terms are negative. The half-plane
    // therefore has to be `y - c`, which is negative *above* the line. Writing `-(y - c)` keeps the
    // opposite half and puts the hair on the chin — which is exactly what it did.
    let hairShape = intersect(
      sdCircle(x, y, 0.5, headY - headR * 0.12, headR * 1.06),
      y - (headY + headR * 0.25),
    );
    if (hairStyle === 1) {
      // Long, falling past the shoulders.
      hairShape = union(hairShape, sdBox(x, y, 0.5, headY + headR * 1.1, headR * 0.95, headR * 1.2, headR * 0.5));
    } else if (hairStyle === 2) {
      // Tied back.
      hairShape = union(hairShape, sdCircle(x, y, 0.5 + (facing === "front" ? 0.055 : -0.055), headY + headR * 0.5, headR * 0.42));
    } else if (hairStyle === 3) {
      // Cropped, with a slightly squarer top.
      hairShape = intersect(sdBox(x, y, 0.5, headY - headR * 0.25, headR * 1.02, headR * 0.7, headR * 0.3), hairShape);
    }

    let result = stack(
      layer(fill(legs, s), bottom),
      layer(fill(arms, s), scaleColor(top, 0.94)),
      layer(fill(torso, s), top),
      layer(fill(neck, s), scaleColor(skin, 0.9)),
      layer(fill(head, s), skin),
      layer(fill(hairShape, s), hair),
    );

    // A cap, for some.
    if (hasCap) {
      const dome = intersect(sdCircle(x, y, 0.5, headY - headR * 0.15, headR * 1.1), y - headY);
      const peak = facing === "front"
        ? sdBox(x, y, 0.5, headY - headR * 0.05, headR * 1.35, headR * 0.16, headR * 0.1)
        : sdBox(x, y, 0.5, headY - headR * 0.1, headR * 1.1, headR * 0.14, headR * 0.1);
      result = over(result, layer(fill(union(dome, peak), s), CLOTH_TONES[(seed + 3) % CLOTH_TONES.length]));
    }

    // A bag strap and body, for some. Reads immediately as a convention attendee.
    if (hasBag) {
      const strap = sdSegment(x, y, 0.5 - halfShoulder * 0.7, shoulderY + 0.005, 0.5 + halfHip * 0.8, hipY - 0.02, 0.01);
      const bag = facing === "back"
        ? sdBox(x, y, 0.5, (shoulderY + hipY) / 2, halfShoulder * 0.72, (hipY - shoulderY) * 0.34, 0.014)
        : sdBox(x, y, 0.5 + halfHip + 0.012, hipY - 0.02, 0.022, 0.03, 0.008);
      const bagColor = CLOTH_TONES[(seed + 7) % CLOTH_TONES.length];
      result = over(result, layer(fill(strap, s), scaleColor(bagColor, 0.7)));
      result = over(result, layer(fill(bag, s), bagColor));
    }

    /**
      * What separates the two facings.
      *
      * A face is about ten pixels of a 192x320 sprite, so "front has eyes, back does not" made the
      * two frames all but identical — measured at a mean absolute difference of zero across a
      * sampled grid, which is sixteen frames doing the work of eight. The facings now differ where
      * the difference is actually visible at billboard distance: the garment.
      */
    if (facing === "front") {
      const eyes = union(
        sdCircle(x, y, 0.5 - headR * 0.34, headY + headR * 0.06, headR * 0.11),
        sdCircle(x, y, 0.5 + headR * 0.34, headY + headR * 0.06, headR * 0.11),
      );
      const mouth = sdBox(x, y, 0.5, headY + headR * 0.46, headR * 0.2, headR * 0.05, headR * 0.03);
      result = over(result, layer(fill(eyes, s), hex("#241d2b")));
      result = over(result, layer(fill(mouth, s), scaleColor(skin, 0.62)));
      // A print on the chest: the front of a t-shirt, which is what these people are wearing.
      const chest = sdBox(x, y, 0.5, (shoulderY + hipY) * 0.46, halfShoulder * 0.5, (hipY - shoulderY) * 0.16, 0.01);
      result = over(result, layer(fill(intersect(chest, torso), s), mixColor(top, hex("#f7f2e8"), 0.75)));
    } else {
      // Seen from behind: a yoke seam across the shoulders and hair that falls further down the
      // neck, which is what a back view of a person actually reads as.
      const yoke = sdBox(x, y, 0.5, shoulderY + (hipY - shoulderY) * 0.16, halfShoulder * 0.95, 0.006, 0.003);
      result = over(result, layer(fill(intersect(yoke, torso), s), scaleColor(top, 0.82)));
      const nape = intersect(
        sdBox(x, y, 0.5, headY + headR * 0.72, headR * 0.86, headR * 0.5, headR * 0.3),
        -(y - (headY + headR * 1.15)),
      );
      result = over(result, layer(fill(nape, s), scaleColor(hair, 0.92)));
    }

    /**
     * No contact shadow baked in.
     *
     * The first version drew one by squashing the y coordinate into a circle test, which was wrong
     * — it left up to 200 of alpha along the sprite's bottom edge, measured, which is precisely the
     * halo the brief calls out. A billboard's ground contact belongs to the scene anyway, where it
     * can respond to the actual light direction; the renderer puts a shadow disc under each one.
     */
    return result;
  };
}

/** A potted plant: pot, soil, and a spray of leaves. Alpha-cut, which is the whole point. */
function plant({ seed }) {
  const random = makeRandom(seed);
  const leafColor = [hex("#4c7a4e"), hex("#3f6b41"), hex("#5f8f4a"), hex("#2f5c3a")][Math.floor(random() * 4)];
  const potColor = [hex("#b98a57"), hex("#8a7f74"), hex("#f7f2e8"), hex("#2b2732")][Math.floor(random() * 4)];
  const blades = 7 + Math.floor(random() * 6);
  const spread = 0.24 + random() * 0.12;
  const tall = random() > 0.5;

  const leaves = Array.from({ length: blades }, (_, index) => {
    const t = (index / (blades - 1)) * 2 - 1;
    return {
      tipX: 0.5 + t * spread * (0.7 + random() * 0.6),
      tipY: (tall ? 0.12 : 0.28) + random() * 0.16,
      width: 0.022 + random() * 0.016,
      shade: 0.82 + random() * 0.36,
    };
  });

  return (x, y, s) => {
    const potTop = 0.7;
    const pot = sdPolygon(x, y, [
      [0.5 - 0.13, potTop],
      [0.5 + 0.13, potTop],
      [0.5 + 0.1, 0.95],
      [0.5 - 0.1, 0.95],
    ]);
    const rim = sdBox(x, y, 0.5, potTop, 0.14, 0.022, 0.008);
    const soil = sdBox(x, y, 0.5, potTop - 0.008, 0.115, 0.014, 0.006);

    let result = { r: 0, g: 0, b: 0, a: 0 };
    // Leaves behind the pot first, so the pot occludes their bases.
    for (const leaf of leaves) {
      const blade = sdPolygon(x, y, [
        [0.5 - leaf.width * 0.5, potTop - 0.01],
        [0.5 + leaf.width * 0.5, potTop - 0.01],
        [leaf.tipX, leaf.tipY],
      ]);
      result = over(result, layer(fill(blade, s), scaleColor(leafColor, leaf.shade)));
    }
    result = over(result, layer(fill(soil, s), hex("#3b2f26")));
    result = over(result, layer(fill(pot, s), potColor));
    result = over(result, layer(fill(rim, s), scaleColor(potColor, 1.12)));
    // A vertical shade on the pot, so it reads as round rather than as a flat trapezium.
    const shading = fill(pot, s) * Math.max(0, (x - 0.5) * 2.2);
    result = over(result, { r: 0, g: 0, b: 0, a: shading * 0.28 });
    return result;
  };
}

/** A shirt on a hanger, seen face on. For rails and wall displays. */
function hangingShirt({ seed, index = 0 }) {
  const random = makeRandom(seed);
  const cloth = CLOTH_TONES[Math.floor(random() * CLOTH_TONES.length)];
  const printColor = CLOTH_TONES[Math.floor(random() * CLOTH_TONES.length)];
  // By index, so a rail of six shows every print rather than whatever the dice gave.
  const motif = index % 3;
  // The silhouette varies too. Six garments that differ only in colour read as one garment
  // recoloured six times, which is the repetition the brief calls out.
  const sleeve = 0.34 + (index % 2) * 0.1;
  const bodyLength = 0.82 + (index % 3) * 0.05;

  return (x, y, s) => {
    const hookTop = 0.1;
    const hook = union(
      sdSegment(x, y, 0.5, hookTop + 0.04, 0.5, hookTop + 0.12, 0.008),
      outline(sdCircle(x, y, 0.5, hookTop + 0.03, 0.03), 0.008),
    );
    const bar = union(
      sdSegment(x, y, 0.5, hookTop + 0.12, 0.32, hookTop + 0.2, 0.01),
      sdSegment(x, y, 0.5, hookTop + 0.12, 0.68, hookTop + 0.2, 0.01),
    );
    // The garment: shoulders, sleeves, straight body.
    const shirt = sdPolygon(x, y, [
      [0.36, 0.26],
      [0.22, sleeve + 0.04],
      [0.29, sleeve + 0.14],
      [0.34, sleeve + 0.08],
      [0.34, bodyLength],
      [0.66, bodyLength],
      [0.66, sleeve + 0.08],
      [0.71, sleeve + 0.14],
      [0.78, sleeve + 0.04],
      [0.64, 0.26],
    ]);
    const collar = sdCircle(x, y, 0.5, 0.25, 0.055);

    let result = stack(
      layer(fill(union(hook, bar), s), hex("#b6bcc4")),
      layer(fill(subtract(shirt, collar), s), cloth),
    );

    // A print on the chest, from the same vocabulary as the printed fabric materials.
    let print;
    if (motif === 0) print = sdCircle(x, y, 0.5, 0.52, 0.1);
    else if (motif === 1) {
      print = union(sdSegment(x, y, 0.42, 0.44, 0.56, 0.56, 0.024), sdSegment(x, y, 0.56, 0.56, 0.44, 0.64, 0.024));
    } else {
      print = union(sdBox(x, y, 0.5, 0.5, 0.11, 0.02, 0.008), sdBox(x, y, 0.5, 0.57, 0.08, 0.02, 0.008));
    }
    result = over(result, layer(fill(intersect(print, shirt), s), printColor));

    // Fabric folds, as faint vertical shading. Without them a garment is a flat colour cut-out.
    const folds = fill(shirt, s) * (0.5 + fbm(x * 3, y, { octaves: 3, frequency: 9, seed }) * 0.5);
    result = over(result, { r: 0, g: 0, b: 0, a: folds * 0.14 });
    return result;
  };
}

export const SPRITE_FAMILIES = {
  /** Convention attendees, front and back. The manga hall's crowd. */
  crowd_attendee: {
    scope: "manga",
    count: 8,
    facings: ["front", "back"],
    size: { width: 192, height: 320 },
    build: ({ seed, facing }) => figure({ seed, facing }),
  },

  /** Shoppers, for the Megastore. Same skeleton, calmer palette drawn from the same list. */
  crowd_shopper: {
    scope: "store",
    count: 5,
    facings: ["front", "back"],
    size: { width: 192, height: 320 },
    build: ({ seed, facing }) => figure({ seed: seed + 977, facing }),
  },

  /** Potted plants: office and shop dressing, and the classic alpha-sprite case. */
  plant: {
    scope: "common",
    count: 5,
    facings: ["front"],
    size: { width: 256, height: 320 },
    build: ({ seed }) => plant({ seed }),
  },

  /**
   * Shirts on hangers, for rails and wall displays.
   *
   * Shared, not store-scoped. Three circuits hang these — the shop, the workshop where they come off
   * the press, and the convention stand — and a track-scoped asset is only ever downloaded for its
   * own circuit, so scoping it to the store meant two of the three referenced an atlas that could
   * never be resident. At 74 KB it is cheaper in the shared tier than the bug was.
   */
  hanging_shirt: {
    scope: "common",
    count: 6,
    facings: ["front"],
    size: { width: 256, height: 320 },
    build: ({ seed, index }) => hangingShirt({ seed, index }),
  },
};
