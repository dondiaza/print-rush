"use client";

import { useEffect, useState } from "react";
import type { RuntimeQuality } from "@print-rush/3d-factory";
import { getDeviceReport, setQualityOverride } from "@/performance/PerformanceManager";
import { Button } from "./ui/Button";

/**
 * SETTINGS.
 *
 * This screen exists because two systems were already built and neither had a way in.
 *
 * `PerformanceManager` has had four quality tiers, an AUTO default derived from cores and memory, a
 * persisted override and a `FrameMonitor` since V5 — but nothing in the interface ever called
 * `setQualityOverride`, so a player on a machine the heuristic misjudged had no recourse. The
 * capability was complete and unreachable.
 *
 * The controls tutorial is the other half. The brief asks for the controls to be shown before a first
 * race and then never again unless asked for, which needs a persisted flag and a place to reset it.
 *
 * Everything here is a real setting that changes real behaviour. There is no row that only writes to
 * a state variable nothing reads.
 */

export type Settings = {
  nickname: string;
  laps: 1 | 2 | 3 | 5;
  muted: boolean;
};

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onBack: () => void;
  onShowControls: () => void;
};

const QUALITY_OPTIONS: ReadonlyArray<{ value: RuntimeQuality | "AUTO"; label: string; detail: string }> = [
  { value: "AUTO", label: "AUTO", detail: "Se ajusta a tu dispositivo" },
  { value: "LOW", label: "BAJA", detail: "Sin sombras, menos decoración" },
  { value: "MEDIUM", label: "MEDIA", detail: "Equilibrio para portátiles y móviles" },
  { value: "HIGH", label: "ALTA", detail: "Sombras, oclusión y partículas" },
  { value: "ULTRA", label: "ULTRA", detail: "Todo activo, 4× antialiasing" },
];

const LAP_OPTIONS = [1, 2, 3, 5] as const;

/** The one-line summary of what the device actually is, shown under the quality options. */
function describe(report: ReturnType<typeof getDeviceReport>): string {
  const memory = report.memoryGb === null ? "memoria desconocida" : `${report.memoryGb} GB`;
  return `${report.profile} · ${report.cores} núcleos · ${memory} · ${report.mobile ? "táctil" : "escritorio"}`;
}

export function SettingsScreen({ settings, onChange, onBack, onShowControls }: Props) {
  const [quality, setQuality] = useState<RuntimeQuality | "AUTO">("AUTO");
  const [detected, setDetected] = useState<string>("");

  useEffect(() => {
    // Deferred, and client-only: `getDeviceReport` touches `navigator`, `matchMedia` and
    // `localStorage`, none of which exist during the server render — and a synchronous setState here
    // would make React render this screen twice on mount.
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const report = getDeviceReport();
      setQuality(report.automatic ? "AUTO" : report.profile);
      setDetected(describe(report));
    });
    return () => {
      active = false;
    };
  }, []);

  const applyQuality = (value: RuntimeQuality | "AUTO") => {
    setQuality(value);
    setQualityOverride(value);
    // Re-read rather than assume: on AUTO the effective tier is whatever the heuristic decides, and
    // showing the player "AUTO" without telling them what that resolved to is not an answer.
    setDetected(describe(getDeviceReport()));
  };

  return (
    <section className="sheet" aria-labelledby="settings-title">
      <header className="sheet__head">
        <Button variant="ghost" size="sm" onClick={onBack} leading="←">VOLVER</Button>
        <h2 id="settings-title">AJUSTES</h2>
      </header>

      <div className="sheet__body">
        <label className="field">
          <span className="field__label">NOMBRE DEL PILOTO</span>
          <input
            className="field__input"
            value={settings.nickname}
            maxLength={18}
            onChange={(event) => onChange({ ...settings, nickname: event.target.value })}
          />
        </label>

        <fieldset className="field">
          <legend className="field__label">VUELTAS POR CARRERA</legend>
          <div className="chip-row">
            {LAP_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`chip ${settings.laps === value ? "is-on" : ""}`}
                aria-pressed={settings.laps === value}
                onClick={() => onChange({ ...settings, laps: value })}
              >
                {value}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="field__label">CALIDAD GRÁFICA</legend>
          <div className="option-list">
            {QUALITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`option ${quality === option.value ? "is-on" : ""}`}
                aria-pressed={quality === option.value}
                onClick={() => applyQuality(option.value)}
              >
                <b>{option.label}</b>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>
          {/* What the setting actually resolved to. On AUTO this is the only way to see the tier, and
              it is also the fastest answer to "why does it look different on my laptop". */}
          <p className="field__hint">DETECTADO · {detected || "…"}</p>
        </fieldset>

        <fieldset className="field">
          <legend className="field__label">SONIDO</legend>
          <div className="chip-row">
            <button
              type="button"
              className={`chip ${settings.muted ? "" : "is-on"}`}
              aria-pressed={!settings.muted}
              onClick={() => onChange({ ...settings, muted: false })}
            >
              ACTIVADO
            </button>
            <button
              type="button"
              className={`chip ${settings.muted ? "is-on" : ""}`}
              aria-pressed={settings.muted}
              onClick={() => onChange({ ...settings, muted: true })}
            >
              SILENCIO
            </button>
          </div>
        </fieldset>

        <div className="field">
          <span className="field__label">CONTROLES</span>
          <Button variant="secondary" onClick={onShowControls} trailing="→">VER LOS CONTROLES</Button>
        </div>
      </div>
    </section>
  );
}
