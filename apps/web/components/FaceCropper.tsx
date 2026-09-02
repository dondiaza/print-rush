"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceCrop } from "@print-rush/character-core";

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

/** The exported crop. 1024 is the brief's face-texture source size; the server reduces from here. */
const EXPORT_SIZE = 1024;

export function FaceCropper({ file, onConfirm, onCancel, busy = false }: FaceCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
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
      // Start with the photo covering the frame, centred — the framing a person expects to see.
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setRotation(0);
      setReady(true);
    };
    image.onerror = () => setError("No hemos podido abrir esa imagen. Prueba con otro archivo.");
    image.src = url;
    return () => {
      URL.revokeObjectURL(url);
      imageRef.current = null;
      setReady(false);
    };
  }, [file]);

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

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dragging.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - dragging.current.x) / rect.width;
    const dy = (event.clientY - dragging.current.y) / rect.height;
    dragging.current = { x: event.clientX, y: event.clientY };
    // Clamped, so the photo can never be dragged entirely out of the frame.
    setOffset((current) => ({
      x: Math.max(-0.5, Math.min(0.5, current.x + dx)),
      y: Math.max(-0.5, Math.min(0.5, current.y + dy)),
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

      <div className="cropper-controls">
        <label>
          <span>ZOOM</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <label>
          <span>GIRO</span>
          <input
            type="range"
            min={-30}
            max={30}
            step={1}
            value={rotation}
            onChange={(event) => setRotation(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="cropper-reset"
          onClick={() => {
            setZoom(1);
            setRotation(0);
            setOffset({ x: 0, y: 0 });
          }}
        >
          CENTRAR
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
