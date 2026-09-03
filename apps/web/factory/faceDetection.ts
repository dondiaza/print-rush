/**
 * FACE LANDMARK DETECTION.
 *
 * Lifted out of `FaceAvatarAnalyzer`, where it was a private function, because two callers now need
 * it: that analyzer, which sculpts the legacy garage's mesh from the landmarks, and `facePlacement`,
 * which frames the studio's crop from them. Copying it would have meant two model URLs, two worker
 * lifecycles and two timeouts to keep in agreement — and the brief is explicit about not duplicating
 * systems.
 *
 * The worker path is the one that matters. MediaPipe's WASM runtime and its 3 MB model would block
 * the main thread for a noticeable beat on a phone, and this runs while a player is looking at their
 * own photograph. `OffscreenCanvas` plus a transferred `ImageBitmap` keeps all of it off the main
 * thread; the inline fallback exists for browsers without either, and for it the pause is the price
 * of the feature working at all.
 */

export type FaceLandmark = { x: number; y: number; z: number };

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** How long to wait for the worker before giving up. A cold model download is most of this. */
const TIMEOUT_MS = 25_000;

/**
 * Runs the landmarker over a bitmap and returns one array of landmarks per detected face.
 *
 * Coordinates are normalised to 0..1 over the image, not pixels, which is why every consumer has to
 * multiply by the image's own dimensions — and why an aspect ratio correction is needed before any
 * angle or distance computed from them means anything.
 *
 * **The bitmap is consumed.** On the worker path it is transferred, so it is closed and unusable when
 * this resolves. Callers that need it afterwards have to make their own copy; `finally { close() }`
 * around a call to this is correct and is what the existing callers do.
 */
export async function detectFaceLandmarks(bitmap: ImageBitmap): Promise<FaceLandmark[][]> {
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./faceAnalyzer.worker.ts", import.meta.url), {
        type: "module",
        name: "print-rush-face-analyzer",
      });
    } catch {
      // No module workers: fall through to the inline path rather than failing the feature.
      worker = null;
    }
    if (worker) {
      const active = worker;
      return new Promise<FaceLandmark[][]>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          active.terminate();
          reject(new Error("El análisis tardó demasiado. Prueba con una foto más pequeña."));
        }, TIMEOUT_MS);
        active.onmessage = (
          event: MessageEvent<{ ok: boolean; landmarks?: FaceLandmark[][]; error?: string }>,
        ) => {
          window.clearTimeout(timeout);
          active.terminate();
          if (event.data.ok && event.data.landmarks) resolve(event.data.landmarks);
          else reject(new Error(event.data.error ?? "No se pudo analizar la cara."));
        };
        active.onerror = () => {
          window.clearTimeout(timeout);
          active.terminate();
          reject(new Error("El worker de análisis no está disponible."));
        };
        active.postMessage({ id: crypto.randomUUID(), bitmap }, [bitmap]);
      });
    }
  }

  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    runningMode: "IMAGE",
    numFaces: 4,
    minFaceDetectionConfidence: 0.52,
    minFacePresenceConfidence: 0.52,
    minTrackingConfidence: 0.5,
  });
  try {
    return (landmarker.detect(bitmap).faceLandmarks ?? []).map((face) => face.map(({ x, y, z }) => ({ x, y, z })));
  } finally {
    landmarker.close();
  }
}
