"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { exportDefinition } from "@/factory/storage";
import {
  TrackPresets,
  TrackThemes,
  generateTrack,
  loadActiveTrack,
  loadTracks,
  saveTrack,
  validateTrack,
  type StoredTrack,
  type TrackConfig,
  type TrackTheme,
} from "@/factory/TrackFactory";

/**
 * CIRCUIT FACTORY V5.
 *
 * The V4 editor exposed the ellipse's own parameters — `radiusX`, `radiusZ`, `complexity` — which is
 * why its circuits could only ever be ellipses. Those controls no longer exist. What the editor
 * shows instead is what the brief asks for: total metres, estimated lap time, corner count, straight
 * count, elevation range, and how many times the circuit crosses over itself, all validated against
 * the V5 quality bar before a track can be used.
 */

const THEME_LABELS: Record<TrackTheme, string> = {
  FLAGSHIP: "T-Shirt Megastore",
  WAREHOUSE: "Warehouse Express",
  PRINT_FACTORY: "Ink & Print Factory",
  OFFICE: "Office Chaos",
  MANGA: "Manga Mega Con",
};

export function TrackStudio() {
  const [track, setTrack] = useState<StoredTrack>(TrackPresets[0]!);
  const [library, setLibrary] = useState<StoredTrack[]>([...TrackPresets]);
  const [status, setStatus] = useState("Circuito listo");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setTrack(loadActiveTrack());
      setLibrary(loadTracks());
    });
    return () => {
      active = false;
    };
  }, []);

  const change = <K extends keyof TrackConfig>(key: K, value: TrackConfig[K]): void => {
    setTrack((current) => generateTrack({ ...current.config, [key]: value }));
  };

  const analysis = track.baked.analysis;
  const issues = validateTrack(track);

  // Top-down plan drawn from the baked nodes. Height is encoded as line weight, which is how the
  // overpass becomes visible in a 2D map.
  const map = useMemo(() => {
    const nodes = track.baked.definition.nodes;
    const xs = nodes.map((node) => node.x);
    const zs = nodes.map((node) => node.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const span = Math.max(maxX - minX, maxZ - minZ) || 1;
    const scale = 88 / span;
    const offsetX = 50 - ((minX + maxX) / 2) * scale;
    const offsetZ = 50 - ((minZ + maxZ) / 2) * scale;
    const ys = nodes.map((node) => node.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const heightSpan = Math.max(0.001, maxY - minY);

    const project = (point: { x: number; z: number }): { x: number; y: number } => ({
      x: offsetX + point.x * scale,
      y: offsetZ + point.z * scale,
    });

    // Draw the lap in short segments so each can carry its own width; a single polyline cannot show
    // which part of the track is the bridge.
    const step = Math.max(1, Math.round(nodes.length / 260));
    const segments: Array<{ d: string; weight: number; sector: number }> = [];
    for (let index = 0; index < nodes.length; index += step) {
      const a = project(nodes[index]!);
      const b = project(nodes[(index + step) % nodes.length]!);
      const height = (nodes[index]!.y - minY) / heightSpan;
      segments.push({
        d: `M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}`,
        weight: 1.1 + height * 2.2,
        sector: nodes[index]!.sector,
      });
    }

    return {
      segments,
      checkpoints: track.baked.definition.checkpoints.map(project),
      landmarks: track.baked.blueprint.features
        .filter((feature) => feature.kind === "LANDMARK")
        .map((feature) => {
          const node = nodes[Math.floor((feature as { progress: number }).progress * nodes.length) % nodes.length]!;
          return { ...project(node), label: (feature as { label: string }).label };
        }),
      start: project(nodes[0]!),
    };
  }, [track]);

  const save = (): void => {
    if (issues.length > 0) {
      setStatus(issues[0]!);
      return;
    }
    setLibrary(saveTrack(track));
    setStatus("Validado, guardado y seleccionado para la próxima carrera");
  };

  const sectorColor = (sector: number): string =>
    ["#ff3da6", "#65d8ff", "#b9ff45", "#ffd43b", "#8f5cff"][(sector - 1) % 5] ?? "#ff3da6";

  return (
    <main className="track-shell">
      <header className="studio-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">PR</span>
          <span>PRINT RUSH</span>
        </Link>
        <nav>
          <Link href="/garage/character">PERSONAJE</Link>
          <Link href="/garage/kart">KART</Link>
          <Link href="/dev/handling">HANDLING</Link>
          <Link href="/">JUGAR</Link>
        </nav>
      </header>

      <section className="track-layout">
        <aside>
          <span className="studio-kicker">CIRCUIT FACTORY V5</span>
          <h1>
            TRAZA TU
            <br />
            <i>PISTA</i>
          </h1>
          <p>
            Circuitos de 2,5 a 5 km con sectores propios, desnivel real y cruces a distinta altura.
            El editor valida longitud, curvas, rectas, elevación, atajos y set-pieces antes de dejarte
            usar la pista.
          </p>

          <div className={`studio-status ${issues.length ? "warning" : ""}`}>
            <span />
            {status}
          </div>

          <div className="track-metrics">
            <b>{analysis.lengthMeters.toLocaleString("es-ES")} M</b>
            <span>{analysis.estimatedLapSeconds} S / VUELTA</span>
            <span>{analysis.corners} CURVAS</span>
            <span>{analysis.straights} RECTAS</span>
            <span>{analysis.elevationRange} M DESNIVEL</span>
            <span>{analysis.crossovers} CRUCES</span>
          </div>

          {issues.length > 0 ? (
            <ul className="track-issues">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}

          <details className="preset-library" open>
            <summary>CIRCUITOS · {library.length}</summary>
            {library.map((item) => (
              <div key={item.config.id}>
                <button
                  type="button"
                  onClick={() => {
                    setTrack(item);
                    saveTrack(item);
                    setStatus(`${item.config.name} equipado`);
                  }}
                >
                  {item.config.name}
                  <small>{item.baked.analysis.lengthMeters} m</small>
                </button>
              </div>
            ))}
          </details>
        </aside>

        <section className="track-map">
          <svg viewBox="0 0 100 100" role="img" aria-label="Vista cenital del circuito">
            {map.segments.map((segment, index) => (
              <path
                key={index}
                d={segment.d}
                stroke={sectorColor(segment.sector)}
                strokeWidth={segment.weight}
                strokeLinecap="round"
                fill="none"
                opacity={0.92}
              />
            ))}
            {map.checkpoints.map((point, index) => (
              <circle key={index} cx={point.x} cy={point.y} r="1" fill="#f7f2e8" opacity={0.8} />
            ))}
            {map.landmarks.map((landmark, index) => (
              <rect
                key={index}
                x={landmark.x - 0.9}
                y={landmark.y - 0.9}
                width="1.8"
                height="1.8"
                fill="#f7f2e8"
                opacity={0.55}
              />
            ))}
            <circle cx={map.start.x} cy={map.start.y} r="1.9" fill="none" stroke="#f7f2e8" strokeWidth="0.7" />
          </svg>
          <div>
            <span>{THEME_LABELS[track.config.theme]}</span>
            <strong>{track.config.name}</strong>
            <small>
              SEED {track.config.seed} · {analysis.nodeCount} NODOS ·{" "}
              {issues.length ? `${issues.length} AVISOS` : "VALID TRACK"}
            </small>
          </div>
        </section>

        <aside className="track-controls">
          <label className="studio-control">
            <span>NOMBRE</span>
            <input
              className="text-control"
              value={track.config.name}
              onChange={(event) => change("name", event.target.value)}
            />
          </label>

          <label className="studio-control">
            <span>TEMA</span>
            <select
              value={track.config.theme}
              onChange={(event) => change("theme", event.target.value as TrackTheme)}
            >
              {TrackThemes.map((theme) => (
                <option key={theme} value={theme}>
                  {THEME_LABELS[theme]}
                </option>
              ))}
            </select>
          </label>

          <label className="studio-control">
            <span>
              ANCHO DE PISTA<b>{track.config.width.toFixed(1)} m</b>
            </span>
            <input
              type="range"
              min={11}
              max={20}
              step={0.5}
              value={track.config.width}
              onChange={(event) => change("width", Number(event.target.value))}
            />
          </label>

          <p className="studio-hint">
            La geometría viene del blueprint del tema: la semilla mueve longitudes de recta, radios de
            curva y el lado al que gira la rampa. Cada semilla es un circuito distinto, no una
            variación de color.
          </p>

          <button
            type="button"
            className="random-button"
            onClick={() => {
              setTrack(
                generateTrack({
                  ...track.config,
                  id: `track-${Date.now().toString(36)}`,
                  seed: (Math.random() * 0xffffffff) >>> 0,
                  name: "Generated Rush",
                }),
              );
              setStatus("Nueva semilla generada");
            }}
          >
            ↻ REGENERAR SEMILLA
          </button>

          <div className="drawer-actions">
            <button type="button" className="drawer-primary" onClick={save}>
              VALIDAR + GUARDAR + USAR
            </button>
            <button
              type="button"
              onClick={() => {
                exportDefinition(`${track.config.id}.json`, {
                  config: track.config,
                  blueprint: track.baked.blueprint,
                  analysis,
                });
                setStatus("Blueprint V5 exportado");
              }}
            >
              EXPORTAR
            </button>
          </div>
        </aside>
      </section>

      <style>{`
        .track-issues { margin: 10px 0 0; padding-left: 18px; font-size: 12px; color: #ffb8c2; }
        .track-issues li { margin-bottom: 3px; }
        .studio-hint { font-size: 12px; opacity: 0.7; line-height: 1.5; }
        .preset-library button small { display: block; opacity: 0.55; font-size: 11px; }
      `}</style>
    </main>
  );
}
