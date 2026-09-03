"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { RaceResult } from "@/game/GameRuntime";
import { loadActiveTrack, saveTrack, TrackPresets, type StoredTrack } from "@/factory/TrackFactory";
import { Button } from "./ui/Button";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { HomeScreen } from "./HomeScreen";
import { SettingsScreen, type Settings } from "./SettingsScreen";
import { TrackSelect } from "./TrackSelect";
import { ControlsSheet, hasSeenControls, markControlsSeen } from "./ControlsSheet";
import { TrackMap } from "./TrackMap";

const RaceExperience = dynamic(() => import("./RaceExperience").then((module) => module.RaceExperience), { ssr: false });
const PodiumScene = dynamic(() => import("./PodiumScene").then((module) => module.PodiumScene), { ssr: false });

/**
 * THE SHELL.
 *
 * What changed here is the *shape of the flow*, not just the styling of it.
 *
 * The old route was `home → setup → briefing → race`, where `setup` was a form: a text input, a
 * radio group of lap counts, a `<fieldset>` of circuits, and seven read-only "setup-line" rows
 * repeating what the garage already knew. Three of those four things belong somewhere else — the
 * nickname and the lap count are settings, the circuit is a choice with its own screen — and the
 * read-only rows belong on the home, where the player can see them without leaving.
 *
 * So the screen is gone. The flow is now:
 *
 * ```
 * home ──► briefing ──► [controls, first race only] ──► race ──► results
 *   ├──► circuits
 *   └──► settings
 * ```
 *
 * Which is the brief's own flow with the redundant steps removed, exactly as it asks: the home shows
 * the loadout, so "choose character / choose kart" is not a step you are marched through, it is a
 * tile you press when you want it.
 *
 * Settings persist to local storage, and that is the correct use of it: a lap count and a nickname
 * are device preferences, not player data. The character, the kart and the face live in Postgres and
 * Blob — see `characters/race.ts` for the resolution order.
 */

type AppScreen = "home" | "tracks" | "settings" | "briefing" | "race" | "results";

const SETTINGS_KEY = "print-rush.settings.v1";

const DEFAULT_SETTINGS: Settings = { nickname: "Rookie", laps: 3, muted: false };

function readSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      // The nickname used to live under its own key. Read it once so nobody's name is lost.
      const legacy = window.localStorage.getItem("print-rush-nickname");
      return legacy ? { ...DEFAULT_SETTINGS, nickname: legacy } : DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const laps = parsed.laps;
    return {
      nickname: typeof parsed.nickname === "string" && parsed.nickname.trim() ? parsed.nickname.slice(0, 18) : DEFAULT_SETTINGS.nickname,
      laps: laps === 1 || laps === 2 || laps === 3 || laps === 5 ? laps : DEFAULT_SETTINGS.laps,
      muted: parsed.muted === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function PrintRushApp() {
  const [screen, setScreen] = useState<AppScreen>("home");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [activeTrack, setActiveTrack] = useState<StoredTrack>(TrackPresets[0]!);
  const [controlsOpen, setControlsOpen] = useState(false);
  /** Where to go once the controls sheet is dismissed: the race, or back where it was opened from. */
  const [controlsThenRace, setControlsThenRace] = useState(false);

  useEffect(() => {
    /**
     * Deferred to a microtask, not called synchronously.
     *
     * Both of these read `localStorage`, which does not exist during the server render, so they
     * cannot be lazy initial state without a hydration mismatch. Setting state synchronously inside
     * the effect instead makes React render twice in the same commit — a cascading render, which the
     * lint rule flags and which is a real cost on a screen that mounts a WebGL scene.
     */
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSettings(readSettings());
      setActiveTrack(loadActiveTrack());
    });
    return () => {
      active = false;
    };
  }, []);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the settings hold for this session, which is not worth an error for.
    }
  }, []);

  const enterRace = useCallback(() => {
    if (window.matchMedia("(pointer: coarse)").matches) {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
      const orientation = window.screen.orientation as ScreenOrientation & { lock?: (value: "landscape") => Promise<void> };
      void orientation.lock?.("landscape").catch(() => undefined);
    }
    setResult(null);
    setScreen("race");
  }, []);

  /**
   * The controls gate.
   *
   * Shown once, before the first race, and then never again unless asked for from settings — which
   * is what the brief specifies and what `hasSeenControls` persists. Checked here rather than inside
   * the race so a player is not reading a keyboard diagram while a countdown runs.
   */
  const startRace = useCallback(() => {
    if (!hasSeenControls()) {
      setControlsThenRace(true);
      setControlsOpen(true);
      return;
    }
    enterRace();
  }, [enterRace]);

  const dismissControls = useCallback(() => {
    markControlsSeen();
    setControlsOpen(false);
    if (controlsThenRace) {
      setControlsThenRace(false);
      enterRace();
    }
  }, [controlsThenRace, enterRace]);

  const selectTrack = useCallback((track: StoredTrack) => {
    saveTrack(track);
    setActiveTrack(track);
  }, []);

  if (screen === "race") {
    return (
      <ErrorBoundary scope="race">
        <RaceExperience
          laps={settings.laps}
          nickname={settings.nickname}
          muted={settings.muted}
          onExit={() => setScreen("home")}
          onFinish={(raceResult) => {
            setResult(raceResult);
            const key = `print-rush-record.${activeTrack.config.id}`;
            const previous = Number(localStorage.getItem(key) ?? Number.POSITIVE_INFINITY);
            if (raceResult.bestLapMs < previous) localStorage.setItem(key, String(raceResult.bestLapMs));
            setScreen("results");
          }}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary scope="menu">
      <main className="menu-shell">
        <div className="noise" aria-hidden="true" />

        {screen === "home" && (
          <HomeScreen
            onPlay={() => setScreen("briefing")}
            onTracks={() => setScreen("tracks")}
            onSettings={() => setScreen("settings")}
            trackName={activeTrack.config.name}
          />
        )}

        {screen === "tracks" && (
          <TrackSelect
            active={activeTrack}
            onSelect={selectTrack}
            onBack={() => setScreen("home")}
            onConfirm={() => setScreen("briefing")}
          />
        )}

        {screen === "settings" && (
          <SettingsScreen
            settings={settings}
            onChange={updateSettings}
            onBack={() => setScreen("home")}
            onShowControls={() => {
              setControlsThenRace(false);
              setControlsOpen(true);
            }}
          />
        )}

        {screen === "briefing" && (
          <section className="sheet sheet--wide briefing" aria-labelledby="briefing-title">
            <header className="sheet__head">
              <Button variant="ghost" size="sm" onClick={() => setScreen("home")} leading="←">VOLVER</Button>
              <h2 id="briefing-title">{activeTrack.config.name.toUpperCase()}</h2>
            </header>
            <div className="briefing__grid">
              <div className="briefing__map">
                <TrackMap nodes={activeTrack.baked.definition.nodes} />
              </div>
              <div className="briefing__facts">
                <div className="briefing__metrics">
                  <div><b>{(activeTrack.baked.analysis.lengthMeters / 1000).toFixed(2)}</b><span>KM</span></div>
                  <div><b>{Math.round(activeTrack.baked.analysis.estimatedLapSeconds)}</b><span>S / VUELTA</span></div>
                  <div><b>{activeTrack.baked.analysis.corners}</b><span>CURVAS</span></div>
                  <div><b>{settings.laps}</b><span>VUELTAS</span></div>
                </div>
                <ol className="sector-list">
                  {activeTrack.baked.blueprint.sectors.map((sector) => (
                    <li key={sector.index}><b>0{sector.index}</b><span>{sector.name}</span><i data-role={sector.role} /></li>
                  ))}
                </ol>
              </div>
            </div>
            <footer className="sheet__foot">
              <Button variant="primary" size="hero" onClick={startRace} trailing="→">A LA PARRILLA</Button>
            </footer>
          </section>
        )}

        {screen === "results" && result && (
          <>
            <PodiumScene position={result.position} />
            <section className="sheet results" aria-labelledby="results-title">
              <header className="sheet__head">
                <span className="results__position">#{result.position}</span>
                <h2 id="results-title">{result.position === 1 ? "TIRADA PERFECTA" : "BUENA TIRADA"}</h2>
              </header>
              <div className="results__stats">
                <div><span>TIEMPO</span><strong>{formatTime(result.totalTimeMs)}</strong></div>
                <div><span>MEJOR VUELTA</span><strong>{formatTime(result.bestLapMs)}</strong></div>
                <div><span>BOOSTS</span><strong>{result.boostsUsed}</strong></div>
              </div>
              <footer className="sheet__foot sheet__foot--split">
                <Button variant="primary" size="lg" onClick={() => setScreen("briefing")} trailing="↻">REVANCHA</Button>
                <Button variant="secondary" onClick={() => setScreen("tracks")}>OTRO CIRCUITO</Button>
                <Button variant="ghost" onClick={() => setScreen("home")}>INICIO</Button>
              </footer>
            </section>
          </>
        )}

        {controlsOpen && <ControlsSheet onDismiss={dismissControls} />}
      </main>
    </ErrorBoundary>
  );
}

function formatTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = Math.floor(milliseconds % 1_000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}
