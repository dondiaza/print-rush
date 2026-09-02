"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { RaceResult } from "@/game/GameRuntime";
import { loadActiveCharacter, loadActiveKart } from "@/factory/storage";
import { loadActiveTrack, saveTrack, TrackPresets, type StoredTrack } from "@/factory/TrackFactory";

const MenuScene = dynamic(() => import("./MenuScene").then((module) => module.MenuScene), { ssr: false });
const RaceExperience = dynamic(() => import("./RaceExperience").then((module) => module.RaceExperience), { ssr: false });
const PodiumScene = dynamic(() => import("./PodiumScene").then((module) => module.PodiumScene), { ssr: false });

type AppScreen = "home" | "setup" | "briefing" | "race" | "results";

export function PrintRushApp() {
  const [screen, setScreen] = useState<AppScreen>("home");
  const [laps, setLaps] = useState<1 | 2 | 3 | 5>(3);
  const [nickname, setNickname] = useState("Rookie");
  const [result, setResult] = useState<RaceResult | null>(null);
  const [muted, setMuted] = useState(false);
  const [garage, setGarage] = useState({ character: "Rookie", kart: "Press Runner", track: "Flagship Store" });
  const [activeTrack, setActiveTrack] = useState<StoredTrack>(TrackPresets[0]!);
  useEffect(() => {
    if (screen === "race") return;
    let active = true;
    queueMicrotask(() => { if (active) { const track = loadActiveTrack(); setActiveTrack(track); setGarage({ character: loadActiveCharacter().name, kart: loadActiveKart().name, track: track.config.name }); } });
    return () => { active = false; };
  }, [screen]);

  const prepareRace = () => {
    const cleaned = nickname.trim().slice(0, 18) || "Rookie";
    setNickname(cleaned);
    localStorage.setItem("print-rush-nickname", cleaned);
    setScreen("briefing");
  };

  const startRace = () => {
    if (window.matchMedia("(pointer: coarse)").matches) {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
      const orientation = window.screen.orientation as ScreenOrientation & { lock?: (value: "landscape") => Promise<void> };
      void orientation.lock?.("landscape").catch(() => undefined);
    }
    setResult(null);
    setScreen("race");
  };

  const selectTrack = (track: StoredTrack) => {
    saveTrack(track);
    setActiveTrack(track);
    setGarage((current) => ({ ...current, track: track.config.name }));
  };

  const selectRelativeTrack = (offset: number) => {
    const index = TrackPresets.findIndex((track) => track.config.id === activeTrack.config.id);
    const next = TrackPresets[((index < 0 ? 0 : index) + offset + TrackPresets.length) % TrackPresets.length]!;
    selectTrack(next);
    setResult(null);
    setScreen("briefing");
  };

  if (screen === "race") {
    return (
      <RaceExperience
        laps={laps}
        nickname={nickname}
        muted={muted}
        onExit={() => setScreen("home")}
          onFinish={(raceResult) => {
            setResult(raceResult);
            const key = `print-rush-record.${activeTrack.config.id}`;
            const previous = Number(localStorage.getItem(key) ?? Number.POSITIVE_INFINITY);
            if (raceResult.bestLapMs < previous) localStorage.setItem(key, String(raceResult.bestLapMs));
            setScreen("results");
          }}
      />
    );
  }

  return (
    <main className="menu-shell">
      <MenuScene />
      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Print Rush, inicio">
          <span className="brand-mark">PR</span>
          <span>PRINT RUSH</span>
        </a>
        <div className="topbar-actions">
          <span className="build-tag"><i /> V4 · RACE BUILD</span>
          <button className="icon-button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Activar sonido" : "Silenciar sonido"}>
            {muted ? "SONIDO OFF" : "SONIDO ON"}
          </button>
        </div>
      </header>

      {screen === "home" && (
        <section className="hero" id="top">
          <div className="hero-kicker">RACING / SCREEN PRINT / MAYHEM</div>
          <h1><span>PRINT</span><strong>RUSH</strong></h1>
          <p>El taller cierra. La pista abre. Derrapa entre tinta, paquetes y camisetas en una carrera arcade hecha para web.</p>
          <div className="hero-actions">
            <button className="cta-primary" onClick={() => setScreen("setup")}><span>JUGAR AHORA</span><b>→</b></button>
            <a className="cta-ghost garage-link" href="/garage/character">CREAR PERSONAJE</a>
            <a className="cta-ghost garage-link" href="/garage/kart">DISEÑAR KART</a>
            <a className="cta-ghost garage-link" href="/factory">FACTORY</a>
          </div>
          <div className="race-meta" aria-label="Características">
            <span><b>05</b> CIRCUITOS</span>
            <span><b>03</b> RIVALES</span>
            <span><b>13</b> POWER-UPS</span>
          </div>
          <div className="scroll-note">{garage.track.toUpperCase()} <span>↘</span></div>
        </section>
      )}

      {screen === "setup" && (
        <section className="setup-panel" aria-labelledby="setup-title">
          <button className="back-button" onClick={() => setScreen("home")}>← VOLVER</button>
          <div className="setup-heading">
            <span>SOLO RACE / {garage.track.toUpperCase()}</span>
            <h2 id="setup-title">PREPARA<br />TU TIRADA</h2>
          </div>
          <div className="setup-fields">
            <label>
              NOMBRE DEL PILOTO
              <input value={nickname} maxLength={18} onChange={(event) => setNickname(event.target.value)} autoFocus />
            </label>
            <fieldset>
              <legend>VUELTAS</legend>
              <div className="lap-options">
                {([1, 2, 3, 5] as const).map((value) => (
                  <button className={laps === value ? "selected" : ""} key={value} onClick={() => setLaps(value)}>{value}</button>
                ))}
              </div>
            </fieldset>
            <div className="setup-line"><span>PERSONAJE</span><strong>{garage.character.toUpperCase()}</strong></div>
            <div className="setup-line"><span>KART</span><strong>{garage.kart.toUpperCase()}</strong></div>
            <div className="setup-line"><span>CIRCUITO</span><strong>{garage.track.toUpperCase()}</strong></div>
            <fieldset className="track-options-field">
              <legend>SELECCIONAR PISTA</legend>
              <div className="track-options">
                {TrackPresets.map((track, index) => <button key={track.config.id} className={activeTrack.config.id === track.config.id ? "selected" : ""} onClick={() => selectTrack(track)} aria-label={`Seleccionar ${track.config.name}`}><b>0{index + 1}</b><span>{track.config.name}</span></button>)}
              </div>
            </fieldset>
            <div className="setup-line"><span>RIVALES</span><strong>3 BOTS / NORMAL</strong></div>
            <div className="setup-line"><span>OBJETOS</span><strong>13 ITEMS / ON</strong></div>
            <div className="setup-line"><span>GARAGE</span><strong><a href="/garage/character">PERSONAJE</a> · <a href="/garage/kart">KART</a> · <a href="/factory/track">PISTA</a></strong></div>
          </div>
          <button className="cta-primary setup-start" onClick={prepareRace}><span>IR A PARRILLA</span><b>↗</b></button>
          <p className="controls-note">WASD / FLECHAS · ESPACIO PARA DERRAPAR · E PARA USAR OBJETO · R PARA REAPARECER</p>
        </section>
      )}

      {screen === "briefing" && (
        <section className="briefing-panel" aria-labelledby="briefing-title">
          <button className="back-button" onClick={() => setScreen("setup")}>← CONFIGURACIÓN</button>
          <div className="briefing-copy">
            <span className="result-eyebrow">TRACK INTRO · 5 SECTORES</span>
            <h2 id="briefing-title">{activeTrack.config.name.toUpperCase()}</h2>
            <div className="briefing-metrics">
              <div><b>{activeTrack.baked.analysis.lengthMeters.toLocaleString("es-ES")}M</b><span>LONGITUD</span></div>
              <div><b>{activeTrack.baked.analysis.estimatedLapSeconds}S</b><span>VUELTA EST.</span></div>
              <div><b>{activeTrack.baked.analysis.corners}</b><span>CURVAS</span></div>
              <div><b>{activeTrack.config.theme.replace("_", " ")}</b><span>ENTORNO</span></div>
            </div>
            <ol className="sector-list">{activeTrack.baked.blueprint.sectors.map((sector) => <li key={sector.index}><b>0{sector.index}</b><span>{sector.name}</span><i data-role={sector.role} /></li>)}</ol>
          </div>
          <div className="controls-card">
            <span>CONTROLES / PC + MOBILE</span>
            <h3>DRIFT. CARGA.<br />SUELTA. ACELERA.</h3>
            <dl><div><dt>DIRECCIÓN</dt><dd>WASD / FLECHAS</dd></div><div><dt>DERRAPE</dt><dd>ESPACIO / DRIFT</dd></div><div><dt>OBJETO</dt><dd>E / ITEM</dd></div><div><dt>ATRÁS</dt><dd>S + E / FRENO + ITEM</dd></div><div><dt>RESET</dt><dd>R / PAUSA</dd></div></dl>
            <p>Mantén gas durante el último destello para una salida turbo.</p>
            <button className="cta-primary" onClick={startRace}><span>LISTO · ARRANCAR</span><b>→</b></button>
          </div>
        </section>
      )}

      {screen === "results" && result && (
        <>
        <PodiumScene position={result.position} />
        <section className="results-panel">
          <span className="result-eyebrow">CARRERA TERMINADA</span>
          <div className="result-position">#{result.position}</div>
          <h2>{result.position === 1 ? "TIRADA PERFECTA" : "BUENA TIRADA"}</h2>
          <div className="result-stats">
            <div><span>TIEMPO</span><strong>{formatTime(result.totalTimeMs)}</strong></div>
            <div><span>MEJOR VUELTA</span><strong>{formatTime(result.bestLapMs)}</strong></div>
            <div><span>BOOSTS</span><strong>{result.boostsUsed}</strong></div>
          </div>
          <div className="result-actions">
            <button className="cta-primary" onClick={() => setScreen("briefing")}><span>REVANCHA</span><b>↻</b></button>
            <button className="cta-ghost" onClick={() => selectRelativeTrack(1)}>SIGUIENTE CIRCUITO</button>
            <button className="cta-ghost" onClick={() => { const candidates = TrackPresets.filter((track) => track.config.id !== activeTrack.config.id); selectTrack(candidates[Math.floor(Math.random() * candidates.length)]!); setScreen("briefing"); }}>PISTA ALEATORIA</button>
            <button className="cta-ghost" onClick={() => setScreen("home")}>SALIR</button>
          </div>
        </section>
        </>
      )}
    </main>
  );
}

function formatTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = Math.floor(milliseconds % 1_000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}
