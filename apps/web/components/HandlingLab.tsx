"use client";

import { useEffect, useRef, useState } from "react";
import type { HandlingRuntime, Telemetry } from "@/game/HandlingRuntime";

/**
 * Stage 2 gate: the grey-box handling lab.
 *
 * The telemetry panel is written straight into DOM nodes through refs at 20 Hz rather than through
 * React state. Re-rendering a component tree beside a render loop is exactly the pattern the V5
 * brief rules out, and a diagnostics panel is the easiest place to accidentally do it.
 */

type Row = { key: keyof Telemetry; label: string; format?: (value: never) => string };

const HANDLING_ROWS: Row[] = [
  { key: "speedKph", label: "Velocidad (nariz)", format: ((value: number) => `${value} km/h`) as never },
  { key: "travelKph", label: "Velocidad (real)", format: ((value: number) => `${value} km/h`) as never },
  { key: "longitudinal", label: "Longitudinal", format: ((value: number) => `${value} m/s`) as never },
  { key: "lateral", label: "Lateral (deslizamiento)", format: ((value: number) => `${value} m/s`) as never },
  { key: "slipAngleDeg", label: "Slip angle", format: ((value: number) => `${value}°`) as never },
  { key: "yawRateDeg", label: "Yaw rate", format: ((value: number) => `${value}°/s`) as never },
  { key: "steer", label: "Steer (analógico)" },
];

const DRIFT_ROWS: Row[] = [
  { key: "driftActive", label: "Drift", format: ((value: boolean) => (value ? "ACTIVO" : "—")) as never },
  { key: "driftDirection", label: "Dirección", format: ((value: number) => (value === 0 ? "—" : value > 0 ? "DERECHA" : "IZQUIERDA")) as never },
  { key: "driftCharge", label: "Carga", format: ((value: number) => `${value} s`) as never },
  { key: "driftLevel", label: "Nivel", format: ((value: number) => ["—", "MICRO", "BOOST", "SUPER"][value] ?? "—") as never },
  { key: "boostRemaining", label: "Boost restante", format: ((value: number) => `${value} s`) as never },
  { key: "boostTier", label: "Tier de boost" },
];

const TRACK_ROWS: Row[] = [
  { key: "surface", label: "Superficie" },
  { key: "sector", label: "Sector" },
  { key: "lapDistance", label: "Distancia de vuelta", format: ((value: number) => `${value} m`) as never },
  { key: "lateralOffset", label: "Offset del eje", format: ((value: number) => `${value} m`) as never },
  { key: "grounded", label: "En el suelo", format: ((value: boolean) => (value ? "sí" : "NO")) as never },
  { key: "airTime", label: "Tiempo en el aire", format: ((value: number) => `${value} s`) as never },
  { key: "wallHits", label: "Golpes de muro" },
  { key: "respawns", label: "Respawns" },
];

const PERF_ROWS: Row[] = [
  { key: "fps", label: "FPS" },
  { key: "frameMs", label: "Frame time", format: ((value: number) => `${value} ms`) as never },
  { key: "drawCalls", label: "Draw calls" },
  { key: "triangles", label: "Triángulos", format: ((value: number) => Math.round(value).toLocaleString("es-ES")) as never },
  { key: "meshes", label: "Meshes" },
  { key: "cameraFov", label: "FOV de cámara", format: ((value: number) => `${value}°`) as never },
  { key: "cameraDistance", label: "Distancia de cámara", format: ((value: number) => `${value} m`) as never },
];

const SECTIONS: Array<{ title: string; rows: Row[] }> = [
  { title: "Conducción", rows: HANDLING_ROWS },
  { title: "Drift y boost", rows: DRIFT_ROWS },
  { title: "Circuito", rows: TRACK_ROWS },
  { title: "Rendimiento", rows: PERF_ROWS },
];

function formatLap(ms: number | null): string {
  if (ms === null) return "—";
  const total = ms / 1_000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

export function HandlingLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<HandlingRuntime | null>(null);
  const valueRefs = useRef(new Map<string, HTMLSpanElement>());
  const lapRefs = useRef<{ current?: HTMLSpanElement; last?: HTMLSpanElement; best?: HTMLSpanElement }>({});
  const [analysis, setAnalysis] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;

    const write = (telemetry: Telemetry): void => {
      for (const [key, value] of Object.entries(telemetry)) {
        const node = valueRefs.current.get(key);
        if (!node) continue;
        const row = SECTIONS.flatMap((section) => section.rows).find((entry) => entry.key === key);
        const text = row?.format ? row.format(value as never) : String(value);
        if (node.textContent !== text) node.textContent = text;
      }
      if (lapRefs.current.current) lapRefs.current.current.textContent = formatLap(telemetry.lapTimeMs);
      if (lapRefs.current.last) lapRefs.current.last.textContent = formatLap(telemetry.lastLapMs);
      if (lapRefs.current.best) lapRefs.current.best.textContent = formatLap(telemetry.bestLapMs);
    };

    void (async () => {
      try {
        const { HandlingRuntime } = await import("@/game/HandlingRuntime");
        if (disposed) return;
        const mobile = window.matchMedia("(pointer: coarse)").matches;
        const runtime = new HandlingRuntime(canvas, { onTelemetry: write, mobile });
        runtimeRef.current = runtime;
        setAnalysis(runtime.analysis as unknown as Record<string, number>);
        runtime.start();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudo iniciar el laboratorio.");
      }
    })();

    return () => {
      disposed = true;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, []);

  const togglePause = (): void => {
    const next = !paused;
    setPaused(next);
    runtimeRef.current?.setPaused(next);
  };

  return (
    <main className="lab">
      <canvas ref={canvasRef} className="lab-canvas" />

      <section className="lab-panel">
        <header className="lab-head">
          <h1>Handling Lab</h1>
          <p>Circuito gris · modelo de vehículo V5</p>
        </header>

        <div className="lab-laps">
          <div>
            <span className="lab-laps-label">Actual</span>
            <span ref={(node) => { if (node) lapRefs.current.current = node; }} className="lab-laps-value">—</span>
          </div>
          <div>
            <span className="lab-laps-label">Última</span>
            <span ref={(node) => { if (node) lapRefs.current.last = node; }} className="lab-laps-value">—</span>
          </div>
          <div>
            <span className="lab-laps-label">Mejor</span>
            <span ref={(node) => { if (node) lapRefs.current.best = node; }} className="lab-laps-value lab-laps-best">—</span>
          </div>
        </div>

        {error ? <p className="lab-error">{error}</p> : null}

        {SECTIONS.map((section) => (
          <div key={section.title} className="lab-section">
            <h2>{section.title}</h2>
            <dl>
              {section.rows.map((row) => (
                <div key={String(row.key)} className="lab-row">
                  <dt>{row.label}</dt>
                  <dd>
                    <span
                      ref={(node) => {
                        if (node) valueRefs.current.set(String(row.key), node);
                      }}
                    >
                      —
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        {analysis ? (
          <div className="lab-section">
            <h2>Métricas del circuito</h2>
            <dl>
              <div className="lab-row"><dt>Longitud</dt><dd>{analysis.lengthMeters} m</dd></div>
              <div className="lab-row"><dt>Vuelta estimada</dt><dd>{analysis.estimatedLapSeconds} s</dd></div>
              <div className="lab-row"><dt>Curvas</dt><dd>{analysis.corners}</dd></div>
              <div className="lab-row"><dt>Rectas</dt><dd>{analysis.straights}</dd></div>
              <div className="lab-row"><dt>Desnivel</dt><dd>{analysis.elevationRange} m</dd></div>
              <div className="lab-row"><dt>Cruces a distinta altura</dt><dd>{analysis.crossovers}</dd></div>
              <div className="lab-row"><dt>Nodos</dt><dd>{analysis.nodeCount}</dd></div>
            </dl>
          </div>
        ) : null}

        <div className="lab-controls">
          <h2>Controles</h2>
          <p>W/↑ acelerar · S/↓ frenar · A/D girar · ESPACIO derrape · R respawn</p>
          <p>Gamepad: stick izquierdo, gatillos, A para derrape.</p>
          <div className="lab-buttons">
            <button type="button" onClick={togglePause}>{paused ? "Reanudar" : "Pausar"}</button>
            <button type="button" onClick={() => runtimeRef.current?.respawn()}>Respawn</button>
          </div>
        </div>
      </section>

      <style>{`
        .lab { position: fixed; inset: 0; display: flex; background: #14161a; color: #e8eaee;
          font: 400 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
        .lab-canvas { flex: 1; min-width: 0; display: block; outline: none; touch-action: none; }
        .lab-panel { width: 340px; overflow-y: auto; padding: 18px 20px 40px;
          background: #1b1e24; border-left: 1px solid #2b3038; }
        .lab-head h1 { margin: 0; font-size: 19px; font-weight: 800; letter-spacing: -0.01em; }
        .lab-head p { margin: 2px 0 16px; color: #8d95a3; font-size: 12px; }
        .lab-laps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px; }
        .lab-laps > div { background: #14171c; border: 1px solid #2b3038; border-radius: 8px; padding: 8px 6px;
          text-align: center; }
        .lab-laps-label { display: block; color: #7c8492; font-size: 10px; text-transform: uppercase;
          letter-spacing: 0.06em; }
        .lab-laps-value { display: block; margin-top: 3px; font-variant-numeric: tabular-nums;
          font-weight: 700; font-size: 15px; }
        .lab-laps-best { color: #b9ff45; }
        .lab-error { background: #3a1a20; border: 1px solid #7a2f3c; border-radius: 8px; padding: 10px;
          color: #ffb8c2; }
        .lab-section { margin-bottom: 18px; }
        .lab-section h2, .lab-controls h2 { margin: 0 0 6px; font-size: 11px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.08em; color: #ff3da6; }
        .lab-section dl { margin: 0; }
        .lab-row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0;
          border-bottom: 1px solid #23272e; }
        .lab-row dt { color: #8d95a3; }
        .lab-row dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }
        .lab-controls p { margin: 0 0 4px; color: #8d95a3; font-size: 12px; }
        .lab-buttons { display: flex; gap: 8px; margin-top: 10px; }
        .lab-buttons button { flex: 1; padding: 9px; border-radius: 8px; border: 1px solid #3a414c;
          background: #23272e; color: #e8eaee; font-weight: 700; cursor: pointer; }
        .lab-buttons button:hover { background: #2c313a; }
        @media (max-width: 900px) {
          .lab { flex-direction: column; }
          .lab-panel { width: auto; max-height: 42vh; border-left: none; border-top: 1px solid #2b3038; }
        }
      `}</style>
    </main>
  );
}
