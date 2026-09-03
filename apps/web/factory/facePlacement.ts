/**
 * AUTOMATIC FACE FRAMING.
 *
 * The studio's face pipeline had a hole in the middle of it, and the hole was the shape of the two
 * halves not talking to each other.
 *
 * One half — `FaceAvatarAnalyzer` — runs MediaPipe's Face Landmarker over a photograph, gets 478
 * points, and uses them to *sculpt the mesh* in the legacy garage. It knows exactly where the eyes,
 * nose, mouth and jaw are.
 *
 * The other half — `FaceCropper` plus `server/faceStyle` — takes a square crop and turns it into a
 * styled face card for the persistent studio. It produces the thing that actually appears on the
 * character's head, and it starts from *"the photo covering the frame, centred"*: a framing that has
 * no idea where the face is.
 *
 * So a player uploading a photograph was asked to do by hand — pan, zoom, level the tilt — what the
 * project could already measure to within a pixel. The brief asks for detection, cropping, centring,
 * orientation correction and normalisation; four of those five were sitting in a file the studio
 * never called.
 *
 * This is that call. It returns the framing the cropper should *open at*, not a framing it is forced
 * into: a detection can be wrong, a photo can have four faces in it, and the manual controls stay
 * exactly as they were. What changes is that the common case — one person, looking at the camera —
 * needs no adjustment at all.
 *
 * It also samples the skin, which matters more than it sounds. The styled face is a card projected in
 * front of the skull, so the neck, ears and hands around it are the mesh's own colour: get the skin
 * tone from the character's slot palette and a photographed face sits on a stranger's body. Sampling
 * the cheeks is what makes the join stop being the thing you notice.
 */

import { detectFaceLandmarks, type FaceLandmark } from "./faceDetection";

/** How the cropper should frame the photograph. Matches its `zoom` / `rotation` / `offset` state. */
export type FacePlacement = {
  zoom: number;
  /** Degrees. Positive rotates the image clockwise, as the cropper's canvas does. */
  rotation: number;
  offset: { x: number; y: number };
};

export type FaceDetection = {
  placement: FacePlacement;
  /** `#rrggbb` sampled from the cheeks, for the mesh's skin so the card and the body agree. */
  skinTone: string;
  /** How many faces were found. More than one is a warning, not a failure. */
  faceCount: number;
  warnings: string[];
};

/**
 * How much of the frame's height the face itself should fill.
 *
 * Measured forehead-top to chin, so the remaining 28% is hair above and jaw-to-neck below. Tighter
 * than that and the styling pass's oval mask clips the chin; looser and the face is a small island in
 * the middle of a large card, which is exactly the "photo pasted on a sphere" look to avoid.
 */
const FACE_HEIGHT_FRACTION = 0.72;

/**
 * The frame's centre, as a fraction of the face's own height above the forehead-to-chin midpoint.
 *
 * Faces are not centred on their own bounding box: the interesting half is the top, and the styling
 * mask is an oval whose widest point sits at the cheekbones. Lifting the frame by a tenth of the face
 * height puts the eyes on the upper third, which is where the cropper's own guides draw them.
 */
const VERTICAL_LIFT = 0.1;

/** MediaPipe landmark indices. Named, because `point(454)` is unreadable at the call site. */
const LM = {
  foreheadTop: 10,
  chin: 152,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  leftCheek: 234,
  rightCheek: 454,
  leftCheekInner: 123,
  rightCheekInner: 352,
} as const;

/**
 * Detects the face and works out how to frame it.
 *
 * Never throws for a photograph the model simply does not like: a face that cannot be found returns
 * `null` and the cropper opens at its old default, which is a worse experience than automatic
 * framing and a much better one than an error. It throws only for a file that cannot be decoded at
 * all, which is a different problem and one the caller has to show.
 */
export async function detectFacePlacement(file: File): Promise<FaceDetection | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const faces = await detectFaceLandmarks(bitmap);
    const landmarks = faces[0];
    if (!landmarks || landmarks.length <= LM.rightCheek) return null;

    const warnings: string[] = [];
    if (faces.length > 1) {
      warnings.push(`Hemos encontrado ${faces.length} caras y hemos encajado la primera. Ajusta el recorte si no es la que quieres.`);
    }

    const placement = placementFor(landmarks, bitmap.width, bitmap.height);
    if (placement.clampedOffset) {
      warnings.push("La cara está muy cerca del borde de la foto. Comprueba que no falte parte de la cabeza.");
    }
    if (Math.abs(placement.rotation) > 22) {
      warnings.push("La cabeza está muy inclinada. Hemos nivelado el recorte, pero una foto más frontal saldrá mejor.");
    }

    return {
      placement: { zoom: placement.zoom, rotation: placement.rotation, offset: placement.offset },
      skinTone: sampleSkinTone(bitmap, landmarks),
      faceCount: faces.length,
      warnings,
    };
  } finally {
    try {
      bitmap.close();
    } catch {
      // Already transferred to the worker and closed there.
    }
  }
}

/**
 * The framing maths, separated from the model so it can be tested without loading MediaPipe.
 *
 * The three numbers are derived from the cropper's own transform, which draws the image with
 * `scale = size / min(w, h) * zoom`, rotates about the frame's centre, and offsets the image's centre
 * by `offset * size` **in the rotated frame**. So:
 *
 *  - `zoom` comes from wanting the face's pixel height to land on `FACE_HEIGHT_FRACTION` of the
 *    frame: `zoom = fraction · min(w,h) / faceHeightPx`.
 *  - `offset` is whatever puts the face's centre on the frame's centre, which for a point at
 *    normalised image coordinates `(u, v)` is `-(w / min(w,h)) · zoom · (u - ½)` and likewise for `v`.
 *    Because the offset is applied along the image's own axes inside the rotated frame, the rotation
 *    does not enter this — a detail that is easy to get wrong and produces a face that slides off
 *    centre in proportion to how tilted the head was.
 *  - `rotation` is the negation of the eye line's angle, so the eyes come out level.
 */
export function placementFor(
  landmarks: readonly FaceLandmark[],
  width: number,
  height: number,
): FacePlacement & { clampedOffset: boolean } {
  const point = (index: number) => landmarks[index]!;
  const shortSide = Math.min(width, height);

  // ---------------------------------------------------------------- rotation
  const leftEye = point(LM.leftEyeOuter);
  const rightEye = point(LM.rightEyeOuter);
  const eyeAngle = Math.atan2((rightEye.y - leftEye.y) * height, (rightEye.x - leftEye.x) * width);
  // Negated: the canvas rotates the *image*, so cancelling a tilt means turning it the other way.
  const rotation = clamp((-eyeAngle * 180) / Math.PI, -45, 45);

  // ---------------------------------------------------------------- zoom
  const forehead = point(LM.foreheadTop);
  const chin = point(LM.chin);
  const faceHeightPx = Math.max(1, Math.hypot((chin.x - forehead.x) * width, (chin.y - forehead.y) * height));
  // Clamped generously: a passport photo needs a zoom near 1, a group shot needs 6 or more, and a
  // detection that came out nonsense must not produce a framing that cannot be dragged back.
  const zoom = clamp((FACE_HEIGHT_FRACTION * shortSide) / faceHeightPx, 0.4, 8);

  // ---------------------------------------------------------------- offset
  const centreU = (forehead.x + chin.x) / 2;
  // Lifted, so the eyes land on the upper third rather than in the middle of the card.
  const centreV = (forehead.y + chin.y) / 2 - (chin.y - forehead.y) * VERTICAL_LIFT;
  const rawX = -(width / shortSide) * zoom * (centreU - 0.5);
  const rawY = -(height / shortSide) * zoom * (centreV - 0.5);
  const limit = offsetLimit(zoom, width, height);
  const offset = { x: clamp(rawX, -limit.x, limit.x), y: clamp(rawY, -limit.y, limit.y) };

  return {
    zoom,
    rotation,
    offset,
    // Reported rather than swallowed: a clamped offset means the face could not be centred, which is
    // worth telling the player about before they save a crop with half a head in it.
    clampedOffset: Math.abs(rawX - offset.x) > 0.01 || Math.abs(rawY - offset.y) > 0.01,
  };
}

/**
 * Samples the skin from the cheeks.
 *
 * The cheeks specifically, and a median rather than a mean. The forehead catches specular highlights
 * and the jaw catches shadow, so both bias the result; and a mean over any patch of a photograph is
 * dragged by whatever is behind the head at the edges of the sample. Sixteen small patches with the
 * median taken per channel throws away both the highlight and the background.
 */
function sampleSkinTone(bitmap: ImageBitmap, landmarks: readonly FaceLandmark[]): string {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "#d99b72";
  context.drawImage(bitmap, 0, 0);

  const left = landmarks[LM.leftCheekInner]!;
  const right = landmarks[LM.rightCheekInner]!;
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  for (const cheek of [left, right]) {
    const cx = Math.round(cheek.x * bitmap.width);
    const cy = Math.round(cheek.y * bitmap.height);
    const patch = Math.max(2, Math.round(Math.min(bitmap.width, bitmap.height) * 0.012));
    const x = clamp(cx - patch, 0, Math.max(0, bitmap.width - patch * 2));
    const y = clamp(cy - patch, 0, Math.max(0, bitmap.height - patch * 2));
    const data = context.getImageData(x, y, patch * 2, patch * 2).data;
    for (let index = 0; index < data.length; index += 4) {
      // Fully transparent pixels are not skin. A PNG with a cut-out background would otherwise pull
      // the median toward zero.
      if ((data[index + 3] ?? 255) < 200) continue;
      reds.push(data[index]!);
      greens.push(data[index + 1]!);
      blues.push(data[index + 2]!);
    }
  }

  if (reds.length === 0) return "#d99b72";
  return `#${[reds, greens, blues].map((channel) => median(channel).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * How far the framing may be offset before the photograph stops covering the card.
 *
 * Shared with `FaceCropper`, and the reason it exists is a bug this file exposed. The cropper clamped
 * the offset to a flat ±0.5, which is a reasonable range at zoom 1 and far too tight at zoom 6: at
 * that magnification the image is six times the card, so half a card of travel is almost none — and
 * a small face off to one side of a group shot needs an offset of 0.8 to reach the middle. The
 * automatic framing was being clamped to a third of the way there, which showed up as the detector
 * apparently getting the answer wrong.
 *
 * The limit is derived from the geometry instead: the image measures `dimension / min(w, h) · zoom`
 * in card units, so it can travel half of whatever it has over the card's own size. At zoom 1 with a
 * square photograph that is zero, which is correct — the image exactly covers the card and any
 * movement would open a transparent gap at an edge, and `paint` uses `cover` precisely so that can
 * never happen.
 */
export function offsetLimit(zoom: number, width: number, height: number): { x: number; y: number } {
  const shortSide = Math.min(width, height);
  return {
    x: Math.max(0, ((width / shortSide) * zoom - 1) / 2),
    y: Math.max(0, ((height / shortSide) * zoom - 1) / 2),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
