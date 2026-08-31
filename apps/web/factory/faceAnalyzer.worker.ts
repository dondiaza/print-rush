/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
let landmarkerPromise: Promise<FaceLandmarker> | null = null;

function getLandmarker(): Promise<FaceLandmarker> {
  landmarkerPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT).then((vision) => FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" }, runningMode: "IMAGE", numFaces: 4,
    minFaceDetectionConfidence: .52, minFacePresenceConfidence: .52, minTrackingConfidence: .5,
  }));
  return landmarkerPromise;
}

self.onmessage = async (event: MessageEvent<{ id: string; bitmap: ImageBitmap }>) => {
  const { id, bitmap } = event.data;
  try {
    const detector = await getLandmarker();
    const result = detector.detect(bitmap);
    const landmarks = (result.faceLandmarks ?? []).map((face) => face.map(({ x, y, z }) => ({ x, y, z })));
    self.postMessage({ id, ok: true, landmarks });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Worker analysis failed" });
  } finally { bitmap.close(); }
};
