"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { RaceResult } from "@/game/GameRuntime";

const MenuScene = dynamic(() => import("./MenuScene").then((module) => module.MenuScene), { ssr: false });
const RaceExperience = dynamic(() => import("./RaceExperience").then((module) => module.RaceExperience), { ssr: false });

type AppScreen = "home" | "setup" | "race" | "results";

export function PrintRushApp() {
  const [screen, setScreen] = useState<AppScreen>("home");
  const [laps, setLaps] = useState<1 | 2 | 3 | 5>(3);
  const [nickname, setNickname] = useState("Rookie");
  const [result, setResult] = useState<RaceResult | null>(null);
  const [muted, setMuted] = useState(false);

  const startRace = () => {
    const cleaned = nickname.trim().slice(0, 18) || "Rookie";
    setNickname(cleaned);
    localStorage.setItem("print-rush-nickname", cleaned);
    if (window.matchMedia("(pointer: coarse)").matches) {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
      const orientation = window.screen.orientation as ScreenOrientation & { lock?: (value: "landscape") => Promise<void> };
      void orientation.lock?.("landscape").catch(() => undefined);
    }
    setResult(null);
    setScreen("race");
  };

  if (screen === "race") {
    return (
      <RaceExperience
        laps={laps}
        nickname={nickname}
        muted={muted}
        onExit={() => setScreen("home")}
        onFinish={(raceResult) => { setResult(raceResult); setScreen("results"); }}
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
          <span className="build-tag"><i /> VERTICAL SLICE 01</span>
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
            <button className="cta-ghost" onClick={() => setScreen("setup")}>CONFIGURAR CARRERA</button>
          </div>
          <div className="race-meta" aria-label="Características">
            <span><b>01</b> CIRCUITO</span>
            <span><b>03</b> RIVALES</span>
            <span><b>∞</b> DERRAPE</span>
          </div>
          <div className="scroll-note">FLAGSHIP STORE <span>↘</span></div>
        </section>
      )}

      {screen === "setup" && (
        <section className="setup-panel" aria-labelledby="setup-title">
          <button className="back-button" onClick={() => setScreen("home")}>← VOLVER</button>
          <div className="setup-heading">
            <span>SOLO RACE / FLAGSHIP STORE</span>
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
            <div className="setup-line"><span>RIVALES</span><strong>3 BOTS / NORMAL</strong></div>
            <div className="setup-line"><span>OBJETOS</span><strong>THREAD BOOST / ON</strong></div>
          </div>
          <button className="cta-primary setup-start" onClick={startRace}><span>ARRANCAR</span><b>↗</b></button>
          <p className="controls-note">WASD / FLECHAS · ESPACIO PARA DERRAPAR · E PARA USAR OBJETO · R PARA REAPARECER</p>
        </section>
      )}

      {screen === "results" && result && (
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
            <button className="cta-primary" onClick={startRace}><span>REVANCHA</span><b>↻</b></button>
            <button className="cta-ghost" onClick={() => setScreen("home")}>SALIR</button>
          </div>
        </section>
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
