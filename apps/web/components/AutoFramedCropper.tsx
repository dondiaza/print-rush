"use client";

import { useEffect, useState } from "react";
import type { FaceCrop } from "@print-rush/character-core";
import { detectFacePlacement, type FaceDetection } from "@/factory/facePlacement";
import { FaceCropper, type FaceCropperState } from "./FaceCropper";

/**
 * THE CROP, FRAMED FOR YOU.
 *
 * A thin owner around `FaceCropper` that runs the landmark detector and hands it a starting framing.
 * It is a separate component rather than a few more lines in the studio for one reason: the studio's
 * library file is already the largest component in the project, and the brief is explicit about not
 * growing giant components. This has exactly one job and one piece of state.
 *
 * The ordering matters and is the reason this is asynchronous rather than resolved before the cropper
 * mounts. Decoding a photograph takes milliseconds; downloading MediaPipe's 3 MB model on a cold
 * cache takes seconds. Blocking the cropper on the model would mean staring at a spinner before being
 * allowed to see your own photograph — so the cropper opens immediately at the neutral framing, and
 * reframes when the detection lands. `FaceCropper` takes `framing` as an effect dependency precisely
 * so that late arrival works.
 *
 * Detection failure is not an error state. No face found, model blocked by a network policy, worker
 * unavailable: all of them leave the cropper exactly as it was before this existed, with every manual
 * control live. The feature degrades to the old behaviour instead of taking the flow down.
 */

type Props = {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  /**
   * The confirmed crop, plus the skin tone sampled from the photograph.
   *
   * The tone is handed over because the styled face is a *card* projected in front of the skull —
   * the neck, ears and hands around it stay the mesh's own colour. Leaving the character's palette
   * slot untouched puts a photographed face on a stranger's body, and that join is the first thing
   * anyone notices.
   */
  onConfirm: (crop: FaceCrop, png: Blob, skinTone: string | null) => void;
};

export function AutoFramedCropper({ file, busy = false, onCancel, onConfirm }: Props) {
  const [detection, setDetection] = useState<FaceDetection | null>(null);
  const [state, setState] = useState<FaceCropperState>("DETECTING");

  /**
   * Keyed on the file, so a new photograph resets the state without an effect that writes it.
   *
   * The obvious shape here is `setDetection(null); setState("DETECTING")` at the top of the effect,
   * and React rightly objects: a synchronous setState inside an effect renders the component twice
   * in one commit. Deriving the reset from a key comparison instead means the state is already
   * correct on the render where the file changes.
   */
  const [detectedFor, setDetectedFor] = useState<File | null>(null);
  const stale = detectedFor !== file;
  const framing = stale ? null : detection?.placement ?? null;
  const shown: FaceCropperState = stale ? "DETECTING" : state;

  useEffect(() => {
    let active = true;

    void detectFacePlacement(file)
      .then((result) => {
        if (!active) return;
        setDetection(result);
        setState(result ? "DETECTED" : "MANUAL");
        setDetectedFor(file);
      })
      .catch((error: unknown) => {
        // Logged, not shown. The player's next move is the same either way — frame it by hand — and
        // "el worker de análisis no está disponible" is not information they can act on.
        console.warn("[face] automatic framing unavailable; the crop stays manual", error);
        if (!active) return;
        setDetection(null);
        setState("MANUAL");
        setDetectedFor(file);
      });

    return () => {
      active = false;
    };
  }, [file]);

  return (
    <FaceCropper
      file={file}
      busy={busy}
      state={shown}
      framing={framing}
      notice={stale ? null : detection?.warnings.join(" ") || null}
      onCancel={onCancel}
      onConfirm={(crop, png) => onConfirm(crop, png, detection?.skinTone ?? null)}
    />
  );
}
