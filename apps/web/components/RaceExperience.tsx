"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AllowedLaps } from "@print-rush/game-core";
import { GameRuntime, type HudState, type RaceResult } from "@/game/GameRuntime";
import { loadActiveCharacter, loadActiveKart } from "@/factory/storage";
import { loadActiveTrack } from "@/factory/TrackFactory";
import { DebugOverlay, useDebugEnabled } from "./DebugOverlay";

type Props = {
  laps: AllowedLaps;
  nickname: string;
  muted: boolean;
  onExit: () => void;
  onFinish: (result: RaceResult) => void;
};

const INITIAL_HUD: HudState = {
  position: 1,
  lap: 1,
  laps: 3,
  speedKph: 0,
  timeMs: 0,
  driftCharge: 0,
  driftLevel: 0,
  hasItem: false,
  itemName: null,
  countdown: 3,
  banner: null,
  playerProgress: 0,
  botProgress: [0, 0, 0],
  phase: "GRID",
  trackName: "PRINT RUSH",
  sector: 1,
  rouletteName: null,
  shield: false,
  inked: false,
  shuffled: false,
  incoming: false,
  surface: "ASPHALT",
  lastLap: false,
  slipAngleDeg: 0,
  drifting: false,
  boostTier: 0,
  lapDistance: 0,
  lapLength: 0,
  fps: 60,
  boostReserve: 0,
  driftChain: 0,
  driftGrade: "NONE",
  driftWindowOpen: false,
  driftCue: null,
  perfectDrifts: 0,
  maxSpeedKph: 0,
};

export function RaceExperience({ laps, nickname, muted, onExit, onFinish }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const [hud, setHud] = useState<HudState>({ ...INITIAL_HUD, laps });
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoAccelerate, setAutoAccelerate] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const debug = useDebugEnabled();
  // The debug panel reads the latest HUD without forcing a re-render of the race UI.
  const hudRef = useRef<HudState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    const onHud = (state: HudState): void => {
      hudRef.current = state;
      setHud(state);
    };
    void GameRuntime.create(canvas, { laps, muted, onHud, onFinish, character: loadActiveCharacter(), kartDefinition: loadActiveKart(), trackDefinition: loadActiveTrack() }).then((runtime) => {
      if (!active) { runtime.dispose(); return; }
      runtimeRef.current = runtime;
      runtime.start();
      setLoading(false);
    }).catch(() => {
      if (active) setError("No hemos podido iniciar WebGL. Actualiza el navegador o activa la aceleración gráfica.");
      setLoading(false);
    });
    return () => {
      active = false;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [laps, muted, onFinish]);

  useEffect(() => {
    runtimeRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    runtimeRef.current?.setTouchControl("throttle", autoAccelerate);
  }, [autoAccelerate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") setPaused((value) => !value);
    };
    const blockContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", blockContextMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", blockContextMenu);
    };
  }, []);

  const hold = useCallback((control: "left" | "right" | "throttle" | "brake" | "drift") => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      runtimeRef.current?.setTouchControl(control, true);
      if (control === "drift") navigator.vibrate?.(10);
    },
    onPointerUp: () => runtimeRef.current?.setTouchControl(control, control === "throttle" && autoAccelerate),
    onPointerCancel: () => runtimeRef.current?.setTouchControl(control, control === "throttle" && autoAccelerate),
    onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.buttons === 0) runtimeRef.current?.setTouchControl(control, control === "throttle" && autoAccelerate);
    },
  }), [autoAccelerate]);

  return (
    <main className="race-shell" aria-label={`Carrera de ${nickname}`}>
      <style>{`
        .drift-track { position: relative; overflow: hidden; }
        .drift-track.window-open {
          box-shadow: 0 0 0 2px #b9ff45, 0 0 14px rgba(185, 255, 69, 0.7);
        }
        .drift-reserve {
          position: absolute; inset: 0 auto 0 0; background: rgba(101, 216, 255, 0.45);
        }
        .drift-cue {
          position: absolute; left: 50%; top: 34%; transform: translateX(-50%);
          font: 900 34px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.03em;
          text-shadow: 0 3px 0 rgba(0, 0, 0, 0.45); pointer-events: none;
          animation: cue-pop 180ms ease-out;
        }
        .drift-cue.grade-perfect { color: #b9ff45; }
        .drift-cue.grade-good { color: #65d8ff; }
        .drift-cue.grade-miss { color: #ff7b7b; font-size: 26px; }
        .drift-cue.grade-tap { color: #f7f2e8; font-size: 22px; opacity: 0.85; }
        .drift-cue.grade-chain { color: #ff3da6; }
        @keyframes cue-pop {
          from { transform: translateX(-50%) scale(0.7); opacity: 0; }
          to { transform: translateX(-50%) scale(1); opacity: 1; }
        }
      `}</style>
      <canvas ref={canvasRef} className="race-canvas" />
      <div className="noise" aria-hidden="true" />

      {loading && <div className="race-menu"><div className="race-menu-inner"><h2>CARGANDO TALLER…</h2><p>Preparando físicas, circuito y rivales.</p></div></div>}
      {debug && <DebugOverlay hudRef={hudRef} />}
      {error && <div className="race-menu"><div className="race-menu-inner"><h2>SIN MOTOR</h2><p>{error}</p><button className="cta-primary" onClick={onExit}>VOLVER</button></div></div>}

      {!loading && !error && (
        <>
          <div className="connection-note">V4 · LOCAL 60 HZ · {hud.trackName.toUpperCase()}</div>
          <div className={`hud ${hud.shuffled ? "hud-shuffled" : ""}`} aria-live="polite">
            <div className="hud-position">{hud.position}<span>/4</span></div>
            <div className="hud-top-center">
              <div className={`hud-lap ${hud.lastLap ? "final" : ""}`}>{hud.lastLap ? "FINAL " : "LAP "}{hud.lap} / {hud.laps}</div>
              <div className="hud-time">{formatTime(hud.timeMs)}</div>
              <div className="hud-sector">SECTOR {hud.sector} · {hud.surface}</div>
            </div>
            <MiniMap player={hud.playerProgress} bots={hud.botProgress} />
            <div className={`hud-item ${hud.hasItem ? "ready" : ""}`}>
              <b>{hud.rouletteName ? "?" : hud.hasItem ? hud.itemName?.slice(0, 1) : "—"}</b>
              <span>{hud.rouletteName ? `PRINTING · ${hud.rouletteName}` : hud.hasItem ? `E · ${hud.itemName?.toUpperCase()}` : "SIN OBJETO"}</span>
            </div>
            <div className="drift-meter">
              <div className="drift-label">
                <span>DRIFT{hud.driftChain > 1 ? ` · CHAIN x${hud.driftChain}` : ""}</span>
                <b>LV {hud.driftLevel}</b>
              </div>
              <div className={`drift-track ${hud.driftWindowOpen ? "window-open" : ""}`}>
                <div className="drift-fill" style={{ width: `${Math.min(100, (hud.driftCharge / 2.6) * 100)}%` }} />
                {/* The banked reserve, drawn behind the charge so a chain is visible at a glance. */}
                {hud.boostReserve > 0 && (
                  <div className="drift-reserve" style={{ width: `${Math.min(100, (hud.boostReserve / 1.6) * 100)}%` }} />
                )}
              </div>
            </div>
            <div className="hud-speed"><strong>{hud.speedKph}</strong><span>KM/H</span></div>
          </div>
          {hud.countdown !== null && <div key={hud.countdown} className="countdown">{hud.countdown}</div>}
          {hud.banner && <div className="race-banner">{hud.banner}</div>}
          {/* The grade is the feedback the chaining system lives or dies by, so it gets its own
              slot rather than competing with the banner for the same line. */}
          {hud.driftCue && <div className={`drift-cue grade-${hud.driftCue.split(" ")[0]!.toLowerCase()}`}>{hud.driftCue}</div>}
          {hud.incoming && <div className="incoming-warning"><b>!</b><span>INCOMING</span></div>}
          {hud.inked && <div className="ink-hit" aria-label="Tinta en pantalla"><i /><i /><i /></div>}
          {hud.shield && <div className="status-chip shield-chip">SHIELD x1</div>}
          {Math.abs(hud.speedKph) > 135 && <div className="speed-lines" aria-hidden="true" />}

          <div className="mobile-controls" aria-label="Controles táctiles">
            <div className="steer-pad">
              <button className="touch-button" {...hold("left")} aria-label="Girar a la izquierda">←</button>
              <button className="touch-button" {...hold("right")} aria-label="Girar a la derecha">→</button>
              <button className={`touch-button ${autoAccelerate ? "primary" : ""}`} onClick={() => setAutoAccelerate((value) => !value)} aria-pressed={autoAccelerate}>AUTO</button>
            </div>
            <div className="action-pad">
              <button className="touch-button" {...hold("brake")}>FRENO</button>
              <button className="touch-button drift" {...hold("drift")}>DRIFT</button>
              <button className="touch-button" aria-label="Usar objeto; mantén freno para lanzar atrás" onPointerDown={() => { runtimeRef.current?.useItem(); navigator.vibrate?.([12, 18, 12]); }}>ITEM</button>
              <button className="touch-button primary" {...hold("throttle")}>GAS</button>
            </div>
          </div>
        </>
      )}

      {paused && (
        <div className="race-menu">
          <div className="race-menu-inner">
            <h2>PAUSA</h2>
            <button className="cta-primary" onClick={() => setPaused(false)}><span>CONTINUAR</span><b>→</b></button>
            <button className="cta-ghost" onClick={() => runtimeRef.current?.respawn()}>REAPARECER</button>
            <button className="cta-ghost" onClick={() => setShowControls((value) => !value)} aria-expanded={showControls}>CONTROLES</button>
            {showControls && <div className="pause-controls"><span>WASD / FLECHAS</span><span>ESPACIO · DERRAPE</span><span>E · ITEM</span><span>S + E · LANZAR ATRÁS</span><span>R · REAPARECER</span></div>}
            <button className="cta-ghost" onClick={onExit}>SALIR DE LA CARRERA</button>
          </div>
        </div>
      )}
      <div className="orientation-overlay"><div><strong>GIRA TU DISPOSITIVO</strong><span>PRINT RUSH SE JUEGA EN HORIZONTAL</span></div></div>
    </main>
  );
}

function MiniMap({ player, bots }: { player: number; bots: number[] }) {
  const point = (progress: number) => {
    const normalized = ((progress % 1) + 1) % 1;
    const angle = -Math.PI / 2 + normalized * Math.PI * 2;
    return { x: 70 + Math.cos(angle) * 48, y: 47 + Math.sin(angle) * 29 };
  };
  const playerPoint = point(player);
  return (
    <svg className="hud-minimap" viewBox="0 0 140 94" role="img" aria-label="Minimapa">
      <ellipse cx="70" cy="47" rx="49" ry="30" fill="none" stroke="rgba(247,242,232,.3)" strokeWidth="8" />
      <ellipse cx="70" cy="47" rx="49" ry="30" fill="none" stroke="#f7f2e8" strokeWidth="2" />
      <line x1="65" y1="16" x2="75" y2="16" stroke="#b9ff45" strokeWidth="4" />
      {bots.map((progress, index) => { const p = point(progress); return <circle key={index} cx={p.x} cy={p.y} r="3" fill={["#4db7ff", "#ff7b2f", "#8f5cff"][index]} />; })}
      <circle cx={playerPoint.x} cy={playerPoint.y} r="5" fill="#ff3da6" stroke="#f7f2e8" strokeWidth="2" />
    </svg>
  );
}

function formatTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = Math.floor(milliseconds % 1_000 / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(2, "0")}`;
}
