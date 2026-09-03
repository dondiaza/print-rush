import { describe, expect, it } from "vitest";
import { placementFor } from "@/factory/facePlacement";
import type { FaceLandmark } from "@/factory/faceDetection";

/**
 * AUTOMATIC FACE FRAMING.
 *
 * The framing is three numbers — zoom, rotation, offset — derived from where the landmarks say the
 * face is, and they are only correct relative to the transform `FaceCropper` actually paints with:
 *
 * ```
 * translate(size/2, size/2); rotate(rotation);
 * drawImage(image, -w*scale/2 + offset.x*size, -h*scale/2 + offset.y*size, w*scale, h*scale)
 * where scale = size / min(w, h) * zoom
 * ```
 *
 * So the assertions below do not check the three numbers against numbers I chose. They **replay that
 * transform** and check where the face lands on the card. That is the only claim that matters, and
 * it is the one a plausible-looking derivation can fail: the offset is applied along the image's own
 * axes *inside* the rotated frame, so rotation must not enter the offset maths — get that wrong and
 * the face slides off centre in proportion to how tilted the head was, which is invisible on a level
 * photograph and obvious on every other one.
 */

/** The landmark indices `placementFor` reads. Everything else can be zero. */
const INDICES = {
  foreheadTop: 10,
  chin: 152,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  leftCheekInner: 123,
  rightCheekInner: 352,
  rightCheek: 454,
} as const;

/**
 * A synthetic face, in normalised image coordinates.
 *
 * `centre` is the midpoint between forehead and chin, `height` is the forehead-to-chin distance as a
 * fraction of the image height, and `tiltDegrees` rolls the eye line. Built rather than captured so
 * the expected answer is known exactly — a real photograph's landmarks would make every assertion
 * here a tolerance around a number nobody could derive.
 */
function face(options: {
  centre?: { x: number; y: number };
  height?: number;
  tiltDegrees?: number;
  eyeSpan?: number;
}): FaceLandmark[] {
  const centre = options.centre ?? { x: 0.5, y: 0.5 };
  const height = options.height ?? 0.4;
  const tilt = ((options.tiltDegrees ?? 0) * Math.PI) / 180;
  const eyeSpan = options.eyeSpan ?? 0.16;

  const landmarks: FaceLandmark[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (index: number, x: number, y: number) => {
    landmarks[index] = { x, y, z: 0 };
  };

  set(INDICES.foreheadTop, centre.x, centre.y - height / 2);
  set(INDICES.chin, centre.x, centre.y + height / 2);
  // The eye line, rolled about the face's centre.
  const half = eyeSpan / 2;
  set(INDICES.leftEyeOuter, centre.x - half * Math.cos(tilt), centre.y - half * Math.sin(tilt));
  set(INDICES.rightEyeOuter, centre.x + half * Math.cos(tilt), centre.y + half * Math.sin(tilt));
  set(INDICES.leftCheekInner, centre.x - half * 0.7, centre.y);
  set(INDICES.rightCheekInner, centre.x + half * 0.7, centre.y);
  set(INDICES.rightCheek, centre.x + half, centre.y);
  return landmarks;
}

/**
 * Replays `FaceCropper.paint` and reports where a point of the image lands on the card.
 *
 * Returned in card units where the card is 1 × 1 and its centre is (0.5, 0.5), so an assertion reads
 * as "the face is in the middle of the card" rather than as pixels.
 */
function onCard(
  point: { x: number; y: number },
  placement: { zoom: number; rotation: number; offset: { x: number; y: number } },
  width: number,
  height: number,
): { x: number; y: number } {
  const size = 1;
  const scale = (size / Math.min(width, height)) * placement.zoom;
  // Inside the rotated frame, relative to the frame's centre.
  const localX = -width * scale / 2 + placement.offset.x * size + point.x * width * scale;
  const localY = -height * scale / 2 + placement.offset.y * size + point.y * height * scale;
  // Then the frame's own rotation, about that centre.
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: 0.5 + localX * cos - localY * sin,
    y: 0.5 + localX * sin + localY * cos,
  };
}

describe("the face lands in the middle of the card", () => {
  it.each([
    ["centred, square", { centre: { x: 0.5, y: 0.5 } }, 1000, 1000],
    ["off to one side", { centre: { x: 0.28, y: 0.44 } }, 1000, 1000],
    ["landscape photo", { centre: { x: 0.62, y: 0.5 } }, 1600, 900],
    ["portrait photo", { centre: { x: 0.5, y: 0.34 } }, 900, 1600],
    ["small face in a group shot", { centre: { x: 0.4, y: 0.42 }, height: 0.12 }, 1600, 1200],
  ])("%s", (_label, options, width, height) => {
    const landmarks = face(options);
    const placement = placementFor(landmarks, width, height);
    const centre = {
      x: (landmarks[INDICES.foreheadTop]!.x + landmarks[INDICES.chin]!.x) / 2,
      y: (landmarks[INDICES.foreheadTop]!.y + landmarks[INDICES.chin]!.y) / 2,
    };
    const landed = onCard(centre, placement, width, height);
    // Horizontally dead centre; vertically a touch above, by the deliberate lift that puts the eyes
    // on the upper third rather than in the middle of the card.
    expect(landed.x).toBeCloseTo(0.5, 2);
    expect(landed.y).toBeGreaterThan(0.5);
    expect(landed.y).toBeLessThan(0.62);
  });
});

describe("the head comes out level", () => {
  it.each([-32, -14, 0, 9, 25])("cancels a tilt of %i degrees", (tilt) => {
    const width = 1200;
    const height = 900;
    const landmarks = face({ tiltDegrees: tilt });
    const placement = placementFor(landmarks, width, height);

    const left = onCard(landmarks[INDICES.leftEyeOuter]!, placement, width, height);
    const right = onCard(landmarks[INDICES.rightEyeOuter]!, placement, width, height);
    // The eye line on the card, in degrees. Level to within a fifth of a degree.
    const residual = (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI;
    expect(Math.abs(residual)).toBeLessThan(0.2);
  });

  it("does not let the offset drift with the tilt", () => {
    /**
     * The specific mistake this guards against.
     *
     * If the offset were computed in unrotated image space, a level face would centre correctly and
     * a tilted one would be pushed off by an amount proportional to the tilt. Comparing the same face
     * at four tilts is what makes that visible; a single level test case cannot see it at all.
     */
    const width = 1400;
    const height = 1000;
    const centre = { x: 0.37, y: 0.41 };
    const placements = [0, 12, -20, 33].map((tilt) =>
      placementFor(face({ centre, tiltDegrees: tilt }), width, height),
    );
    /**
     * Asserted on the offset itself, not on where the face lands.
     *
     * The first version of this test checked that the face centre landed in the same place at every
     * tilt, and it failed — correctly, and for a reason that is not a bug. `VERTICAL_LIFT` puts the
     * *lifted* point at the card's centre, so the face's true centre sits a little below it, and a
     * point off the centre of rotation necessarily moves when the frame rotates. The claim worth
     * making is the narrower one: the offset is computed without reference to the rotation.
     */
    for (const placement of placements) {
      expect(placement.offset.x).toBeCloseTo(placements[0]!.offset.x, 6);
      expect(placement.offset.y).toBeCloseTo(placements[0]!.offset.y, 6);
      expect(placement.zoom).toBeCloseTo(placements[0]!.zoom, 6);
    }
  });
});

describe("the face fills the card", () => {
  it("scales a small face up and a large face down", () => {
    // A face occupying an eighth of the frame and one occupying two thirds must both come out at the
    // same size on the card. Without this the styling pass's oval mask either clips a chin or floats
    // a small head in the middle of a large card.
    const heights = [0.12, 0.28, 0.45, 0.66];
    const spans = heights.map((height) => {
      const landmarks = face({ height });
      const placement = placementFor(landmarks, 1200, 1200);
      const top = onCard(landmarks[INDICES.foreheadTop]!, placement, 1200, 1200);
      const bottom = onCard(landmarks[INDICES.chin]!, placement, 1200, 1200);
      return Math.hypot(bottom.x - top.x, bottom.y - top.y);
    });
    for (const span of spans) {
      expect(span).toBeCloseTo(0.72, 2);
    }
  });

  it("clamps the zoom rather than producing a framing that cannot be dragged back", () => {
    // A detection that comes out as nonsense — a face reported as one pixel tall — must not produce
    // a zoom of six thousand. The manual controls have to be able to reach whatever this returns.
    const tiny = placementFor(face({ height: 0.0001 }), 1000, 1000);
    expect(tiny.zoom).toBeLessThanOrEqual(8);
    const huge = placementFor(face({ height: 4 }), 1000, 1000);
    expect(huge.zoom).toBeGreaterThanOrEqual(0.4);
  });
});

describe("a face at the edge of the photograph", () => {
  it("reports that it could not be centred", () => {
    // The offset is clamped to ±0.5 so the photograph can never be dragged out of the frame, which
    // means a face right against an edge cannot be centred. That is worth telling the player before
    // they save a card with half a head in it — so it is reported rather than silently clamped.
    const edge = placementFor(face({ centre: { x: 0.03, y: 0.5 }, height: 0.5 }), 1000, 1000);
    expect(edge.clampedOffset).toBe(true);

    const middle = placementFor(face({ centre: { x: 0.5, y: 0.5 } }), 1000, 1000);
    expect(middle.clampedOffset).toBe(false);
  });
});
