"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AllowedLaps } from "@print-rush/game-core";
import { GameRuntime, type HudState, type LoadProgress, type RaceResult } from "@/game/GameRuntime";
import { loadActiveKart } from "@/factory/storage";
import { resolveRaceCharacter } from "@/characters/race";
import { loadActiveTrack } from "@/factory/TrackFactory";
import { DebugOverlay, useDebugEnabled } from "./DebugOverlay";
import { Icon, iconForItem } from "@/ui/IconAtlas";

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
  view: "CHASE",
  driftLevel: 0,
  hasItem: false,
  itemName: null,
  itemId: null,
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

/**
 * How far along the load is, 0..1.
 *
 * Returns 0 rather than 1 for an empty total: before the manifest is read there is nothing to
 * divide by, and showing a full bar at that moment would be the exact lie this replaced.
 */
function loadFraction(progress: LoadProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(1, progress.loaded / progress.total);
}

export function RaceExperience({ laps, nickname, muted, onExit, onFinish }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const [hud, setHud] = useState<HudState>({ ...INITIAL_HUD, laps });
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  /**
   * Measured download progress, not a timer.
   *
   * The screen this drives used to read "CARGANDO TALLER…" over a fixed sentence while the runtime
   * built the world synchronously — it said the same thing whether loading took 200 ms or stalled
   * forever. Now every step comes from an asset that actually settled, so a bar that stops moving
   * means something is genuinely stuck, and the label says which kind of asset it is stuck on.
   */
  const [progress, setProgress] = useState<LoadProgress>({ loaded: 0, total: 0, label: "Iniciando motor" });
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
    const onProgress = (state: LoadProgress): void => { if (active) setProgress(state); };
    /**
     * The driver is resolved before the engine starts.
     *
     * Awaited rather than fetched alongside: the kart and its driver are built once during
     * `GameRuntime.create`, so a character that arrives afterwards would mean rebuilding the mesh
     * mid-race. `resolveRaceCharacter` never rejects — it degrades to the local character and then
     * to the fallback driver — so this cannot be the reason a race fails to start.
     */
    void resolveRaceCharacter().then((driver) => {
      if (!active) return null;
      onProgress({ loaded: 0, total: 1, label: "Preparando piloto" });
      return GameRuntime.create(canvas, { laps, muted, onHud, onFinish, onProgress, character: driver.definition, kartDefinition: loadActiveKart(), trackDefinition: loadActiveTrack() });
    }).then((runtime) => {
      if (!runtime) return;
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
        /* Anchored to the frame rather than placed in the HUD's grid: the grid's cells are all
           spoken for, and a view switch is a setting the player reaches for occasionally, not a
           readout that competes with lap, time and speed for attention. */
        .hud-view {
          position: absolute; right: 14px; bottom: 96px; z-index: 3;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 7px 11px; border: 0; border-radius: 11px; cursor: pointer;
          background: rgba(18, 16, 26, 0.62); color: #f7f2e8;
          backdrop-filter: blur(6px);
          font: 800 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.08em;
        }
        .hud-view span {
          font-size: 9px; opacity: 0.6; letter-spacing: 0.12em;
          border: 1px solid rgba(247, 242, 232, 0.34); border-radius: 4px; padding: 1px 4px;
        }
        .hud-view:hover, .hud-view:focus-visible { background: rgba(255, 61, 166, 0.72); }
        .hud-view:focus-visible { outline: 2px solid #b9ff45; outline-offset: 2px; }
        /* On a phone the action pad owns the bottom-right corner, so the button moves up out of it
           rather than sitting under a thumb. */
        @media (max-width: 820px) { .hud-view { bottom: auto; top: 96px; } }
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
        /* Icons sit on the type baseline and never push the layout around; the fallback is a
           readable word rather than a blank box. */
        .ui-icon { vertical-align: -0.16em; margin-right: 0.34em; flex: none; }
        .hud-item .ui-icon { margin-right: 0; }
        .ui-icon-fallback {
          font-size: 0.62em;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.72;
          margin-right: 0.34em;
        }
        .ui-icon.spinning { animation: icon-spin 1.1s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .ui-icon.spinning { animation: none; } }
        @keyframes icon-spin { to { transform: rotate(360deg); } }
        .load-bar {
          margin-top: 18px;
          height: 6px;
          width: min(320px, 60vw);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
          overflow: hidden;
        }
        .load-bar > span {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #ff3da6, #65d8ff);
          /* Eased so a burst of settled downloads reads as motion rather than as a jump. */
          transition: width 180ms ease-out;
        }
        @keyframes cue-pop {
          from { transform: translateX(-50%) scale(0.7); opacity: 0; }
          to { transform: translateX(-50%) scale(1); opacity: 1; }
        }
      `}</style>
      <canvas ref={canvasRef} className="race-canvas" />
      <div className="noise" aria-hidden="true" />

      {loading && (
        <div className="race-menu">
          <div className="race-menu-inner">
            <h2>CARGANDO TALLER…</h2>
            <p>{progress.label}{progress.total > 1 ? ` · ${progress.loaded}/${progress.total}` : ""}</p>
            <div className="load-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(loadFraction(progress) * 100)}>
              <span style={{ width: `${Math.round(loadFraction(progress) * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
      {debug && <DebugOverlay hudRef={hudRef} />}
      {error && <div className="race-menu"><div className="race-menu-inner"><h2>SIN MOTOR</h2><p>{error}</p><button className="cta-primary" onClick={onExit}>VOLVER</button></div></div>}

      {!loading && !error && (
        <>
          <div className="connection-note">V4 · LOCAL 60 HZ · {hud.trackName.toUpperCase()}</div>
          <div className={`hud ${hud.shuffled ? "hud-shuffled" : ""}`} aria-live="polite">
            <div className="hud-position"><Icon name="ui_position" size={15} label="Posición" />{hud.position}<span>/4</span></div>
            <div className="hud-top-center">
              <div className={`hud-lap ${hud.lastLap ? "final" : ""}`}><Icon name="ui_lap" size={16} label="Vuelta" />{hud.lastLap ? "FINAL " : "LAP "}{hud.lap} / {hud.laps}</div>
              <div className="hud-time"><Icon name="ui_timer" size={16} label="Tiempo" />{formatTime(hud.timeMs)}</div>
              <div className="hud-sector">SECTOR {hud.sector} · {hud.surface}</div>
            </div>
            <MiniMap player={hud.playerProgress} bots={hud.botProgress} />
            <div className={`hud-item ${hud.hasItem ? "ready" : ""}`}>
              <b>
                {hud.rouletteName
                  ? <Icon name="ui_settings" size={34} label="Imprimiendo" className="spinning" />
                  : hud.itemId
                    ? <Icon name={iconForItem(hud.itemId)} size={34} label={hud.itemName ?? "Objeto"} />
                    : <Icon name="ui_item_empty" size={34} label="Sin objeto" />}
              </b>
              <span>{hud.rouletteName ? `PRINTING · ${hud.rouletteName}` : hud.hasItem ? `E · ${hud.itemName?.toUpperCase()}` : "SIN OBJETO"}</span>
            </div>
            <div className="drift-meter">
              <div className="drift-label">
                <span><Icon name="ui_drift" size={15} label="Derrape" />DRIFT{hud.driftChain > 1 ? ` · CHAIN x${hud.driftChain}` : ""}</span>
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
            {/* Reachable in one tap on a phone and one key on a desktop, and labelled with what it
                switches *to* rather than with what is live — a button that says where it will take
                you is the one people press correctly the first time. */}
            <button
              type="button"
              className="hud-view"
              onClick={() => runtimeRef.current?.toggleView()}
              aria-label={hud.view === "CHASE" ? "Cambiar a vista en primera persona" : "Cambiar a vista en tercera persona"}
            >
              <b>{hud.view === "CHASE" ? "1ª PERSONA" : "3ª PERSONA"}</b>
              <span>V</span>
            </button>
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
              {/* Drift and hop are the same gesture on a keyboard, but a finger cannot tap and hold
                  one button at once, so touch gets them as two: hold DRIFT, tap SALTO. */}
              <button className="touch-button drift" {...hold("drift")}>DRIFT</button>
              <button className="touch-button" aria-label="Salto corto; cronométralo en una rampa para volar más" onPointerDown={() => { runtimeRef.current?.hop(); navigator.vibrate?.(10); }}>SALTO</button>
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
            {showControls && (
              <div className="pause-controls">
                <span>WASD / FLECHAS</span>
                {/* One key, three meanings, which is why it is written as one line: tap it on the
                    ground and the kart hops, hold it into a corner and the hop becomes a drift. */}
                <span>ESPACIO · SALTO (MANTÉN = DERRAPE)</span>
                <span>ESPACIO EN RAMPA · MÁS VUELO</span>
                <span>E · LANZAR OBJETO</span>
                <span>S + E · LANZAR HACIA ATRÁS</span>
                <span>V · VISTA 1ª / 3ª PERSONA</span>
                <span>R · REAPARECER</span>
              </div>
            )}
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
