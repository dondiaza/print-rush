import { normalizeCharacter, type CharacterDefinition } from "@print-rush/3d-factory";
// The landmarker moved to its own module when the studio's crop needed it too.
import { detectFaceLandmarks } from "./faceDetection";

export type FaceAnalysisState = "IDLE" | "VALIDATING" | "LOADING_MODEL" | "ANALYZING" | "DONE" | "ERROR";
export type FaceQuality = { width: number; height: number; luminance: number; warnings: string[] };
export type FaceAnalysis = { character: CharacterDefinition; faceCount: number; quality: FaceQuality };


export async function analyzeAvatarPhoto(file: File, base: CharacterDefinition, onState: (state: FaceAnalysisState) => void): Promise<FaceAnalysis> {
  onState("VALIDATING");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Usa una imagen JPEG, PNG o WebP.");
  if (file.size > 10 * 1024 * 1024) throw new Error("La imagen supera el límite de 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const quality = inspectQuality(bitmap);
    if (bitmap.width < 256 || bitmap.height < 256) throw new Error("La foto es demasiado pequeña. Usa al menos 256 × 256 px.");
    onState("LOADING_MODEL");
    onState("ANALYZING");
    const faces = await detectFaceLandmarks(bitmap);
    if (faces.length === 0) throw new Error("No se detectó una cara. Prueba con luz frontal y mirando a cámara.");
    const landmarks = faces[0];
    if (!landmarks || landmarks.length < 455) throw new Error("La cara no tiene suficiente detalle para generar el avatar.");
    const point = (index: number) => landmarks[index]!;
    const faceWidth = distance(point(234), point(454));
    const faceHeight = distance(point(10), point(152));
    const eyeSpacing = distance(point(33), point(263));
    const mouthWidth = distance(point(61), point(291));
    const noseWidth = distance(point(98), point(327));
    const next = structuredClone(base);
    next.id = `avatar-photo-${Date.now().toString(36)}`;
    next.source = "PHOTO";
    next.name = `${base.name.replace(/ foto$/i, "")} foto`;
    next.face.width = clamp(.84 + faceWidth * .72, .82, 1.18);
    next.face.height = clamp(.82 + faceHeight * .72, .86, 1.14);
    next.face.jawWidth = clamp(.74 + distance(point(172), point(397)) * .85, .78, 1.18);
    next.face.jawRoundness = clamp(1 - Math.abs(point(152).y - point(172).y) * 2.5, .15, .95);
    next.face.cheekVolume = clamp(distance(point(123), point(352)) * 1.1, .15, .95);
    next.face.foreheadHeight = clamp(distance(point(10), point(168)) * 2.3, .1, .9);
    next.face.eyes.spacing = clamp(.72 + eyeSpacing * 1.05, .78, 1.22);
    next.face.eyes.size = clamp(.75 + ((distance(point(159), point(145)) + distance(point(386), point(374))) * 4.1), .72, 1.3);
    next.face.eyes.angle = clamp(((point(33).y - point(263).y) / Math.max(eyeSpacing, .001)) * .45, -.32, .32);
    next.face.mouth.width = clamp(mouthWidth * 1.75, .25, .86);
    next.face.mouth.curve = clamp(((point(13).y - point(61).y) + (point(13).y - point(291).y)) * 2.2, -.4, .4);
    next.face.nose.width = clamp(noseWidth * 2.25, .15, .9);
    next.face.nose.length = clamp(distance(point(168), point(1)) * 3.1, .2, .88);
    next.photo = { mode: "STYLIZED", strength: .82, landmarkModel: "MediaPipe Face Landmarker", originalRetained: false, analyzedAt: new Date().toISOString() };
    if (faces.length > 1) quality.warnings.push(`Se detectaron ${faces.length} caras; se ha usado la primera. Recorta la foto para elegir otra.`);
    onState("DONE");
    return { character: normalizeCharacter(next), faceCount: faces.length, quality };
  } catch (error) {
    onState("ERROR");
    throw error;
  } finally {
    try { bitmap.close(); } catch { /* The worker may already own and close the bitmap. */ }
  }
}

function inspectQuality(bitmap: ImageBitmap): FaceQuality {
  const size = 48;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context?.drawImage(bitmap, 0, 0, size, size);
  const pixels = context?.getImageData(0, 0, size, size).data;
  let total = 0;
  if (pixels) for (let index = 0; index < pixels.length; index += 4) total += pixels[index]! * .2126 + pixels[index + 1]! * .7152 + pixels[index + 2]! * .0722;
  const luminance = pixels ? total / (pixels.length / 4) : 128;
  const warnings: string[] = [];
  if (luminance < 58) warnings.push("La foto está oscura; el parecido puede ser menor.");
  if (luminance > 226) warnings.push("La foto está sobreexpuesta; evita luz directa.");
  if (Math.min(bitmap.width, bitmap.height) < 640) warnings.push("Una foto de 640 px o más dará más detalle.");
  return { width: bitmap.width, height: bitmap.height, luminance: Math.round(luminance), warnings };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
