"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FaceCrop } from "@print-rush/character-core";
import { offsetLimit } from "@/factory/facePlacement";

/**
 * THE CROP EDITOR.
 *
 * Pan, zoom and rotate a photograph inside a square frame, then export the framing as a normalised
 * PNG. It runs entirely in the browser, and that is a security decision as much as an interaction
 * one: the browser already has hardened decoders for JPEG, PNG and WebP, so it produces the one
 * image the server will actually parse. The original goes up untouched and is never opened server
 * side.
 *
 * The guides are drawn where a face's features sit rather than as a plain grid — eyes on the upper
 * third, mouth below centre. A rule of thirds tells you nothing about whether a head is framed; a
 * line where the eyes belong tells you immediately.
 */

export type FaceCropperProps = {
  file: File;
  /** Called with the framing and the exported PNG when the owner confirms. */
  onConfirm: (crop: FaceCrop, png: Blob) => void;
  onCancel: () => void;
  busy?: boolean;
};

/**
 * How the crop opens, and how the detector's answer reaches it.
 *
 * The framing is a *starting point*, not a constraint. A detection can pick the wrong face out of a
 * group, or find a face in a pattern on a shirt, so every manual control stays live and the player
 * can drag straight out of whatever was suggested. What the detection buys is that the common case —
 * one person, looking at the camera — needs no adjustment at all, where before it always did.
 */
export type FaceFraming = {
  zoom: number;
  rotation: number;
  offset: { x: number; y: number };
};

export type FaceCropperState = "DETECTING" | "DETECTED" | "MANUAL";

/** The exported crop. 1024 is the brief's face-texture source size; the server reduces from here. */
const EXPORT_SIZE = 1024;

export function FaceCropper({ file, onConfirm, onCancel, busy = false, framing, state = "MANUAL", notice }: FaceCropperProps & {
  framing?: FaceFraming | null;
  state?: FaceCropperState;
  /** What the detector wants to say — more than one face, a head near the edge, a heavy tilt. */
  notice?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  /**
   * The photograph's pixel dimensions, in state rather than read off the image ref.
   *
   * The offset limit depends on the image's aspect ratio, so it has to be available during render —
   * and reading `imageRef.current` there is exactly what React forbids, because a ref's value is not
   * part of the render's inputs and a component that depends on it can render stale. Recording the
   * dimensions when the image loads makes the dependency explicit.
   */
  const [source, setSource] = useState<{ width: number; height: number } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  // Load the file into an image element, and revoke the object URL when done: a blob URL that is
  // never revoked keeps the whole file alive in memory for the life of the page.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setSource({ width: image.width, height: image.height });
      /**
       * Opens on the detected face when there is one.
       *
       * The old default — the photo covering the frame, centred — is what remains when detection
       * found nothing or has not finished. It is a reasonable neutral framing and a poor guess at
       * where a face is: in a photograph taken at arm's length the head occupies maybe a fifth of the
       * frame and sits above the middle, so the neutral framing put a chest in the card and left the
       * player to fix it every single time.
       */
      if (framing) {
        setZoom(framing.zoom);
        setRotation(framing.rotation);
        setOffset(framing.offset);
      } else {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        setRotation(0);
      }
      setReady(true);
    };
    image.onerror = () => setError("No hemos podido abrir esa imagen. Prueba con otro archivo.");
    image.src = url;
    return () => {
      URL.revokeObjectURL(url);
      imageRef.current = null;
      setSource(null);
      setReady(false);
    };
    // `framing` is a dependency because a detection that resolves *after* the image has loaded must
    // still reframe it — which is the normal order of events, since decoding a file is faster than
    // downloading a 3 MB model.
  }, [file, framing]);

  /**
   * Draws the photo into a square canvas at the current framing.
   *
   * Shared by the preview and the export, with only the size differing, so what the owner confirms
   * is exactly what is uploaded. Two code paths here would be the classic way to get a crop that
   * does not match its preview.
   */
  const paint = useCallback(
    (context: CanvasRenderingContext2D, size: number): void => {
      const image = imageRef.current;
      if (!image) return;
      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(size / 2, size / 2);
      context.rotate((rotation * Math.PI) / 180);
      // `cover`: the shorter side fills the frame, so there is never a transparent gap at an edge.
      const base = size / Math.min(image.width, image.height);
      const scale = base * zoom;
      context.drawImage(
        image,
        -image.width * scale / 2 + offset.x * size,
        -image.height * scale / 2 + offset.y * size,
        image.width * scale,
        image.height * scale,
      );
      context.restore();
    },
    [offset.x, offset.y, rotation, zoom],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !ready) return;
    paint(context, canvas.width);
  }, [paint, ready]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { x: event.clientX, y: event.clientY };
  };

  /**
   * How far the photograph may travel at the current zoom.
   *
   * Was a flat ±0.5, which is fine at zoom 1 and wrong everywhere else: at zoom 6 the image is six
   * times the frame, so half a frame of travel is almost none, and a face off to one side could not
   * be brought to the middle at all. `offsetLimit` derives it from the geometry — the image can move
   * by half of however much it overhangs the frame — which also makes the guarantee `paint` relies
   * on exact rather than approximate: there is never a transparent gap at an edge.
   */
  const limit = useMemo(
    () => (source ? offsetLimit(zoom, source.width, source.height) : { x: 0.5, y: 0.5 }),
    [zoom, source],
  );

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dragging.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - dragging.current.x) / rect.width;
    const dy = (event.clientY - dragging.current.y) / rect.height;
    dragging.current = { x: event.clientX, y: event.clientY };
    setOffset((current) => ({
      x: Math.max(-limit.x, Math.min(limit.x, current.x + dx)),
      y: Math.max(-limit.y, Math.min(limit.y, current.y + dy)),
    }));
  };

  /**
   * Changes the zoom and pulls the offset back inside the new limit in the same step.
   *
   * Zooming out shrinks how far the image may travel, so a framing that was legal at zoom 6 opens a
   * transparent wedge at zoom 1.2 — which the styling pass would then treat as part of the face. Done
   * here, in the event handler, rather than in an effect that watches the limit: an effect would set
   * state during a commit it did not cause, and the correction belongs to the interaction that made
   * it necessary.
   */
  const applyZoom = (next: number): void => {
    setZoom(next);
    if (!source) return;
    const bound = offsetLimit(next, source.width, source.height);
    setOffset((current) => ({
      x: Math.max(-bound.x, Math.min(bound.x, current.x)),
      y: Math.max(-bound.y, Math.min(bound.y, current.y)),
    }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragging.current = null;
  };

  const confirm = (): void => {
    const source = canvasRef.current;
    if (!source) return;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = EXPORT_SIZE;
    exportCanvas.height = EXPORT_SIZE;
    const context = exportCanvas.getContext("2d");
    if (!context) {
      setError("Tu navegador no permite exportar la imagen.");
      return;
    }
    context.imageSmoothingQuality = "high";
    paint(context, EXPORT_SIZE);
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        setError("No hemos podido preparar el recorte. Vuelve a intentarlo.");
        return;
      }
      // The framing is stored alongside, so the face can be restyled later without asking for the
      // photograph again.
      onConfirm({ x: offset.x, y: offset.y, width: 1, height: 1, rotation, zoom }, blob);
    }, "image/png");
  };

  return (
    <div className="cropper">
      <div className="cropper-stage">
        <canvas
          ref={canvasRef}
          width={512}
          height={512}
          className="cropper-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Recorte de la fotografía. Arrastra para mover."
        />
        {/* The framing guides. Positioned where features belong, not as a generic grid. */}
        <div className="cropper-guides" aria-hidden="true">
          <span className="guide-oval" />
          <span className="guide-line guide-eyes" />
          <span className="guide-line guide-mouth" />
        </div>
      </div>

      {error && <p className="cropper-error">{error}</p>}

      {/* What the detector is doing, and what it wants to say. Three states, because "we are looking
          for your face" and "we could not find it, do it yourself" are different messages and a
          player who gets neither assumes the feature is broken. */}
      <p className={`cropper-status is-${state.toLowerCase()}`} role="status">
        {state === "DETECTING" && "BUSCANDO LA CARA…"}
        {state === "DETECTED" && "CARA DETECTADA Y ENCAJADA · AJUSTA SI QUIERES"}
        {state === "MANUAL" && "ENCÁJALA A MANO: ARRASTRA, AMPLÍA Y NIVELA"}
      </p>
      {notice && <p className="cropper-notice">{notice}</p>}

      <div className="cropper-controls">
        {/*
          The ranges have to cover what the detector can produce, or the sliders fight it.

          Zoom was 1–3 and rotation ±30, which were reasonable bounds for a person dragging by hand
          and are too narrow now: a face in a group shot needs a zoom near 6, and `placementFor`
          clamps its own tilt correction at ±45. A slider narrower than the value it displays snaps
          the framing the moment it is touched, which would have looked like the detection being
          thrown away at random.
        */}
        <label>
          <span>ZOOM</span>
          <input
            type="range"
            min={0.4}
            max={8}
            step={0.02}
            value={zoom}
            onChange={(event) => applyZoom(Number(event.target.value))}
          />
        </label>
        <label>
          <span>GIRO</span>
          <input
            type="range"
            min={-45}
            max={45}
            step={1}
            value={rotation}
            onChange={(event) => setRotation(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="cropper-reset"
          onClick={() => {
            // Back to the *detected* framing when there is one, not to the neutral default. Undo has
            // to return what was taken away; resetting to a centred whole photograph would discard
            // the one thing the player did not have to do by hand.
            if (framing) {
              setZoom(framing.zoom);
              setRotation(framing.rotation);
              setOffset(framing.offset);
              return;
            }
            setZoom(1);
            setRotation(0);
            setOffset({ x: 0, y: 0 });
          }}
        >
          {framing ? "REENCAJAR" : "CENTRAR"}
        </button>
      </div>

      <p className="cropper-hint">
        Encaja la cara dentro del óvalo: los ojos sobre la línea superior y la boca sobre la inferior.
        Arrastra para mover.
      </p>

      <div className="cropper-actions">
        <button type="button" className="cta-secondary" onClick={onCancel} disabled={busy}>
          CANCELAR
        </button>
        <button type="button" className="cta-primary" onClick={confirm} disabled={busy || !ready}>
          {busy ? "SUBIENDO…" : "USAR ESTA CARA"}
        </button>
      </div>
    </div>
  );
}
